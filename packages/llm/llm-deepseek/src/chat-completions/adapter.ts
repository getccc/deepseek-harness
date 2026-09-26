/**
 * Chat Completions carried by a mounted LLM HTTP transport: the `built-in`
 * route through which a Team Runner reaches company models. The transport
 * lists the route's catalog and carries each serialized request as its
 * `chat.completions` operation, so the Runner holds no provider key; images
 * therefore travel inline as base64, never through the Files API.
 *
 * @module dsh-llm-deepseek/chat-completions/adapter
 */

import { contentHasImage, CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError, isQuotaExceededError, LlmAdapter, LlmError, ProviderRequestId, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  ImageAttachmentAccess,
  LlmModelInfo,
  LlmProviderInfo,
  PreparedAdapterCall,
  LlmResolvedModelInfo,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type {
  AttachmentId,
  AttachmentStore,
  ImageAttachmentRef,
  RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { LlmHttpTransport, TransportModel } from '@deepseek-ai/dsh-llm-http-transport'
import { Readable } from 'node:stream'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { DeepSeekLlmApiJson } from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import { deepSeekImageRequestPricing, resolveRequestImageTarget } from '../request-pricing.ts'
import { catalogModelInfo, modelInfo } from '../model-info.ts'
import type { DeepSeekAdapterOptions, DeepSeekCatalogModel, DeepSeekConnectionOptions } from '../types.ts'
import { prepareRequestExtensions } from '../request-extensions.ts'
import { serializeRequest, serializeRequestWithImages } from './serialize.ts'
import { parseSse } from './sse.ts'
import { translate } from './translate.ts'
import type { WireError, WireRequest } from './wire-types.ts'

/** Provider route whose models a deployment transport supplies. */
export const BUILT_IN_PROVIDER = 'built-in'

const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT'

/** Constructor options for {@link ChatCompletionsAdapter}. */
export interface ChatCompletionsAdapterOptions extends Pick<DeepSeekAdapterOptions,
  'options' | 'resolveAttachments' | 'resolveImageAccess' | 'prepareExtensions' | 'onExtensionsOmitted'> {
  /** The mounted transport, read once per operation; absent fails the request with `TRANSPORT`. */
  transport: () => LlmHttpTransport | undefined
}

function collectImageRefs(
  content: readonly ContentBlock[],
  refs: Map<AttachmentId, ImageAttachmentRef>,
): void {
  for (const block of content) {
    if (block.type === 'image' && block.offloaded !== true) refs.set(block.attachment.attachmentId, block.attachment)
  }
}

async function prepareRequestImages(
  options: GenerateOptions,
  attachments: AttachmentStore,
  model: DeepSeekCatalogModel,
  signal: AbortSignal,
): Promise<Map<AttachmentId, RequestImageAttachment>> {
  const refs = new Map<AttachmentId, ImageAttachmentRef>()
  for (const message of options.messages) collectImageRefs(message.content, refs)
  const orderedRefs = [...refs.values()]
  const projected = await Promise.all(orderedRefs.map(
    ref => attachments.readImageRequest(ref, resolveRequestImageTarget(model, ref), signal),
  ))
  return new Map(orderedRefs.map((ref, index) => (
    [ref.attachmentId, projected[index] as RequestImageAttachment]
  )))
}

/**
 * A transport-controlled catalog entry in the adapter's own catalog form.
 * The remote catalog declares only the modalities; the image budgets are this
 * adapter's defaults, because that catalog carries no per-model image policy.
 */
function catalogModelOf(remote: TransportModel): DeepSeekCatalogModel {
  return { id: remote.id, name: remote.name, inputModalities: [...remote.inputModalities] }
}

function providerRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1_000
    return Number.isFinite(delay) && delay > 0 ? delay : undefined
  }
  const delay = Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

function requestId(headers: Headers): ReturnType<typeof ProviderRequestId> | undefined {
  const value = headers.get('x-request-id') ?? headers.get('x-deepseek-request-id')
  return value === null || value.length === 0 ? undefined : ProviderRequestId(value)
}

/**
 * Map an HTTP status to a stable LlmError code.
 * @param status - status of a non-2xx provider response.
 * @param error - parsed provider error body, when available.
 * @returns the normalized harness error code.
 */
export function httpErrorCode(status: number, error?: WireError['error']): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 413) return 'INVALID_REQUEST'
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(' ')
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE
    return 'INVALID_REQUEST'
  }
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

/**
 * One adapter serves every model its transport lists (the harness model name
 * is the wire model ref).
 *
 * One stable signal reaches both the transport call and body reads. Caller
 * aborts map to `ABORTED`; the configured per-read idle watchdog maps to
 * `TIMEOUT`.
 */
export class ChatCompletionsAdapter extends LlmAdapter {
  /**
   * The last catalog each route listed. Every resolution re-reads the
   * transport, so this serves only the synchronous pricing path, which
   * cannot wait for a listing and is always preceded by one.
   */
  private readonly remoteCatalogs = new Map<string, readonly DeepSeekCatalogModel[]>()

  constructor(private readonly config: ChatCompletionsAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Built-in Models', category: 'built-in' }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.config.options().retryPolicy
  }

  override imageRequestPricing(provider: string, model: string): ReturnType<LlmAdapter['imageRequestPricing']> {
    // The same access resolution the serializer uses, so priced handle and
    // placeholder text matches what the request actually sends.
    const attachments = this.config.resolveAttachments?.()
    const resolveAccess = attachments === undefined
      ? undefined
      : (ref: ImageAttachmentRef): ImageAttachmentAccess | undefined => (
        this.config.resolveImageAccess?.(attachments, ref)
      )
    // Before the route has listed once, a model is unknown here and prices
    // as text-only; a prepared call lists before every request.
    const pricing = { ...this.config.options(), models: this.remoteCatalogs.get(provider) ?? [] }
    return deepSeekImageRequestPricing(pricing, model, resolveAccess)
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const connection = await this.routeConnection(provider, this.config.options())
    return connection.models.map(model => catalogModelInfo(provider, model))
  }

  override async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return modelInfo(await this.routeConnection(provider, this.config.options()), provider, model)
  }

  override async prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const connection = await this.routeConnection(provider, this.config.options())
    return {
      model: modelInfo(connection, provider, model),
      stream: options => this.streamWithConnection(options, connection),
    }
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamResolving(options, this.config.options())
  }

  private transport(): LlmHttpTransport {
    const transport = this.config.transport()
    if (transport === undefined) throw new LlmError('The built-in model transport is unavailable.', 'TRANSPORT')
    return transport
  }

  /**
   * The connection snapshot carrying the catalog the transport lists. It is
   * re-read on every call, so a catalog change on the Control Plane reaches
   * the next request rather than the next restart, and the listing is
   * remembered for {@link imageRequestPricing}. A transport that leaves
   * discovery to the adapter keeps the connection's configured list.
   */
  private async routeConnection(
    provider: string,
    connection: DeepSeekConnectionOptions,
  ): Promise<DeepSeekConnectionOptions> {
    const remote = await this.transport().listModels()
    const models = remote === undefined ? connection.models : remote.map(catalogModelOf)
    this.remoteCatalogs.set(provider, models)
    return { ...connection, models }
  }

  /** Resolve the route's catalog, then stream with it. */
  private async * streamResolving(
    options: GenerateOptions,
    connection: DeepSeekConnectionOptions,
  ): AsyncIterable<StreamChunk> {
    yield* this.streamWithConnection(options, await this.routeConnection(options.provider, connection))
  }

  private async * streamWithConnection(
    options: GenerateOptions,
    connection: DeepSeekConnectionOptions,
  ): AsyncIterable<StreamChunk> {
    // Connection facts freeze here and hold for this whole request, so an
    // in-flight stream never observes a configuration change and the next
    // call re-resolves.
    const transport = this.transport()
    let attachments: AttachmentStore | undefined
    if (options.messages.some(message => contentHasImage(message.content))) {
      // The transport's catalog, which the Control Plane administrator wrote,
      // is the only declaration of what a model accepts.
      const model = connection.models.find(entry => entry.id === options.model)
      if (model?.inputModalities?.includes('image') !== true) {
        throw new LlmError(
          `DeepSeek model "${options.model}" does not accept image input.`,
          'UNSUPPORTED_CONTENT',
        )
      }
      attachments = this.config.resolveAttachments?.()
      if (attachments === undefined) {
        throw new LlmError(
          'DeepSeek image conversion requires the durable attachment service.',
          'UNSUPPORTED_CONTENT',
        )
      }
    }
    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    using watchdog = idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE)
    const iterator = this.request(
      options,
      watchdog.signal,
      connection,
      transport,
      attachments,
      () => { watchdog.pulse() },
    )[Symbol.asyncIterator]()
    let exhausted = false
    try {
      while (true) {
        const result = await watchdog.next(iterator)
        if (result.done) {
          exhausted = true
          return
        }
        yield result.value
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError(
          `DeepSeek stream idle timeout after ${connection.streamIdleTimeoutMs}ms`,
          'TIMEOUT',
          { cause: error },
        )
      }
      if (options.signal?.aborted) {
        throw new LlmError('DeepSeek request aborted by caller', 'ABORTED', { cause: error })
      }
      if (error instanceof LlmError) throw error
      throw new LlmError('DeepSeek stream through the built-in model transport failed', 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort('DeepSeek stream consumer stopped')
      if (!exhausted && iterator.return !== undefined) {
        try {
          await iterator.return()
        } catch (_abortedTransportTeardown) {
          // The consumer controller already owns termination; a return-time abort cannot add a second outcome.
        }
      }
    }
  }

  private async * request(
    options: GenerateOptions,
    signal: AbortSignal,
    connection: DeepSeekConnectionOptions,
    transport: LlmHttpTransport,
    attachments: AttachmentStore | undefined,
    onActivity: () => void,
  ): AsyncIterable<StreamChunk> {
    const model = connection.models.find(entry => entry.id === options.model)
    const requestImages = attachments === undefined || model === undefined
      ? new Map<AttachmentId, RequestImageAttachment>()
      : await prepareRequestImages(options, attachments, model, signal)
    const body: WireRequest = attachments === undefined
      ? serializeRequest(options, connection.defaults)
      : serializeRequestWithImages(options, {
        requestImages,
        resolveImageAccess: (ref: ImageAttachmentRef): ImageAttachmentAccess | undefined => (
          this.config.resolveImageAccess?.(attachments, ref)
        ),
        maxRequestImageBytes: connection.maxInlineRequestImageBytes,
        maxImagesPerRequest: connection.maxImagesPerRequest,
        byteQuantum: connection.inlineImageOffloadByteQuantum,
        countQuantum: connection.imageOffloadCountQuantum,
      }, connection.defaults)
    const extensions = await prepareRequestExtensions(body as Readonly<Record<string, DeepSeekLlmApiJson>>, {
      signal,
      ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
      ...options.purpose === undefined ? {} : { purpose: options.purpose },
    }, this.config.prepareExtensions, (fields, error) => {
      this.config.onExtensionsOmitted?.({ provider: options.provider, model: options.model, fields, error })
    })

    let response: Response
    try {
      const carried = await transport.send({
        operation: 'chat.completions',
        modelRef: options.model,
        body: JSON.parse(extensions.payload) as Record<string, unknown>,
        // DeepSeek reports exact input usage in the response. The gateway
        // settles from that report; zero avoids inventing a tokenizer-side
        // estimate before the provider has counted the request.
        inputTokens: 0,
        ...(options.maxTokens === undefined ? {} : { maxOutputTokens: options.maxTokens }),
        ...(options.sessionId === undefined ? {} : { correlationId: String(options.sessionId) }),
        signal,
      })
      const noBody = carried.status === 204 || carried.status === 205 || carried.status === 304
      response = new Response(
        noBody ? null : Readable.toWeb(carried.body) as ReadableStream<Uint8Array>,
        { status: carried.status, headers: carried.headers },
      )
    } catch (error: unknown) {
      if (signal.aborted) throw error
      throw new LlmError(
        'DeepSeek request through the built-in model transport failed',
        'TRANSPORT',
        { cause: error },
      )
    }

    if (!response.ok) {
      let message = `DeepSeek API error (HTTP ${response.status})`
      let providerError: WireError['error']
      const rawResponse = await response.text()
      try {
        const parsed = JSON.parse(rawResponse) as WireError
        providerError = parsed.error
        if (providerError?.message) message = providerError.message
      } catch (_malformedGatewayError) {
        // The HTTP status remains authoritative when a gateway returns malformed JSON.
      }
      const delay = providerRetryAfterMs(response.headers.get('retry-after'))
      const id = requestId(response.headers)
      throw new LlmError(message, httpErrorCode(response.status, providerError), {
        cause: new Error(rawResponse.length > 0 ? rawResponse : `DeepSeek HTTP ${response.status}`),
        status: response.status,
        ...delay === undefined ? {} : { providerRetryAfterMs: delay },
        ...id === undefined ? {} : { requestId: id },
      })
    }
    await extensions.accept()
    if (!response.body) {
      throw new LlmError('DeepSeek API returned no response body', 'EMPTY_RESPONSE')
    }

    yield* translate(parseSse(response.body, onActivity))
  }
}
