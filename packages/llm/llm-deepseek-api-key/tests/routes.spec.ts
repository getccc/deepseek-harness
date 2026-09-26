/**
 * The routes this plugin registers: the member `deepseek-official` route only
 * while its credential reference resolves, and the `built-in` route only while
 * an LLM HTTP transport is mounted.
 */
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { FinishReason, LlmProviderInfo } from '@deepseek-ai/dsh-llm'
import { CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialInfo, CredentialRecord, CredentialRecordEntry, CredentialRecordInfo, CredentialRef, ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { LlmHttpTransport } from '@deepseek-ai/dsh-llm-http-transport'
import type { TransportModel, TransportRequest, TransportResponse } from '@deepseek-ai/dsh-llm-http-transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import * as ApiKey from '../src/index.ts'

const KEY_REF = credentialRef('DEEPSEEK_API_KEY')
const MEMBER: LlmProviderInfo = { id: 'deepseek-official', name: 'DeepSeek' }
const BUILT_IN: LlmProviderInfo = { id: 'built-in', name: 'Built-in Models', category: 'built-in' }
/** Without a Loader entry the settings namespace is the plugin name. */
const DECLARED = { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek-api-key', settingsPath: [] }
const COMPANY_MODEL: TransportModel = { id: 'company-v4', name: 'Company V4', inputModalities: ['text'] }
const CONFIGURED: CredentialInfo = { configured: true, source: 'memory', writable: true }
const UNCONFIGURED: CredentialInfo = { configured: false, writable: true }

/** One complete Chat Completions text generation, as SSE bytes. */
const SSE_TEXT = [
  '{"choices":[{"delta":{"content":"hello"}}]}',
  '{"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
  '[DONE]',
].map(data => `data: ${data}\n\n`).join('')

/** How a scripted credentials seam answers `describe`. */
interface CredentialScript {
  describe: (ref: CredentialRef) => Promise<CredentialInfo>
}

/**
 * A credentials seam whose `describe` answers a test scripts and whose commit
 * notification a test raises by hand. It resolves no value, so a request on a
 * route it reported configured reaches the missing-credential failure.
 */
class ScriptedCredentials extends CredentialProvider {
  constructor(ctx: Context, private readonly script: CredentialScript) {
    super(ctx)
  }

  override resolve(): Promise<ResolvedCredential | undefined> {
    return Promise.resolve(undefined)
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    return this.script.describe(ref)
  }

  override set(): Promise<void> {
    return Promise.reject(new Error('ScriptedCredentials: writes are not scripted'))
  }

  override unset(): Promise<void> {
    return Promise.reject(new Error('ScriptedCredentials: writes are not scripted'))
  }

  override readRecord(): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined)
  }

  override describeRecord(): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: false })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([])
  }

  override modifyRecord(): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined)
  }

  override deleteRecord(): Promise<void> {
    return Promise.resolve()
  }

  /** Raise the seam's commit notification for `ref`. */
  announce(ref: CredentialRef): void {
    this.notifyUpdated(ref)
  }
}

/** The catalog a scripted transport lists. */
interface TransportScript {
  models: readonly TransportModel[] | undefined
}

/** A mounted transport listing a scripted catalog and answering every request with one text generation. */
class ScriptedTransport extends LlmHttpTransport {
  readonly requests: TransportRequest[] = []

  constructor(ctx: Context, private readonly script: TransportScript) {
    super(ctx)
  }

  override send(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request)
    return Promise.resolve({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: Readable.from([Buffer.from(SSE_TEXT)]),
    })
  }

  override listModels(): Promise<readonly TransportModel[] | undefined> {
    return Promise.resolve(this.script.models)
  }
}

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function runtime(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  return ctx
}

/** Registered routes ordered by id, independent of which registration landed first. */
function providers(ctx: Context): LlmProviderInfo[] {
  return ctx.llm.listProviders().sort((left, right) => left.id.localeCompare(right.id))
}

function seamOf(ctx: Context): ScriptedCredentials {
  const seam = ctx.get('credentials')
  if (!(seam instanceof ScriptedCredentials)) throw new Error('the scripted credentials seam is not mounted')
  return seam
}

function transportOf(ctx: Context): ScriptedTransport {
  const transport = ctx.get('llmHttpTransport')
  if (!(transport instanceof ScriptedTransport)) throw new Error('the scripted transport is not mounted')
  return transport
}

/** Stream one empty request and return how it finished. */
async function finishOf(ctx: Context, provider: string, model: string): Promise<FinishReason> {
  let finish: FinishReason | undefined
  for await (const chunk of ctx.llm.stream({ provider, model, messages: [] })) {
    if (chunk.type === 'finish') finish = chunk.reason
  }
  if (finish === undefined) throw new Error('the stream ended without a finish chunk')
  return finish
}

async function failureMessageOf(ctx: Context, provider: string, model: string, code: string): Promise<string> {
  const finish = await finishOf(ctx, provider, model)
  expect(finish).toMatchObject({ kind: 'error', failure: { code } })
  if (finish.kind !== 'error') throw new Error('expected an error finish')
  return finish.failure.message
}

function tick(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

describe('the member route', () => {
  it.each([['unset', undefined], ['empty', '']])(
    'stays dormant while the ambient key is %s, keeping the provider declared',
    async (_state, value) => {
      vi.stubEnv('DEEPSEEK_API_KEY', value)
      const ctx = await runtime()
      await ctx.plugin(ApiKey, {})

      // A selector is offered no model no request could reach, while the
      // configurable declaration keeps the key entry point open.
      expect(ctx.llm.listProviders()).toEqual([])
      expect(ctx.llm.listConfigurableProviders()).toEqual([DECLARED])
      // The registry's failure points at the section that activates the route.
      expect(await failureMessageOf(ctx, 'deepseek-official', 'deepseek-flash', 'NO_ADAPTER'))
        .toContain('the "llm-deepseek-api-key" settings section declares it')
    },
  )

  it('registers only while the credentials seam reports its reference configured', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    let stored = false
    const ctx = await runtime()
    await ctx.plugin(ScriptedCredentials, {
      describe: ref => Promise.resolve(ref === KEY_REF && stored ? CONFIGURED : UNCONFIGURED),
    })
    await ctx.plugin(ApiKey, {})
    expect(ctx.llm.listProviders()).toEqual([])
    const observed: string[][] = []
    ctx.on('llm/adapters-updated', () => {
      observed.push(ctx.llm.listProviders().map(provider => provider.id))
    })
    const seam = seamOf(ctx)

    // Another reference's commit is not this route's business, even once the
    // seam would answer differently.
    stored = true
    seam.announce(credentialRef('OTHER_API_KEY'))
    await tick()
    expect(observed).toEqual([])

    seam.announce(KEY_REF)
    await vi.waitFor(() => { expect(providers(ctx)).toEqual([MEMBER]) })
    stored = false
    seam.announce(KEY_REF)
    await vi.waitFor(() => { expect(ctx.llm.listProviders()).toEqual([]) })
    // The registration outlives the dormant stretch, so the next key lands in
    // place rather than through a second first registration.
    stored = true
    seam.announce(KEY_REF)
    await vi.waitFor(() => { expect(providers(ctx)).toEqual([MEMBER]) })
    expect(observed).toEqual([['deepseek-official'], [], ['deepseek-official']])
  })

  it('re-judges the route when the credentials seam detaches or attaches', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const script: CredentialScript = { describe: () => Promise.resolve(CONFIGURED) }
    const ctx = await runtime()
    const seam = await ctx.plugin(ScriptedCredentials, script)
    await ctx.plugin(ApiKey, {})
    expect(providers(ctx)).toEqual([MEMBER])

    // Without the seam the environment is the whole plane, and it holds nothing.
    await seam.dispose()
    await vi.waitFor(() => { expect(ctx.llm.listProviders()).toEqual([]) })
    // A seam arriving later answers for the route again.
    await ctx.plugin(ScriptedCredentials, script)
    await vi.waitFor(() => { expect(providers(ctx)).toEqual([MEMBER]) })
  })

  it('keeps the registered routes and logs when a credential lookup fails', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    let describe: CredentialScript['describe'] = () => Promise.resolve(CONFIGURED)
    const ctx = await runtime()
    await ctx.plugin(ScriptedCredentials, { describe: ref => describe(ref) })
    await ctx.plugin(ApiKey, {})
    const error = vi.spyOn(ctx.logger, 'error').mockImplementation(() => undefined)

    describe = () => Promise.reject(new Error('store unreadable'))
    seamOf(ctx).announce(KEY_REF)
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith('llm-deepseek: keeping the previously registered routes after a refused update')
    })
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'store unreadable' }))
    expect(providers(ctx)).toEqual([MEMBER])
  })

  it('fails a request with MISSING_CREDENTIAL when the seam reports the reference configured but resolves no key', async () => {
    // Registration follows `describe`; the request resolves the value. A seam
    // whose answers disagree reaches the same guidance an ambient key's
    // disappearance does.
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const ctx = await runtime()
    await ctx.plugin(ScriptedCredentials, { describe: () => Promise.resolve(CONFIGURED) })
    await ctx.plugin(ApiKey, { baseURL: 'http://127.0.0.1:1' })
    expect(providers(ctx)).toEqual([MEMBER])

    await failureMessageOf(ctx, 'deepseek-official', 'deepseek-flash', 'MISSING_CREDENTIAL')
  })

  it('lets the latest lookup own the registry and none of them touch it after unload', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const pending: Array<(info: CredentialInfo) => void> = []
    const ctx = await runtime()
    await ctx.plugin(ScriptedCredentials, {
      describe: () => new Promise((resolve) => { pending.push(resolve) }),
    })
    const loading = ctx.plugin(ApiKey, {})
    // Both load-time lookups (the awaited one and the seam scope's) are still
    // open; answering the older one first must not register anything.
    await vi.waitFor(() => { expect(pending).toHaveLength(2) })
    pending[0]!(CONFIGURED)
    await tick()
    expect(ctx.llm.listProviders()).toEqual([])
    pending[1]!(CONFIGURED)
    const fiber = await loading
    await vi.waitFor(() => { expect(providers(ctx)).toEqual([MEMBER]) })

    const error = vi.spyOn(ctx.logger, 'error').mockImplementation(() => undefined)
    seamOf(ctx).announce(KEY_REF)
    await vi.waitFor(() => { expect(pending).toHaveLength(3) })
    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    pending[2]!(CONFIGURED)
    await tick()
    expect(ctx.llm.listProviders()).toEqual([])
    expect(error).not.toHaveBeenCalled()
  })

  it('follows a renamed credential reference from the settings section', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const ctx = await runtime()
    await ctx.plugin(ScriptedCredentials, {
      describe: ref => Promise.resolve(ref === credentialRef('MEMBER_DEEPSEEK_KEY') ? CONFIGURED : UNCONFIGURED),
    })
    const live = await liveConfig(ctx, ApiKey, {})
    // A key under a name the section does not point at is no key.
    expect(ctx.llm.listProviders()).toEqual([])

    await live.update({ apiKeyEnv: 'MEMBER_DEEPSEEK_KEY' })
    await vi.waitFor(() => { expect(providers(ctx)).toEqual([MEMBER]) })
  })
})

describe('the built-in route', () => {
  it('serves only the transport catalog while the member key is absent', async () => {
    // The Team Runner's ordinary posture: the company route is on, and a
    // member who stored no DeepSeek key is offered no DeepSeek models.
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const ctx = await runtime()
    await ctx.plugin(ScriptedTransport, { models: [COMPANY_MODEL] })
    await ctx.plugin(ApiKey, {})

    expect(providers(ctx)).toEqual([BUILT_IN])
    await expect(ctx.llm.listModels('built-in')).resolves.toEqual([
      { provider: 'built-in', id: 'company-v4', name: 'Company V4', inputModalities: ['text'] },
    ])
    expect(ctx.llm.listConfigurableProviders()).toEqual([DECLARED])
  })

  it('keeps the member catalog beside the transport catalog, both under the configured retry policy', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    const ctx = await runtime()
    await ctx.plugin(ScriptedTransport, { models: [COMPANY_MODEL] })
    await ctx.plugin(ApiKey, {
      retryPolicy: { mode: 'always', backoff: { initialDelayMs: 25, maxDelayMs: 100, jitterRatio: 0.2 } },
    })

    expect(providers(ctx)).toEqual([BUILT_IN, MEMBER])
    await expect(ctx.llm.listModels('deepseek-official')).resolves.toHaveLength(2)
    await expect(ctx.llm.listModels('built-in')).resolves.toEqual([
      { provider: 'built-in', id: 'company-v4', name: 'Company V4', inputModalities: ['text'] },
    ])
    const policy = { mode: 'always', initialDelayMs: 25, maxDelayMs: 100, jitterRatio: 0.2 }
    expect(ctx.llm.providerRetryPolicy('deepseek-official')).toEqual(policy)
    expect(ctx.llm.providerRetryPolicy('built-in')).toEqual(policy)
  })

  it('carries a built-in request through the mounted transport', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const ctx = await runtime()
    await ctx.plugin(ScriptedTransport, { models: [COMPANY_MODEL] })
    await ctx.plugin(ApiKey, {})

    await expect(finishOf(ctx, 'built-in', 'company-v4')).resolves.toEqual({ kind: 'stop' })
    expect(transportOf(ctx).requests).toEqual([
      expect.objectContaining({ operation: 'chat.completions', modelRef: 'company-v4' }),
    ])
  })

  it('releases the route with its transport and registers it again when a transport returns', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
    const ctx = await runtime()
    const transport = await ctx.plugin(ScriptedTransport, { models: [COMPANY_MODEL] })
    await ctx.plugin(ApiKey, {})
    expect(providers(ctx)).toEqual([BUILT_IN, MEMBER])

    await transport.dispose()
    await vi.waitFor(() => { expect(providers(ctx)).toEqual([MEMBER]) })
    // The built-in route is not a configurable provider, so its miss names no settings section.
    expect(await failureMessageOf(ctx, 'built-in', 'company-v4', 'NO_ADAPTER'))
      .toBe('no adapter registered for provider "built-in"')

    await ctx.plugin(ScriptedTransport, { models: [COMPANY_MODEL] })
    await vi.waitFor(() => { expect(providers(ctx)).toEqual([BUILT_IN, MEMBER]) })
  })
})
