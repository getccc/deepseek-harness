/**
 * API-key authentication, discovery, and the official model listing for the
 * official DeepSeek route, plus the `built-in` route a mounted LLM HTTP
 * transport supplies. The member
 * route is registered only while its credential reference resolves, so a
 * keyless composition advertises no DeepSeek models and the route appears the
 * moment a key is stored; the built-in route follows the transport, whose
 * credential lives on the Control Plane. Each registration re-registers in
 * place when its route set or retry policy changes.
 * @module @deepseek-ai/dsh-llm-deepseek-api-key
 */
import { FiberState, type Context } from '@deepseek-ai/cordis'
import { APP_IDENTITY, assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, LlmAdapter, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm-http-transport'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import {
  BUILT_IN_PROVIDER, catalogModelInfo, createBuiltInAdapter, createDeepSeekAdapter, ModelListingCache, refuseListedModel,
  requestModelListing, resolveListedCatalog,
} from '@deepseek-ai/dsh-llm-deepseek'
import type { CatalogRefusal, DeepSeekCatalogModel, ListingView, ModelListing } from '@deepseek-ai/dsh-llm-deepseek'
import { Config, plainOptions, resolveAdapterOptions } from './config.ts'
import type { ResolvedDeepSeekOptions } from './config.ts'

export { Config, plainOptions, resolveAdapterOptions } from './config.ts'
export type { Options, ResolvedDeepSeekOptions } from './config.ts'
export const name = 'llm-deepseek-api-key'
export const inject = ['llm']

const PROVIDER = 'deepseek-official'
/** Fiber states in which a late credential lookup must leave the registry alone. */
const INACTIVE_STATES: ReadonlySet<FiberState> = new Set([
  FiberState.UNLOADING,
  FiberState.DISPOSED,
  FiberState.FAILED,
])
/** Console tag of listing diagnostics; product profiles mount no console exporter for `ctx.logger`. */
const LOG_TAG = '[llm-deepseek-api-key]'

/** Connection facts of one operation: protocol settings plus the catalog resolved with them. */
interface OfficialConnection extends ResolvedDeepSeekOptions {
  /** Selectable models: the configured catalog, or the offered part of the followed listing. */
  readonly offered: readonly DeepSeekCatalogModel[]
  /** Listed models refused before network I/O, by id. */
  readonly refusals: ReadonlyMap<string, CatalogRefusal>
}

/**
 * One adapter's registration, holding whatever route set it was last given.
 * The registry captures the route set and the retry policy at registration,
 * so a change to either re-registers through `replace`, which swaps in one
 * synchronous registry section: disposing and re-registering instead would
 * publish an empty route set between the two. The registry refuses an empty
 * first registration, so none is made until some route is on; `replace([])`
 * then carries a live registration through a later empty stretch.
 */
function routeRegistration(ctx: Context, adapter: LlmAdapter, retryPolicy: () => ResolvedRetryPolicy): (routes: string[]) => void {
  let registration: AdapterRegistrationHandle | undefined
  let registered: { routes: string[]; retryPolicy: ResolvedRetryPolicy } | undefined
  return (routes) => {
    const facts = { routes, retryPolicy: retryPolicy() }
    if (deepEqualJson(facts, registered)) return
    if (registration === undefined) {
      if (routes.length > 0) registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registered = facts
  }
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const options = () => resolveAdapterOptions(plainOptions(config), launchEnvironmentOf(ctx))
  options()
  const resolveApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string> => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-deepseek', ref)
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) return assertUsableApiKey(ambient.value, 'llm-deepseek', ref)
    }
    throw new LlmError(
      `llm-deepseek: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }
  /** The API key, or `undefined` when none is configured; other credential failures propagate. */
  const presentApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string | undefined> => {
    try { return await resolveApiKey(connection) }
    catch (error) {
      if (error instanceof LlmError && error.code === 'MISSING_CREDENTIAL') return undefined
      throw error
    }
  }
  const listings = new ModelListingCache({
    credential: async () => presentApiKey(options()),
    load: (url, apiKey, signal) => requestModelListing(url, { 'x-api-key': apiKey }, signal),
    now: () => Date.now(),
    // ACP reserves stdout for protocol messages, including during successful catalog loads.
    info: (message) => { console.error(LOG_TAG, message) },
    warn: (message) => { console.warn(LOG_TAG, message) },
  })
  let reportedListing: ModelListing | undefined
  /** Resolve the catalog of one operation, reporting each listing's hidden entries once. */
  const connectionOf = (connection: ResolvedDeepSeekOptions, view: ListingView | undefined): OfficialConnection => {
    if (view === undefined) return { ...connection, offered: connection.models, refusals: new Map() }
    const catalog = resolveListedCatalog({
      listing: view.listing?.entries,
      supported: connection.models,
      overrides: {},
      routeMaxTokens: connection.maxTokens,
      clientVersion: APP_IDENTITY.version,
    })
    if (view.listing !== reportedListing) {
      reportedListing = view.listing
      for (const problem of catalog.problems) console.warn(LOG_TAG, problem)
    }
    return { ...connection, models: catalog.resolution, offered: catalog.offered, refusals: catalog.refusals }
  }
  // The declaration outlives the route: it is what keeps the Models card and
  // the first-run key prompt reachable while the route below is dormant.
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'DeepSeek', settingsNs: ctx.fiber.entry?.options.id ?? name, settingsPath: [] },
  ])
  const retryPolicy = (): ResolvedRetryPolicy => options().retryPolicy

  const member = routeRegistration(ctx, createDeepSeekAdapter<OfficialConnection>(ctx, {
    providerName: 'DeepSeek',
    options: () => {
      const connection = options()
      return connectionOf(connection, connection.listing === undefined ? undefined : listings.current())
    },
    connect: async (signal) => {
      const connection = options()
      if (connection.listing === undefined) return connectionOf(connection, undefined)
      let view: ListingView
      try { view = await listings.view(connection.listing, signal) }
      catch (error) {
        if (signal?.aborted === true) throw error
        // The cache keeps the previous credential's listing when this lookup fails, so gate nothing;
        // `resolveAuth` reports the failure on the model request, after the turn records the prompt.
        return connectionOf(connection, undefined)
      }
      return connectionOf(connection, view)
    },
    resolveAuth: async connection => ({ headers: { 'x-api-key': await resolveApiKey(connection) } }),
    admit: (connection, model) => { refuseListedModel(model, connection.refusals.get(model)) },
    // The route is registered only while a key is present, so discovery lists the catalog without
    // judging the key; a key no request header can carry is reported by the model request.
    discoverModels: async (provider) => {
      const connection = options()
      if (connection.listing === undefined) return connection.models.map(model => catalogModelInfo(provider, model))
      let view: ListingView
      try { view = await listings.view(connection.listing) }
      catch (error) {
        if (error instanceof LlmError && error.code === 'INVALID_CREDENTIAL') {
          return connection.models.map(model => catalogModelInfo(provider, model))
        }
        throw error
      }
      return view.authenticated ? connectionOf(connection, view).offered.map(model => catalogModelInfo(provider, model)) : []
    },
  }), retryPolicy)
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
  let memberKeyConfigured = false
  const syncMember = (): void => { member(memberKeyConfigured ? [PROVIDER] : []) }
  // Credential lookups are asynchronous and may overlap: the latest one owns
  // the registry, and none of them touches it once this fiber is going away.
  let evaluation = 0
  const reevaluateMemberRoute = async (): Promise<void> => {
    const generation = ++evaluation
    const configured = await keyConfigured()
    if (generation !== evaluation || INACTIVE_STATES.has(ctx.fiber.state)) return
    memberKeyConfigured = configured
    syncMember()
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

  // The built-in route lives exactly as long as the transport that carries it.
  let syncBuiltIn: (() => void) | undefined
  ctx.inject(['llmHttpTransport'], (scoped) => {
    const builtIn = routeRegistration(scoped, createBuiltInAdapter(scoped, {
      options, transport: () => scoped.get('llmHttpTransport'),
    }), retryPolicy)
    syncBuiltIn = () => { builtIn([BUILT_IN_PROVIDER]) }
    syncBuiltIn()
    scoped.effect(() => () => { syncBuiltIn = undefined }, 'llm-deepseek: built-in transport detached')
  })

  // Starting or stopping to follow the listing discards it, so restoring the built-in
  // catalog after a customization reloads the listing on the next access.
  let following = options().listing !== undefined
  ctx.on('loader/volatile-update', () => {
    let next: boolean
    try { next = options().listing !== undefined }
    catch (error) { ctx.logger.warn(error); return }
    if (next !== following) listings.invalidate()
    following = next
    // A changed retry policy re-registers at once; a renamed reference is
    // re-judged behind it.
    syncMember()
    syncBuiltIn?.()
    reevaluateInBackground()
  })
  ctx.effect(() => () => { listings.dispose() }, 'llm-deepseek-api-key: model listing')
  // Loading completes only once the route set is known, so a request issued
  // right after the plugin's own await never lands in an unregistered window.
  await reevaluateMemberRoute()
}
