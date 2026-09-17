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

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-device-authorization'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { BiChartRef, BiError, BiProjectRef, isBiChartRef, isBiProjectRef, type BiFailureReason } from '@deepseek-ai/dsh-bi'
import type { BiPrincipal } from '@deepseek-ai/dsh-bi-gateway'
import {
  ACCESS_TOKEN_HEADER,
  BI_CATALOG_PATH,
  BI_CHARTS_PATH,
  BI_PROTOCOL_VERSION,
  BI_QUERY_PATH,
  MINIMUM_BI_PROTOCOL_VERSION,
} from './protocol.ts'

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
 * A failed run answers as an upstream failure: the warehouse is upstream of
 * this Control Plane exactly as the BI service is, and a member can act on
 * neither beyond trying again or asking an administrator.
 */
const STATUS_BY_REASON: Readonly<Record<BiFailureReason, number>> = {
  'unauthenticated': 401,
  'not-allowed': 403,
  'scope-unavailable': 409,
  'chart-unavailable': 409,
  'query-failed': 502,
  'upstream-unavailable': 502,
  'upstream-invalid': 502,
  'control-plane-unreachable': 503,
  'update-required': 426,
  'cancelled': 499,
}

/** The most characters a listing keyword may carry, so a body's one free-text field stays a keyword. */
const MAX_QUERY_CHARS = 200

/** Write one JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Refuse with a closed BI reason and the status it maps to. */
function refuse(res: ServerResponse, reason: BiFailureReason): void {
  json(res, STATUS_BY_REASON[reason], { error: 'bi', reason })
}

/**
 * The bearer token a request carries, when it carries one.
 *
 * `node:http` joins repeated `authorization` headers into one comma-separated
 * string rather than an array, so a request that sent two does not match the
 * prefix and reads as carrying none.
 */
function bearer(req: IncomingMessage): string | undefined {
  const value = req.headers[ACCESS_TOKEN_HEADER]
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : undefined
}

/** Read a bounded JSON object body, or undefined when it is not one. */
async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > limit) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    // A body that is not JSON is a proxy error page or a truncated request;
    // either way this build cannot read it, and the parser's own message
    // describes our parse rather than the caller's mistake.
    return undefined
  }
}

/**
 * Read a whole page number, page size, or row bound, when the field carries one.
 *
 * Absent is a valid request, the gateway supplies its own default, so the
 * answer distinguishes "not given" from "not a number this build accepts",
 * which is a protocol error rather than an authorization outcome.
 * @param value - the decoded field.
 * @returns the number, `undefined` when the field is absent, or `'invalid'`.
 */
export function readCount(value: unknown): number | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return 'invalid'
  return value
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

  /**
   * Everything the routes do before they diverge: method, body, protocol
   * version, then identity. The version is checked before any other field is
   * read, and identity before any operation is attempted.
   */
  async function open(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ body: Record<string, unknown>; principal: BiPrincipal } | undefined> {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return undefined
    }
    const body = await readJson(req, limit)
    if (body === undefined) {
      json(res, 400, { error: 'malformed' })
      return undefined
    }
    const version = body['protocolVersion']
    if (typeof version !== 'number' || version < MINIMUM_BI_PROTOCOL_VERSION || version > BI_PROTOCOL_VERSION) {
      json(res, 426, {
        error: 'bi',
        reason: 'update-required',
        minimum: MINIMUM_BI_PROTOCOL_VERSION,
        current: BI_PROTOCOL_VERSION,
      })
      return undefined
    }
    const token = bearer(req)
    const claims = token === undefined ? undefined : await ctx.deviceAuthorization.verifyAccessToken(token)
    if (claims === undefined) {
      refuse(res, 'unauthenticated')
      return undefined
    }
    return {
      body,
      principal: {
        orgId: claims.orgId,
        principalId: claims.principalId,
        deviceId: claims.deviceId,
      },
    }
  }

  const catalog: WebRoute = {
    kind: 'exact',
    path: BI_CATALOG_PATH,
    handler: async (req, res) => {
      const opened = await open(req, res)
      if (opened === undefined) return
      try {
        json(res, 200, { entries: await ctx.biGateway.directory(opened.principal) })
      } catch (error) {
        answerFailure(res, error)
      }
    },
  }

  const charts: WebRoute = {
    kind: 'exact',
    path: BI_CHARTS_PATH,
    handler: async (req, res) => {
      const opened = await open(req, res)
      if (opened === undefined) return
      const ref = opened.body['ref']
      const keyword = readQuery(opened.body['query'])
      const page = readCount(opened.body['page'])
      const pageSize = readCount(opened.body['pageSize'])
      if (typeof ref !== 'string' || !isBiProjectRef(ref) || keyword === 'invalid' || page === 'invalid' || pageSize === 'invalid') {
        json(res, 400, { error: 'malformed' })
        return
      }
      try {
        json(res, 200, await ctx.biGateway.charts({
          ...opened.principal,
          ref: BiProjectRef(ref),
          ...keyword,
          ...(page === undefined ? {} : { page }),
          ...(pageSize === undefined ? {} : { pageSize }),
        }))
      } catch (error) {
        answerFailure(res, error)
      }
    },
  }

  const query: WebRoute = {
    kind: 'exact',
    path: BI_QUERY_PATH,
    handler: async (req, res) => {
      const opened = await open(req, res)
      if (opened === undefined) return
      const chartRef = opened.body['chartRef']
      const rows = readCount(opened.body['limit'])
      if (typeof chartRef !== 'string' || !isBiChartRef(chartRef) || rows === 'invalid') {
        json(res, 400, { error: 'malformed' })
        return
      }
      try {
        json(res, 200, await ctx.biGateway.query({
          ...opened.principal,
          chartRef: BiChartRef(chartRef),
          ...(rows === undefined ? {} : { limit: rows }),
        }))
      } catch (error) {
        answerFailure(res, error)
      }
    },
  }

  ctx.effect(() => ctx.webServer.register(catalog), 'bi-gateway-http: catalog route')
  ctx.effect(() => ctx.webServer.register(charts), 'bi-gateway-http: charts route')
  ctx.effect(() => ctx.webServer.register(query), 'bi-gateway-http: query route')
}

/**
 * Answer a failed operation with its closed reason.
 *
 * A failure that is not a `BiError` is this deployment's own defect rather
 * than anything the Runner did, so it answers 500 with no reason word:
 * inventing one would tell a member to take an action that cannot help.
 */
function answerFailure(res: ServerResponse, error: unknown): void {
  if (error instanceof BiError) {
    refuse(res, error.reason)
    return
  }
  json(res, 500, { error: 'internal' })
}
