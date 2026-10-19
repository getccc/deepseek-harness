/**
 * The Control Plane's Runner-facing BI endpoints.
 *
 * Every route is arranged around one fact: a request must not be able to say
 * who is asking or where the answer comes from. The principal is recovered
 * from a verified device token and never read from a body; the source is
 * resolved from the catalog and has no place in a request at all.
 *
 * The protocol version is checked before any other field is decoded, so a
 * Runner this build cannot speak to is told to update rather than having its
 * fields interpreted under a grammar it did not mean.
 * @module @deepseek-ai/dsh-bi-gateway-http
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-device-authorization'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { BiChartRef, BiError, BiProjectRef, isBiChartRef, isBiProjectRef, type BiFailureReason } from '@deepseek-ai/dsh-bi'
import type {} from '@deepseek-ai/dsh-bi-gateway'
import {
  COMMON_REFUSAL_STATUS,
  governedHandler,
  readCount,
  type GovernedProtocol,
  type ParseRoute,
} from '@deepseek-ai/dsh-team-governed-wire'
import {
  BI_CATALOG_PATH,
  BI_CHARTS_PATH,
  BI_PROTOCOL_VERSION,
  BI_QUERY_PATH,
  MINIMUM_BI_PROTOCOL_VERSION,
} from './protocol.ts'

export { readCount } from '@deepseek-ai/dsh-team-governed-wire'
export {
  ACCESS_TOKEN_HEADER,
  BI_CATALOG_PATH,
  BI_CHARTS_PATH,
  BI_PROTOCOL_VERSION,
  BI_QUERY_PATH,
  MINIMUM_BI_PROTOCOL_VERSION,
  type BiProtocolRefusal,
  type BiRefusal,
  type CatalogBody,
  type ChartsBody,
  type QueryBody,
} from './protocol.ts'

/** Cordis plugin name. */
export const name = 'bi-gateway-http'
/** Services required before the endpoints may register. */
export const inject = ['webServer', 'biGateway', 'deviceAuthorization']

/** Plugin config: how much of a request the endpoints read. */
export interface Config {
  /** Largest request body accepted, in bytes. */
  maxRequestBodyBytes?: number
}

/** The largest request body accepted when a deployment names no bound. */
const DEFAULT_MAX_REQUEST_BODY_BYTES = 16 * 1024

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
 * them. A failed run answers as an upstream failure: the warehouse is upstream
 * of this Control Plane exactly as the BI service is, and a member can act on
 * neither beyond trying again or asking an administrator.
 */
const STATUS_BY_REASON: Readonly<Record<BiFailureReason, number>> = {
  ...COMMON_REFUSAL_STATUS,
  'chart-unavailable': 409,
  'query-failed': 502,
}

/** The most characters a listing keyword may carry, so a body's one free-text field stays a keyword. */
const MAX_QUERY_CHARS = 200

/** The wire facts this Control Plane answers BI requests under. */
const PROTOCOL: GovernedProtocol<BiFailureReason> = {
  scope: 'bi',
  minimum: MINIMUM_BI_PROTOCOL_VERSION,
  current: BI_PROTOCOL_VERSION,
  statusByReason: STATUS_BY_REASON,
}

/**
 * Read the keyword a listing narrows by, when the field carries one.
 *
 * A keyword is one line of bounded text; anything else is a protocol error.
 * An empty keyword is read as none, because it narrows nothing.
 * @param value - the decoded field.
 * @returns the keyword to pass on, absent when there is none, or `'invalid'`.
 */
export function readQuery(value: unknown): { readonly query?: string } | 'invalid' {
  if (value === undefined) return {}
  if (typeof value !== 'string' || value.length > MAX_QUERY_CHARS || /[\r\n]/u.test(value)) return 'invalid'
  return value.trim() === '' ? {} : { query: value }
}

/**
 * Register the Runner-facing BI endpoints.
 * @param ctx - Host plugin context carrying the web server, the gateway, and device authorization.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const { maxRequestBodyBytes: limit } = config as ResolvedConfig

  /** Serve one route under this capability's protocol. */
  const serve = (parse: ParseRoute) => governedHandler({
    reasonOf: error => error instanceof BiError ? error.reason : undefined,
    protocol: PROTOCOL,
    limit,
    verify: token => ctx.deviceAuthorization.verifyAccessToken(token),
  }, parse)

  const catalog: WebRoute = {
    kind: 'exact',
    path: BI_CATALOG_PATH,
    handler: serve(opened => async () => ({ entries: await ctx.biGateway.directory(opened.principal) })),
  }

  const charts: WebRoute = {
    kind: 'exact',
    path: BI_CHARTS_PATH,
    handler: serve((opened) => {
      const ref = opened.body['ref']
      const keyword = readQuery(opened.body['query'])
      const page = readCount(opened.body['page'])
      const pageSize = readCount(opened.body['pageSize'])
      if (typeof ref !== 'string' || !isBiProjectRef(ref) || keyword === 'invalid' || page === 'invalid' || pageSize === 'invalid') {
        return undefined
      }
      return () => ctx.biGateway.charts({
        ...opened.principal,
        ref: BiProjectRef(ref),
        ...keyword,
        ...(page === undefined ? {} : { page }),
        ...(pageSize === undefined ? {} : { pageSize }),
      })
    }),
  }

  const query: WebRoute = {
    kind: 'exact',
    path: BI_QUERY_PATH,
    handler: serve((opened) => {
      const chartRef = opened.body['chartRef']
      const rows = readCount(opened.body['limit'])
      if (typeof chartRef !== 'string' || !isBiChartRef(chartRef) || rows === 'invalid') return undefined
      return () => ctx.biGateway.query({
        ...opened.principal,
        chartRef: BiChartRef(chartRef),
        ...(rows === undefined ? {} : { limit: rows }),
      })
    }),
  }

  ctx.effect(() => ctx.webServer.register(catalog), 'bi-gateway-http: catalog route')
  ctx.effect(() => ctx.webServer.register(charts), 'bi-gateway-http: charts route')
  ctx.effect(() => ctx.webServer.register(query), 'bi-gateway-http: query route')
}
