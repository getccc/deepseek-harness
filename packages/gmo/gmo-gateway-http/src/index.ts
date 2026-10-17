/**
 * The Control Plane's Runner-facing GMO endpoints.
 *
 * Every route is arranged around one fact: a request must not be able to say
 * who is asking or where the answer comes from. The principal is recovered
 * from a verified device token and never read from a body; the source is
 * resolved from the catalog and has no place in a request at all.
 *
 * The protocol version is checked before any other field is decoded, so a
 * Runner this build cannot speak to is told to update rather than having its
 * fields interpreted under a grammar it did not mean.
 * @module @deepseek-ai/dsh-gmo-gateway-http
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-device-authorization'
import type {} from '@deepseek-ai/dsh-gmo-gateway'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  GmoCategoryRef,
  GmoError,
  GmoResultRef,
  isGmoCategoryRef,
  isGmoResultRef,
  readGmoCount,
  readGmoQuery,
  type GmoFailureReason,
} from '@deepseek-ai/dsh-gmo'
import {
  COMMON_REFUSAL_STATUS,
  governedHandler,
  type GovernedProtocol,
  type ParseRoute,
} from '@deepseek-ai/dsh-team-governed-wire'
import {
  GMO_ASK_PATH,
  GMO_CATALOG_PATH,
  GMO_DESCRIBE_PATH,
  GMO_PROTOCOL_VERSION,
  GMO_RESULTS_PATH,
  MINIMUM_GMO_PROTOCOL_VERSION,
} from './protocol.ts'

export {
  readGmoCount as readCount,
  readGmoFilters as readFilters,
  readGmoQuery as readAskQuery,
} from '@deepseek-ai/dsh-gmo'
export {
  ACCESS_TOKEN_HEADER,
  GMO_ASK_PATH,
  GMO_CATALOG_PATH,
  GMO_DESCRIBE_PATH,
  GMO_PROTOCOL_VERSION,
  GMO_RESULTS_PATH,
  MINIMUM_GMO_PROTOCOL_VERSION,
  type AskBody,
  type CatalogBody,
  type DescribeBody,
  type GmoProtocolRefusal,
  type GmoRefusal,
  type ResultsBody,
} from './protocol.ts'

/** Cordis plugin name. */
export const name = 'gmo-gateway-http'
/** Services required before the endpoints may register. */
export const inject = ['webServer', 'gmoGateway', 'deviceAuthorization']

/** Plugin config: how much of a request the endpoints read. */
export interface Config {
  /** Largest request body accepted, in bytes. */
  maxRequestBodyBytes?: number
}

/** The largest request body accepted when a deployment names no bound; a filter may list many values. */
const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/** {@link Config} once schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/**
 * The HTTP status one closed refusal reason answers with.
 *
 * The words every capability shares keep the statuses the governed wire gives
 * them. A question the source refused, a result it does not hold, and a view it
 * does not have are the member's to change, so they answer as conflicts with
 * the request rather than as failures.
 */
const STATUS_BY_REASON: Readonly<Record<GmoFailureReason, number>> = {
  ...COMMON_REFUSAL_STATUS,
  'result-unavailable': 409,
  'unsupported': 409,
  'invalid-query': 422,
  'too-large': 413,
}

/** The wire facts this Control Plane answers GMO requests under. */
const PROTOCOL: GovernedProtocol<GmoFailureReason> = {
  scope: 'gmo',
  minimum: MINIMUM_GMO_PROTOCOL_VERSION,
  current: GMO_PROTOCOL_VERSION,
  statusByReason: STATUS_BY_REASON,
}

/**
 * Register the Runner-facing GMO endpoints.
 * @param ctx - Host plugin context carrying the web server, the gateway, and device authorization.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const { maxRequestBodyBytes: limit } = config as ResolvedConfig

  /** Serve one route under this capability's protocol. */
  const serve = (parse: ParseRoute) => governedHandler({
    reasonOf: error => error instanceof GmoError ? error.reason : undefined,
    protocol: PROTOCOL,
    limit,
    verify: token => ctx.deviceAuthorization.verifyAccessToken(token),
  }, parse)

  const catalog: WebRoute = {
    kind: 'exact',
    path: GMO_CATALOG_PATH,
    handler: serve(opened => async () => ({ entries: await ctx.gmoGateway.directory(opened.principal) })),
  }

  const results: WebRoute = {
    kind: 'exact',
    path: GMO_RESULTS_PATH,
    handler: serve((opened) => {
      const ref = opened.body['ref']
      const page = readGmoCount(opened.body['page'])
      const pageSize = readGmoCount(opened.body['pageSize'])
      if (typeof ref !== 'string' || !isGmoCategoryRef(ref) || page === 'invalid' || pageSize === 'invalid') return undefined
      return () => ctx.gmoGateway.results({
        ...opened.principal,
        ref: GmoCategoryRef(ref),
        ...(page === undefined ? {} : { page }),
        ...(pageSize === undefined ? {} : { pageSize }),
      })
    }),
  }

  const describe: WebRoute = {
    kind: 'exact',
    path: GMO_DESCRIBE_PATH,
    handler: serve((opened) => {
      const resultRef = opened.body['resultRef']
      if (typeof resultRef !== 'string' || !isGmoResultRef(resultRef)) return undefined
      return () => ctx.gmoGateway.describe({ ...opened.principal, resultRef: GmoResultRef(resultRef) })
    }),
  }

  const ask: WebRoute = {
    kind: 'exact',
    path: GMO_ASK_PATH,
    handler: serve((opened) => {
      const resultRef = opened.body['resultRef']
      const query = readGmoQuery(opened.body['query'])
      if (typeof resultRef !== 'string' || !isGmoResultRef(resultRef) || query === 'invalid') return undefined
      return () => ctx.gmoGateway.ask({ ...opened.principal, resultRef: GmoResultRef(resultRef), query })
    }),
  }

  ctx.effect(() => ctx.webServer.register(catalog), 'gmo-gateway-http: catalog route')
  ctx.effect(() => ctx.webServer.register(results), 'gmo-gateway-http: results route')
  ctx.effect(() => ctx.webServer.register(describe), 'gmo-gateway-http: describe route')
  ctx.effect(() => ctx.webServer.register(ask), 'gmo-gateway-http: ask route')
}
