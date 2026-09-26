/**
 * The transport-carried Chat Completions adapter behind the `built-in` route:
 * the mounted LLM HTTP transport lists the catalog and carries every request,
 * so the adapter holds no provider key and sends images inline.
 */
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  createToolResultMessage,
  createUserMessage,
  LlmError,
  ProviderRequestId,
  QUOTA_EXCEEDED_CODE,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { LlmHttpTransport, TransportFailedError } from '@deepseek-ai/dsh-llm-http-transport'
import type { TransportModel, TransportRequest, TransportResponse } from '@deepseek-ai/dsh-llm-http-transport'
import type { PreparedDeepSeekLlmApiExtensions } from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import { SessionId } from '@deepseek-ai/dsh-session'
import { BUILT_IN_PROVIDER, ChatCompletionsAdapter, httpErrorCode } from '../src/chat-completions/adapter.ts'
import type { ChatCompletionsAdapterOptions } from '../src/chat-completions/adapter.ts'
import { resolveAdapterOptions } from '../src/config.ts'
import type { Options } from '../src/config.ts'
import { chunks, prepareExtensions, requestImageStore, user } from './helpers.ts'

declare module '@deepseek-ai/dsh-deepseek-llm-api-extensions' {
  interface DeepSeekLlmApiExtensionMap {
    dsh_chat_completions_test: { version: number }
  }
}

/** One complete Chat Completions text generation, as SSE bytes. */
const SSE_TEXT = [
  '{"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}',
  '{"choices":[{"delta":{"content":"hello"}}]}',
  '{"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
  '[DONE]',
].map(data => `data: ${data}\n\n`).join('')

const COMPANY_TEXT: TransportModel = { id: 'company-v4', name: 'Company V4', inputModalities: ['text'] }
const COMPANY_VISION: TransportModel = { id: 'company-vision', name: 'Company Vision', inputModalities: ['text', 'image'] }

const imageRef: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 3,
  width: 1,
  height: 1,
}

const imageMessage = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image', attachment: imageRef }] })

/** The prepared request version of `ref`: three bytes, `AQID` in base64. */
function requestImage(ref: ImageAttachmentRef): RequestImageAttachment {
  return {
    variantId: ImageVariantId(`sha256:${'b'.repeat(64)}`),
    attachment: ref,
    data: Uint8Array.of(1, 2, 3),
    mediaType: 'image/png',
    bytes: 3,
    width: 1,
    height: 1,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: true,
  }
}

function sseResponse(text = SSE_TEXT): TransportResponse {
  return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: Readable.from([Buffer.from(text)]) }
}

/** A body that stays open until the request's signal aborts, then fails with the abort reason. */
function heldOpen(request: TransportRequest): Readable {
  const body = new Readable({ read() {} })
  request.signal?.addEventListener('abort', () => { body.destroy(new Error('carried request aborted')) }, { once: true })
  return body
}

type Answer = (request: TransportRequest) => Promise<TransportResponse>

/** A mounted transport whose catalog and answers a test scripts; it records every carried request. */
class ScriptedTransport extends LlmHttpTransport {
  readonly requests: TransportRequest[] = []
  listings = 0

  constructor(
    public catalog: readonly TransportModel[] | undefined,
    private readonly answer: Answer = () => Promise.resolve(sseResponse()),
  ) {
    super(new Context())
  }

  override send(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request)
    return this.answer(request)
  }

  override listModels(): Promise<readonly TransportModel[] | undefined> {
    this.listings += 1
    return Promise.resolve(this.catalog)
  }
}

/** Host services a test supplies in place of the plugin's. */
interface HostServices extends Pick<ChatCompletionsAdapterOptions, 'resolveImageAccess' | 'onExtensionsOmitted'> {
  attachments?: AttachmentStore
  prepare?: ChatCompletionsAdapterOptions['prepareExtensions']
}

function adapterOver(
  transport: LlmHttpTransport | undefined,
  config: Options = {},
  { attachments, prepare, ...services }: HostServices = {},
): ChatCompletionsAdapter {
  return new ChatCompletionsAdapter({
    options: () => resolveAdapterOptions(config),
    transport: () => transport,
    prepareExtensions: prepare ?? prepareExtensions,
    ...attachments === undefined ? {} : { resolveAttachments: () => attachments },
    ...services,
  })
}

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: BUILT_IN_PROVIDER, model: COMPANY_TEXT.id, messages: [user()], ...overrides }
}

function visualTokens(adapter: ChatCompletionsAdapter, model: string): number | undefined {
  return adapter.imageRequestPricing(BUILT_IN_PROVIDER, model)
    ?.priceImages([{ type: 'image', attachment: imageRef }])[0]?.visualTokens
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ChatCompletionsAdapter on the built-in route', () => {
  it('describes the route as built-in and serves the configured retry policy', () => {
    const adapter = adapterOver(new ScriptedTransport([]), {
      retryPolicy: { mode: 'always', backoff: { initialDelayMs: 25, maxDelayMs: 100, jitterRatio: 0.2 } },
    })
    expect(adapter.providerInfo(BUILT_IN_PROVIDER)).toEqual({ id: BUILT_IN_PROVIDER, name: 'Built-in Models', category: 'built-in' })
    expect(adapter.providerRetryPolicy(BUILT_IN_PROVIDER)).toEqual({
      mode: 'always',
      initialDelayMs: 25,
      maxDelayMs: 100,
      jitterRatio: 0.2,
    })
  })

  it('carries a request as a chat.completions operation that names no endpoint or credential', async () => {
    const transport = new ScriptedTransport([COMPANY_TEXT])
    const output = await chunks(adapterOver(transport).stream(request({
      messages: [user('hi')],
      maxTokens: 512,
      sessionId: SessionId('session-1'),
    })))

    expect(transport.requests).toHaveLength(1)
    const [carried] = transport.requests
    expect(Object.keys(carried!).sort()).toEqual([
      'body', 'correlationId', 'inputTokens', 'maxOutputTokens', 'modelRef', 'operation', 'signal',
    ])
    expect(carried).toMatchObject({
      operation: 'chat.completions',
      modelRef: 'company-v4',
      inputTokens: 0,
      maxOutputTokens: 512,
      correlationId: 'session-1',
      body: {
        model: 'company-v4',
        max_tokens: 512,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: 'hi' }],
      },
    })
    expect(carried?.signal).toBeInstanceOf(AbortSignal)
    expect(output.map(chunk => chunk.type)).toEqual(['block-start', 'text-delta', 'block-end', 'usage', 'finish'])
    expect(output.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('leaves the output cap and correlation off a request that names neither', async () => {
    const transport = new ScriptedTransport([COMPANY_TEXT])
    await chunks(adapterOver(transport).stream(request()))

    expect(transport.requests[0]).not.toHaveProperty('maxOutputTokens')
    expect(transport.requests[0]).not.toHaveProperty('correlationId')
    expect(transport.requests[0]?.body).not.toHaveProperty('max_tokens')
  })

  it('hands the request purpose and session to extension preparation', async () => {
    const transport = new ScriptedTransport([COMPANY_TEXT])
    const prepare = vi.fn(prepareExtensions)

    await chunks(adapterOver(transport, {}, { prepare }).stream(request({
      purpose: 'session-title',
      sessionId: SessionId('session-1'),
    })))

    expect(prepare).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      purpose: 'session-title',
      sessionId: 'session-1',
      signal: expect.any(AbortSignal) as AbortSignal,
    }))
    expect(transport.requests[0]?.body).toMatchObject({ thinking: { type: 'disabled' } })
  })

  it('merges request extension fields and accepts them only after a 2xx answer', async () => {
    const accept = vi.fn(() => Promise.resolve())
    const prepare = vi.fn((): Promise<PreparedDeepSeekLlmApiExtensions> => Promise.resolve({
      fields: { dsh_chat_completions_test: { version: 1 } },
      accept,
    }))
    const refused = new ScriptedTransport([COMPANY_TEXT], () => Promise.resolve({
      status: 500,
      headers: {},
      body: Readable.from([Buffer.from('{"error":{"message":"down"}}')]),
    }))
    await expect(chunks(adapterOver(refused, {}, { prepare }).stream(request()))).rejects.toMatchObject({ code: 'SERVER' })
    expect(refused.requests[0]?.body).toMatchObject({ dsh_chat_completions_test: { version: 1 } })
    expect(accept).not.toHaveBeenCalled()

    await chunks(adapterOver(new ScriptedTransport([COMPANY_TEXT]), {}, { prepare }).stream(request()))
    expect(accept).toHaveBeenCalledOnce()
  })

  it('sends the base request and reports extension fields that fail to serialize', async () => {
    const overflow = new RangeError('Invalid string length')
    const stringify = JSON.stringify.bind(JSON)
    vi.spyOn(JSON, 'stringify').mockImplementation((value: unknown, replacer?: (number | string)[] | null, space?: string | number) => {
      if (typeof value === 'object' && value !== null && Object.hasOwn(value, 'dsh_chat_completions_test')) throw overflow
      return stringify(value, replacer, space)
    })
    const accept = vi.fn(() => Promise.resolve())
    const onExtensionsOmitted = vi.fn()
    const transport = new ScriptedTransport([COMPANY_TEXT])

    await chunks(adapterOver(transport, {}, {
      prepare: () => Promise.resolve({ fields: { dsh_chat_completions_test: { version: 1 } }, accept }),
      onExtensionsOmitted,
    }).stream(request()))

    expect(transport.requests[0]?.body).not.toHaveProperty('dsh_chat_completions_test')
    expect(onExtensionsOmitted).toHaveBeenCalledExactlyOnceWith({
      provider: BUILT_IN_PROVIDER,
      model: 'company-v4',
      fields: ['dsh_chat_completions_test'],
      error: overflow,
    })
    // The omitted fields were never delivered, so nothing is committed for them.
    expect(accept).not.toHaveBeenCalled()
  })

  it('reads the transport catalog again on every resolution', async () => {
    const transport = new ScriptedTransport([COMPANY_TEXT])
    const adapter = adapterOver(transport)

    await expect(adapter.listModels(BUILT_IN_PROVIDER)).resolves.toEqual([
      { provider: BUILT_IN_PROVIDER, id: 'company-v4', name: 'Company V4', inputModalities: ['text'] },
    ])
    // A catalog change on the Control Plane reaches the next resolution, not the next restart.
    transport.catalog = [COMPANY_VISION]
    await expect(adapter.listModels(BUILT_IN_PROVIDER)).resolves.toEqual([
      { provider: BUILT_IN_PROVIDER, id: 'company-vision', name: 'Company Vision', inputModalities: ['text', 'image'] },
    ])
    await expect(adapter.resolveModel(BUILT_IN_PROVIDER, 'company-vision')).resolves.toMatchObject({
      name: 'Company Vision',
      inputModalities: ['text', 'image'],
    })
    await chunks(adapter.stream(request({ model: 'company-vision' })))
    expect(transport.listings).toBe(4)
  })

  it('binds a prepared call to the catalog it listed', async () => {
    const transport = new ScriptedTransport([COMPANY_VISION])
    const prepared = await adapterOver(transport).prepareCall(BUILT_IN_PROVIDER, 'company-vision')
    expect(prepared.model).toMatchObject({ id: 'company-vision', inputModalities: ['text', 'image'] })

    transport.catalog = []
    await chunks(prepared.stream(request({ model: 'company-vision' })))
    expect(transport.listings).toBe(1)
    expect(transport.requests).toHaveLength(1)
  })

  it('resolves a model from the transport catalog rather than the configured list', async () => {
    // The configured list names the same id text-only; the Control Plane's declaration is the one that counts.
    const adapter = adapterOver(new ScriptedTransport([COMPANY_VISION]), { models: [{ id: 'company-vision' }] })

    await expect(adapter.resolveModel(BUILT_IN_PROVIDER, 'company-vision')).resolves.toMatchObject({
      provider: BUILT_IN_PROVIDER,
      id: 'company-vision',
      name: 'Company Vision',
      inputModalities: ['text', 'image'],
    })
    // An id the Control Plane does not list is text-only.
    await expect(adapter.resolveModel(BUILT_IN_PROVIDER, 'unlisted')).resolves.toMatchObject({
      name: 'unlisted',
      inputModalities: ['text'],
    })
  })

  it('keeps the configured models when the transport leaves discovery to the adapter', async () => {
    const adapter = adapterOver(new ScriptedTransport(undefined), {
      models: [{ id: 'local-vision', inputModalities: ['text', 'image'] }],
    })

    await expect(adapter.listModels(BUILT_IN_PROVIDER)).resolves.toEqual([{
      provider: BUILT_IN_PROVIDER,
      id: 'local-vision',
      name: 'local-vision',
      inputModalities: ['text', 'image'],
    }])
    await expect(adapter.resolveModel(BUILT_IN_PROVIDER, 'local-vision')).resolves.toMatchObject({
      inputModalities: ['text', 'image'],
    })
    expect(visualTokens(adapter, 'local-vision')).toBeGreaterThan(0)
  })

  it('prices a model from the catalog the route last listed', async () => {
    const adapter = adapterOver(new ScriptedTransport([COMPANY_VISION]))

    // Nothing listed yet: the model is unknown here and prices as text-only.
    expect(visualTokens(adapter, 'company-vision')).toBe(0)
    await adapter.listModels(BUILT_IN_PROVIDER)
    expect(visualTokens(adapter, 'company-vision')).toBeGreaterThan(0)
  })

  it('prices descriptor text through the same image access the serializer uses', async () => {
    const attachments = requestImageStore(ref => Promise.resolve(requestImage(ref)))
    const adapter = adapterOver(new ScriptedTransport([COMPANY_VISION]), {}, {
      attachments,
      resolveImageAccess: (store, ref) => (store === attachments && ref === imageRef ? { readonlyPath: '/world/img.png' } : undefined),
    })
    await adapter.listModels(BUILT_IN_PROVIDER)

    const [priced] = adapter.imageRequestPricing(BUILT_IN_PROVIDER, 'company-vision')
      ?.priceImages([{ type: 'image', attachment: imageRef }]) ?? []
    expect(priced?.text).toContain('/world/img.png')
  })

  it('sends images inline as base64 to a model whose catalog entry declares image input', async () => {
    const transport = new ScriptedTransport([COMPANY_VISION])
    const readImageRequest = vi.fn((ref: ImageAttachmentRef) => Promise.resolve(requestImage(ref)))
    const adapter = adapterOver(transport, {}, {
      attachments: requestImageStore(readImageRequest),
      resolveImageAccess: () => ({ readonlyPath: '/world/img.png' }),
    })

    await chunks(adapter.stream(request({ model: 'company-vision', messages: [imageMessage] })))

    expect(readImageRequest).toHaveBeenCalledOnce()
    expect(transport.requests[0]?.body).toMatchObject({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: expect.stringContaining('/world/img.png') as string },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
        ],
      }],
    })
    expect(JSON.stringify(transport.requests[0]?.body)).not.toContain('file_id')
  })

  it('sends tool-message images after that tool message and an offloaded image as its placeholder', async () => {
    const transport = new ScriptedTransport([COMPANY_VISION])
    const readImageRequest = vi.fn((ref: ImageAttachmentRef) => Promise.resolve(requestImage(ref)))
    const adapter = adapterOver(transport, {}, { attachments: requestImageStore(readImageRequest) })
    const messages = [
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'image', attachment: imageRef, offloaded: true }] }),
      createToolResultMessage({
        callId: ToolCallId('call-1'),
        content: [{ type: 'text', text: 'caption' }, { type: 'image', attachment: imageRef }],
        isError: false,
      }),
    ]

    await chunks(adapter.stream(request({ model: 'company-vision', messages })))

    // Only the retained occurrence is prepared; the offloaded one travels as text.
    expect(readImageRequest).toHaveBeenCalledOnce()
    expect(transport.requests[0]?.body).toMatchObject({
      messages: [
        { role: 'user', content: expect.stringContaining('[image omitted') as string },
        { role: 'tool', tool_call_id: 'call-1', content: expect.stringMatching(/^caption\n/) as string },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Attached image(s) from tool result:' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
          ],
        },
      ],
    })
  })

  it('refuses an image for a model whose catalog entry does not declare it, before carrying anything', async () => {
    const transport = new ScriptedTransport([COMPANY_TEXT])
    const readImageRequest = vi.fn((ref: ImageAttachmentRef) => Promise.resolve(requestImage(ref)))
    const adapter = adapterOver(transport, {}, { attachments: requestImageStore(readImageRequest) })

    await expect(chunks(adapter.stream(request({ messages: [imageMessage] })))).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
      message: 'DeepSeek model "company-v4" does not accept image input.',
    })
    expect(transport.requests).toEqual([])
    expect(readImageRequest).not.toHaveBeenCalled()
  })

  it('refuses an image while no attachment service is mounted', async () => {
    const transport = new ScriptedTransport([COMPANY_VISION])

    await expect(chunks(adapterOver(transport).stream(request({ model: 'company-vision', messages: [imageMessage] }))))
      .rejects.toMatchObject({
        code: 'UNSUPPORTED_CONTENT',
        message: 'DeepSeek image conversion requires the durable attachment service.',
      })
    expect(transport.requests).toEqual([])
  })

  it('reports an answer that carried no body as EMPTY_RESPONSE', async () => {
    const transport = new ScriptedTransport([COMPANY_TEXT], () => Promise.resolve({
      status: 204,
      headers: {},
      body: Readable.from([]),
    }))

    await expect(chunks(adapterOver(transport).stream(request()))).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })

  it('reports an error status with the provider message, the mapped code, and the response facts', async () => {
    const raw = JSON.stringify({ error: { message: 'company quota window is full' } })
    const transport = new ScriptedTransport([COMPANY_TEXT], () => Promise.resolve({
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '2', 'x-request-id': 'req-429' },
      body: Readable.from([Buffer.from(raw)]),
    }))

    const failure = await chunks(adapterOver(transport).stream(request())).then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(LlmError)
    expect(failure).toMatchObject({
      message: 'company quota window is full',
      code: 'RATE_LIMIT',
      cause: { message: raw },
      failure: {
        message: 'company quota window is full',
        code: 'RATE_LIMIT',
        status: 429,
        providerRetryAfterMs: 2_000,
        requestId: ProviderRequestId('req-429'),
      },
    })
    expect(transport.requests).toHaveLength(1)
  })

  it('reads a future Retry-After HTTP date and the DeepSeek request-id header', async () => {
    const now = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const transport = new ScriptedTransport([COMPANY_TEXT], () => Promise.resolve({
      status: 503,
      headers: { 'retry-after': new Date(now + 3_000).toUTCString(), 'x-deepseek-request-id': 'deepseek-503' },
      body: Readable.from([Buffer.from(JSON.stringify({ error: { message: 'come back later' } }))]),
    }))

    await expect(chunks(adapterOver(transport).stream(request()))).rejects.toMatchObject({
      failure: {
        message: 'come back later',
        code: 'SERVER',
        status: 503,
        providerRetryAfterMs: 3_000,
        requestId: ProviderRequestId('deepseek-503'),
      },
    })
  })

  it.each(['0', '9'.repeat(400), 'not-a-date', new Date(0).toUTCString()])(
    'omits a Retry-After of %s that names no future delay',
    async (retryAfter) => {
      const transport = new ScriptedTransport([COMPANY_TEXT], () => Promise.resolve({
        status: 429,
        headers: { 'retry-after': retryAfter },
        body: Readable.from([Buffer.from(JSON.stringify({ error: { message: 'retry later' } }))]),
      }))

      const failure = await chunks(adapterOver(transport).stream(request())).then(() => undefined, (error: unknown) => error)
      expect(failure).toBeInstanceOf(LlmError)
      if (!(failure instanceof LlmError)) throw new Error('expected an LlmError')
      expect(failure.failure).toEqual({ message: 'retry later', code: 'RATE_LIMIT', status: 429 })
    },
  )

  it.each([
    [502, 'Bad Gateway', 'Bad Gateway'],
    [500, '', 'DeepSeek HTTP 500'],
  ])('keeps the status line when HTTP %d carries no JSON error body', async (status, body, cause) => {
    const transport = new ScriptedTransport([COMPANY_TEXT], () => Promise.resolve({
      status,
      headers: { 'content-type': 'text/plain' },
      body: Readable.from(body.length === 0 ? [] : [Buffer.from(body)]),
    }))

    await expect(chunks(adapterOver(transport).stream(request()))).rejects.toMatchObject({
      message: `DeepSeek API error (HTTP ${status})`,
      code: 'SERVER',
      cause: { message: cause },
    })
  })

  it('fails every operation with TRANSPORT while no transport is mounted', async () => {
    const adapter = adapterOver(undefined)
    const unavailable = { code: 'TRANSPORT', message: 'The built-in model transport is unavailable.' }

    await expect(adapter.listModels(BUILT_IN_PROVIDER)).rejects.toMatchObject(unavailable)
    await expect(adapter.resolveModel(BUILT_IN_PROVIDER, 'company-v4')).rejects.toMatchObject(unavailable)
    await expect(adapter.prepareCall(BUILT_IN_PROVIDER, 'company-v4')).rejects.toMatchObject(unavailable)
    await expect(chunks(adapter.stream(request()))).rejects.toMatchObject(unavailable)
  })

  it('reports a request the transport could not carry as TRANSPORT with the carrier failure as cause', async () => {
    const carrier = new TransportFailedError('unreachable', 'connect ECONNREFUSED')
    const transport = new ScriptedTransport([COMPANY_TEXT], () => Promise.reject(carrier))

    await expect(chunks(adapterOver(transport).stream(request()))).rejects.toMatchObject({
      code: 'TRANSPORT',
      message: 'DeepSeek request through the built-in model transport failed',
      cause: carrier,
    })
  })

  it('reports a body that fails mid-stream as TRANSPORT', async () => {
    const transport = new ScriptedTransport([COMPANY_TEXT], (carried) => {
      const body = heldOpen(carried)
      body.push('data: {"choices":[{"delta":{"content":"par"}}]}\n\n')
      setTimeout(() => { body.destroy(new Error('socket hang up')) }, 0)
      return Promise.resolve({ status: 200, headers: {}, body })
    })

    await expect(chunks(adapterOver(transport).stream(request()))).rejects.toMatchObject({
      code: 'TRANSPORT',
      message: 'DeepSeek stream through the built-in model transport failed',
    })
  })

  it('reports ABORTED when the caller aborts while the transport is carrying the request', async () => {
    const controller = new AbortController()
    const transport = new ScriptedTransport([COMPANY_TEXT], carried => new Promise((_resolve, reject) => {
      carried.signal?.addEventListener('abort', () => { reject(new Error('carried request aborted')) }, { once: true })
      controller.abort()
    }))

    await expect(chunks(adapterOver(transport).stream(request({ signal: controller.signal }))))
      .rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('stops the carried body and reports ABORTED when the caller aborts mid-stream', async () => {
    const controller = new AbortController()
    let body: Readable | undefined
    const transport = new ScriptedTransport([COMPANY_TEXT], (carried) => {
      body = heldOpen(carried)
      body.push('data: {"choices":[{"delta":{"content":"par"}}]}\n\n')
      return Promise.resolve({ status: 200, headers: {}, body })
    })
    const seen: string[] = []

    const run = (async () => {
      for await (const chunk of adapterOver(transport).stream(request({ signal: controller.signal }))) {
        seen.push(chunk.type)
        if (chunk.type === 'text-delta') controller.abort()
      }
    })()

    await expect(run).rejects.toMatchObject({ code: 'ABORTED' })
    expect(seen).toEqual(['block-start', 'text-delta'])
    expect(body?.destroyed).toBe(true)
  })

  it('stops the carried body and reports TIMEOUT when it stays idle past the watchdog', async () => {
    vi.useFakeTimers()
    let body: Readable | undefined
    const transport = new ScriptedTransport([COMPANY_TEXT], (carried) => {
      body = heldOpen(carried)
      return Promise.resolve({ status: 200, headers: {}, body })
    })

    const run = chunks(adapterOver(transport, { streamIdleTimeoutMs: 100 }).stream(request()))
    const rejected = expect(run).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    await rejected
    expect(body?.destroyed).toBe(true)
  })

  it('keeps an idle read alive through SSE comments', async () => {
    vi.useFakeTimers()
    const transport = new ScriptedTransport([COMPANY_TEXT], (carried) => {
      const body = heldOpen(carried)
      setTimeout(() => { body.push(': keep-alive\n\n') }, 75)
      setTimeout(() => { body.push(': keep-alive\n\n') }, 150)
      setTimeout(() => {
        body.push(SSE_TEXT)
        body.push(null)
      }, 225)
      return Promise.resolve({ status: 200, headers: {}, body })
    })

    const run = chunks(adapterOver(transport, { streamIdleTimeoutMs: 100 }).stream(request()))
    await vi.advanceTimersByTimeAsync(75)
    await vi.advanceTimersByTimeAsync(75)
    await vi.advanceTimersByTimeAsync(75)
    await expect(run.then(output => output.map(chunk => chunk.type)))
      .resolves.toEqual(['block-start', 'text-delta', 'block-end', 'usage', 'finish'])
  })
})

describe('HTTP status mapping', () => {
  it.each([
    [401, undefined, 'AUTH'],
    [403, undefined, 'AUTH'],
    [413, { code: 'context_length_exceeded' }, 'INVALID_REQUEST'],
    [429, { message: 'request rate limit exceeded' }, 'RATE_LIMIT'],
    [429, { code: 'insufficient_quota', message: 'account credits exhausted' }, QUOTA_EXCEEDED_CODE],
    [400, { message: 'request too large for model context' }, CONTEXT_WINDOW_EXCEEDED_CODE],
    [400, { message: 'invalid input: temperature exceeds maximum allowed value' }, 'INVALID_REQUEST'],
    [500, undefined, 'SERVER'],
    [503, undefined, 'SERVER'],
    [418, undefined, 'HTTP_418'],
  ])('maps HTTP %d with %j to %s', (status, error, code) => {
    expect(httpErrorCode(status, error)).toBe(code)
  })
})
