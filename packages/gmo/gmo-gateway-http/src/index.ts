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

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-device-authorization'
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
import type { GmoPrincipal } from '@deepseek-ai/dsh-gmo-gateway'
import {
  ACCESS_TOKEN_HEADER,
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
 * A source that cannot answer is upstream of this Control Plane exactly as the
 * member's model provider is, and a member can act on neither beyond trying
 * again or asking an administrator. A question the source refused, a result it
 * does not hold, and a view it does not have are the member's to change, so
 * they answer as conflicts with the request rather than as failures.
 */
const STATUS_BY_REASON: Readonly<Record<GmoFailureReason, number>> = {
  'unauthenticated': 401,
  'not-allowed': 403,
  'scope-unavailable': 409,
  'result-unavailable': 409,
  'unsupported': 409,
  'invalid-query': 422,
  'too-large': 413,
  'upstream-unavailable': 502,
  'upstream-invalid': 502,
  'control-plane-unreachable': 503,
  'update-required': 426,
  'cancelled': 499,
}

/** Write one JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Refuse with a closed GMO reason and the status it maps to. */
function refuse(res: ServerResponse, reason: GmoFailureReason): void {
  json(res, STATUS_BY_REASON[reason], { error: 'gmo', reason })
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
 * Register the Runner-facing GMO endpoints.
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
  ): Promise<{ body: Record<string, unknown>; principal: GmoPrincipal } | undefined> {
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
    if (typeof version !== 'number' || version < MINIMUM_GMO_PROTOCOL_VERSION || version > GMO_PROTOCOL_VERSION) {
      json(res, 426, {
        error: 'gmo',
        reason: 'update-required',
        minimum: MINIMUM_GMO_PROTOCOL_VERSION,
        current: GMO_PROTOCOL_VERSION,
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
    path: GMO_CATALOG_PATH,
    handler: async (req, res) => {
      const opened = await open(req, res)
      if (opened === undefined) return
      try {
        json(res, 200, { entries: await ctx.gmoGateway.directory(opened.principal) })
      } catch (error) {
        answerFailure(res, error)
      }
    },
  }

  const results: WebRoute = {
    kind: 'exact',
    path: GMO_RESULTS_PATH,
    handler: async (req, res) => {
      const opened = await open(req, res)
      if (opened === undefined) return
      const ref = opened.body['ref']
      const page = readGmoCount(opened.body['page'])
      const pageSize = readGmoCount(opened.body['pageSize'])
      if (typeof ref !== 'string' || !isGmoCategoryRef(ref) || page === 'invalid' || pageSize === 'invalid') {
        json(res, 400, { error: 'malformed' })
        return
      }
      try {
        json(res, 200, await ctx.gmoGateway.results({
          ...opened.principal,
          ref: GmoCategoryRef(ref),
          ...(page === undefined ? {} : { page }),
          ...(pageSize === undefined ? {} : { pageSize }),
        }))
      } catch (error) {
        answerFailure(res, error)
      }
    },
  }

  const describe: WebRoute = {
    kind: 'exact',
    path: GMO_DESCRIBE_PATH,
    handler: async (req, res) => {
      const opened = await open(req, res)
      if (opened === undefined) return
      const resultRef = opened.body['resultRef']
      if (typeof resultRef !== 'string' || !isGmoResultRef(resultRef)) {
        json(res, 400, { error: 'malformed' })
        return
      }
      try {
        json(res, 200, await ctx.gmoGateway.describe({ ...opened.principal, resultRef: GmoResultRef(resultRef) }))
      } catch (error) {
        answerFailure(res, error)
      }
    },
  }

  const ask: WebRoute = {
    kind: 'exact',
    path: GMO_ASK_PATH,
    handler: async (req, res) => {
      const opened = await open(req, res)
      if (opened === undefined) return
      const resultRef = opened.body['resultRef']
      const query = readGmoQuery(opened.body['query'])
      if (typeof resultRef !== 'string' || !isGmoResultRef(resultRef) || query === 'invalid') {
        json(res, 400, { error: 'malformed' })
        return
      }
      try {
        json(res, 200, await ctx.gmoGateway.ask({ ...opened.principal, resultRef: GmoResultRef(resultRef), query }))
      } catch (error) {
        answerFailure(res, error)
      }
    },
  }

  ctx.effect(() => ctx.webServer.register(catalog), 'gmo-gateway-http: catalog route')
  ctx.effect(() => ctx.webServer.register(results), 'gmo-gateway-http: results route')
  ctx.effect(() => ctx.webServer.register(describe), 'gmo-gateway-http: describe route')
  ctx.effect(() => ctx.webServer.register(ask), 'gmo-gateway-http: ask route')
}

/**
 * Answer a failed operation with its closed reason.
 *
 * A failure that is not a `GmoError` is this deployment's own defect rather
 * than anything the Runner did, so it answers 500 with no reason word:
 * inventing one would tell a member to take an action that cannot help.
 */
function answerFailure(res: ServerResponse, error: unknown): void {
  if (error instanceof GmoError) {
    refuse(res, error.reason)
    return
  }
  json(res, 500, { error: 'internal' })
}
