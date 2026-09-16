/**
 * Register DeepSeek with protocol selection and request-local settings and
 * credentials. The member route is registered only while its credential
 * reference resolves, so a keyless composition advertises no DeepSeek models
 * and the route appears the moment a key is stored; a mounted LLM HTTP
 * transport adds the `built-in` route regardless. The registration-captured
 * facts — the route set and the retry policy — re-register in place when they
 * change.
 * @module @deepseek-ai/dsh-llm-deepseek
 */
import { FiberState, type Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-llm-http-transport'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { DeepSeekAdapter } from './adapter.ts'
import { BUILT_IN_PROVIDER } from './common/types.ts'
import { Config, resolveAdapterOptions } from './config.ts'
import type { ResolvedDeepSeekOptions } from './config.ts'

export { Config, resolveAdapterOptions, PUBLIC_BASE_URL, MESSAGES_BASE_URL } from './config.ts'
export type { ResolvedDeepSeekOptions } from './config.ts'
export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_FILE_EXPIRY_SECONDS,
  DEFAULT_FILE_QUOTA_CLEANUP_BATCH,
  DEFAULT_FILE_REFRESH_MARGIN_SECONDS,
  DEFAULT_FILES_API_TIMEOUT_MS,
  DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
  DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from './common/defaults.ts'
export { DeepSeekAdapter } from './adapter.ts'
export { BUILT_IN_PROVIDER } from './common/types.ts'
export type { DeepSeekProtocol } from './common/types.ts'
export type { DeepSeekAdapterOptions, DeepSeekCatalogModel, DeepSeekConnectionOptions } from './common/types.ts'
export {
  DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  DEFAULT_MAX_REQUEST_FILES_BYTES,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  REQUEST_IMAGE_MAX_DIMENSION,
  deepSeekImageRequestPricing,
  resolveRequestImageMaxBytes,
  resolveRequestImageTarget,
} from './common/request-pricing.ts'
export { deepSeekImageTokens, deepSeekRequestImageDimensions } from './common/image-tokens.ts'
export { DeepSeekFileStore, MAX_IMAGE_BYTES } from './common/file-store.ts'
export type { DeepSeekFileConnection, DeepSeekFilePolicy, DeepSeekFileReference } from './common/file-store.ts'
export { DeepSeekFilesClient, MAX_FILE_EXPIRY_SECONDS, MAX_FILE_UPLOAD_BYTES, MAX_STORED_FILE_BYTES, MAX_STORED_FILE_COUNT, MIN_FILE_EXPIRY_SECONDS } from './common/files-api.ts'
export type { DeepSeekFileObject, DeepSeekFilePage } from './common/files-api.ts'
export { DeepSeekFileId } from './common/file-id.ts'
export type { DeepSeekFileId as DeepSeekFileIdType } from './common/file-id.ts'
export { DeepSeekUploadIndex, deepSeekFileScope } from './common/upload-index.ts'
export type { DeepSeekUploadRecord } from './common/upload-index.ts'
export type { RequestDefaults } from './common/types.ts'
export type * from './protocols/chat-completions/types.ts'

export const name = 'llm-deepseek'
export const inject = ['llm']

const NS = 'llm-deepseek'
/** The member-configured provider route this plugin owns. */
const PROVIDER = 'deepseek-official'
/** Fiber states in which a late credential lookup must leave the registry alone. */
const INACTIVE_STATES: ReadonlySet<FiberState> = new Set([
  FiberState.UNLOADING,
  FiberState.DISPOSED,
  FiberState.FAILED,
])

export async function apply(ctx: Context, config: Config): Promise<void> {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: ResolvedDeepSeekOptions | undefined
  const options = (): ResolvedDeepSeekOptions => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx))
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      // Static composition resolves before anything registers, so this branch
      // only sees a live settings snapshot failing a beyond-schema bound:
      // keep serving the last good facts and say so once per bad snapshot.
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-deepseek: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  options()

  const resolveApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string> => {
    // Every credential fact comes from the caller's snapshot, so a rejected
    // settings generation cannot leak its key onto the previous endpoint.
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-deepseek', ref)
    } else {
      // Without the seam there is no managed store to rank against, so the
      // environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-deepseek', ref)
      }
    }
    throw new LlmError(
      `llm-deepseek: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  let userId: AnonymousUserId | undefined
  const resolveUserId = (): AnonymousUserId => userId ??= getOrCreateAnonymousUserId()
  const adapter = new DeepSeekAdapter({
    options,
    transport: provider => provider === BUILT_IN_PROVIDER
      ? ctx.get('llmHttpTransport')
      : undefined,
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(`llm-deepseek: unusable Messages replay state on assistant history for route "${provider}/${model}"; sending provider-neutral content (${reason})`)
    },
    resolveApiKey,
    resolveUserId,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    prepareExtensions: (request) => {
      const extensions = ctx.get('deepseekLlmApiExtensions')
      return extensions?.prepare(request)
        ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
    },
  })
  // The declaration outlives the route: it is what keeps the Models card and
  // the first-run key prompt reachable while the route below is dormant.
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'DeepSeek', settingsNs: NS, settingsPath: [] },
  ])

  // Whether the member route's reference resolves right now, read from the
  // same two planes `resolveApiKey` reads: the credentials seam when mounted,
  // otherwise the launching environment alone.
  const keyConfigured = async (): Promise<boolean> => {
    const ref = options().apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) return (await credentials.describe(ref)).configured
    const ambient = launchEnvironmentOf(ctx).get(ref)
    return ambient !== undefined && ambient.value.length > 0
  }
  // The member route follows its credential and the built-in route follows the
  // mounted transport, whose credential lives on the Control Plane; a selector
  // therefore never offers a route no request could reach.
  let memberKeyConfigured = false
  const providerRoutes = (): string[] => [
    ...memberKeyConfigured ? [PROVIDER] : [],
    ...ctx.get('llmHttpTransport') === undefined ? [] : [BUILT_IN_PROVIDER],
  ]
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below.
  let registration: AdapterRegistrationHandle | undefined
  let registeredFacts: { routes: string[]; retryPolicy: ResolvedRetryPolicy } | undefined
  const ensureRegistrationFacts = (): void => {
    const facts = { routes: providerRoutes(), retryPolicy: options().retryPolicy }
    if (deepEqualJson(facts, registeredFacts)) return
    // The registry captures the route set and the retry policy at
    // registration, so a change to either re-registers. `replace` re-reads
    // both in one synchronous registry section: disposing and re-registering
    // instead would publish an empty route set between the two, and an
    // observer that reacted to it would see this provider disappear and come
    // back. The registry refuses an empty first registration, so a dormant
    // plugin holds none until some route is on; `replace([])` then carries a
    // live registration through a later dormant stretch.
    if (registration === undefined) {
      if (facts.routes.length === 0) {
        registeredFacts = facts
        return
      }
      registration = ctx.llm.registerAdapter(facts.routes, adapter)
    } else {
      registration.replace(facts.routes)
    }
    registeredFacts = facts
  }
  // Credential lookups are asynchronous and may overlap: the latest one owns
  // the registry, and none of them touches it once this fiber is going away.
  let evaluation = 0
  const reevaluateMemberRoute = async (): Promise<void> => {
    const generation = ++evaluation
    const configured = await keyConfigured()
    if (generation !== evaluation || INACTIVE_STATES.has(ctx.fiber.state)) return
    memberKeyConfigured = configured
    ensureRegistrationFacts()
  }
  const reevaluateInBackground = (): void => {
    void reevaluateMemberRoute().catch((error: unknown) => {
      ctx.logger.error('llm-deepseek: keeping the previously registered routes after a refused update')
      ctx.logger.error(error)
    })
  }
  ctx.on('credentials/reference-updated', (ref) => {
    if (ref === options().apiKeyEnv) reevaluateInBackground()
  })
  // A credentials seam attaching or detaching changes which plane answers, so
  // the route is re-judged on both edges; the plugin's own unload is not one.
  ctx.inject(['credentials'], (scoped) => {
    reevaluateInBackground()
    scoped.effect(() => () => {
      if (!INACTIVE_STATES.has(ctx.fiber.state)) reevaluateInBackground()
    }, 'llm-deepseek: credentials seam detached')
  })

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      setSource: (source) => {
        current = source
      },
      onChange: () => {
        // A changed retry policy re-registers at once; a renamed reference is
        // re-judged behind it.
        ensureRegistrationFacts()
        reevaluateInBackground()
      },
    })
  })
  // Loading completes only once the route set is known, so a request issued
  // right after the plugin's own await never lands in an unregistered window.
  await reevaluateMemberRoute()
}
