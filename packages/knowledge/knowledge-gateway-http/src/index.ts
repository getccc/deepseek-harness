/**
 * The Control Plane's Runner-facing knowledge endpoints.
 *
 * Two routes, and everything they do is arranged around one fact: a request
 * must not be able to say who is asking or where the answer comes from. The
 * principal is recovered from a verified device token and never read from a
 * body; the source is resolved from the catalog and has no place in a request
 * at all.
 *
 * The protocol version is checked before any other field is decoded, so a
 * Runner this build cannot speak to is told to update rather than having its
 * fields interpreted under a grammar it did not mean.
 * @module @deepseek-ai/dsh-knowledge-gateway-http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-device-authorization'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  KnowledgeError,
  KnowledgeRef,
  isKnowledgeRef,
  type KnowledgeFailureReason,
  type KnowledgeScopeSelection,
} from '@deepseek-ai/dsh-knowledge'
import type { KnowledgePrincipal } from '@deepseek-ai/dsh-knowledge-gateway'
import {
  ACCESS_TOKEN_HEADER,
  KNOWLEDGE_CATALOG_PATH,
  KNOWLEDGE_PROTOCOL_VERSION,
  KNOWLEDGE_SEARCH_PATH,
  MINIMUM_KNOWLEDGE_PROTOCOL_VERSION,
} from './protocol.ts'

export {
  ACCESS_TOKEN_HEADER,
  KNOWLEDGE_CATALOG_PATH,
  KNOWLEDGE_PROTOCOL_VERSION,
  KNOWLEDGE_SEARCH_PATH,
  MINIMUM_KNOWLEDGE_PROTOCOL_VERSION,
  type CatalogBody,
  type KnowledgeProtocolRefusal,
  type KnowledgeRefusal,
  type SearchBody,
} from './protocol.ts'

/** Cordis plugin name. */
export const name = 'knowledge-gateway-http'
/** Services required before the endpoints may register. */
export const inject = ['webServer', 'knowledgeGateway', 'deviceAuthorization']

/** Plugin config: how much of a request the endpoints read. */
export interface Config {
  /** Largest request body accepted, in bytes. */
  maxRequestBodyBytes?: number
}

/** The largest request body accepted when a deployment names no bound. */
const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/** {@link Config} once schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/** The HTTP status one closed refusal reason answers with. */
const STATUS_BY_REASON: Readonly<Record<KnowledgeFailureReason, number>> = {
  'unauthenticated': 401,
  'not-allowed': 403,
  'scope-unavailable': 409,
  'scope-incompatible': 409,
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

/** Refuse with a closed knowledge reason and the status it maps to. */
function refuse(res: ServerResponse, reason: KnowledgeFailureReason): void {
  json(res, STATUS_BY_REASON[reason], { error: 'knowledge', reason })
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
 * Read the scope a search names, refusing anything that is not one.
 *
 * A malformed reference is refused here rather than passed on: the gateway
 * would refuse it too, but a request whose grammar this build does not
 * recognize is a protocol error, not an authorization outcome.
 * @param value - the decoded `scope` field.
 * @returns the selection, or undefined when the field is not a scope.
 */
export function readScope(value: unknown): KnowledgeScopeSelection | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record['mode'] === 'all') return { mode: 'all' }
  if (record['mode'] !== 'selected') return undefined
  const refs = record['refs']
  if (!Array.isArray(refs) || refs.length === 0) return undefined
  const parsed: KnowledgeRef[] = []
  for (const ref of refs as unknown[]) {
    if (typeof ref !== 'string' || !isKnowledgeRef(ref)) return undefined
    parsed.push(KnowledgeRef(ref))
  }
  return { mode: 'selected', refs: parsed }
}

/**
 * Register the Runner-facing knowledge endpoints.
 * @param ctx - Host plugin context carrying the web server, the gateway, and device authorization.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const { maxRequestBodyBytes: limit } = config as ResolvedConfig

  /**
   * Everything both routes do before they diverge: method, body, protocol
   * version, then identity. The version is checked before any other field is
   * read, and identity before any operation is attempted.
   */
  async function open(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ body: Record<string, unknown>; principal: KnowledgePrincipal } | undefined> {
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
    if (typeof version !== 'number'
      || version < MINIMUM_KNOWLEDGE_PROTOCOL_VERSION
      || version > KNOWLEDGE_PROTOCOL_VERSION) {
      json(res, 426, {
        error: 'knowledge',
        reason: 'update-required',
        minimum: MINIMUM_KNOWLEDGE_PROTOCOL_VERSION,
        current: KNOWLEDGE_PROTOCOL_VERSION,
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
    path: KNOWLEDGE_CATALOG_PATH,
    handler: async (req, res) => {
      const opened = await open(req, res)
      if (opened === undefined) return
      try {
        json(res, 200, { entries: await ctx.knowledgeGateway.directory(opened.principal) })
      } catch (error) {
        answerFailure(res, error)
      }
    },
  }

  const search: WebRoute = {
    kind: 'exact',
    path: KNOWLEDGE_SEARCH_PATH,
    handler: async (req, res) => {
      const opened = await open(req, res)
      if (opened === undefined) return
      const query = opened.body['query']
      const scope = readScope(opened.body['scope'])
      const maxResults = opened.body['maxResults']
      if (typeof query !== 'string' || query === '' || scope === undefined) {
        json(res, 400, { error: 'malformed' })
        return
      }
      if (maxResults !== undefined && (typeof maxResults !== 'number' || !Number.isSafeInteger(maxResults) || maxResults < 1)) {
        json(res, 400, { error: 'malformed' })
        return
      }
      try {
        json(res, 200, await ctx.knowledgeGateway.search({
          ...opened.principal,
          scope,
          query,
          ...(maxResults === undefined ? {} : { maxResults }),
        }))
      } catch (error) {
        answerFailure(res, error)
      }
    },
  }

  ctx.effect(() => ctx.webServer.register(catalog), 'knowledge-gateway-http: catalog route')
  ctx.effect(() => ctx.webServer.register(search), 'knowledge-gateway-http: search route')
}

/**
 * Answer a failed operation with its closed reason.
 *
 * A failure that is not a `KnowledgeError` is this deployment's own defect
 * rather than anything the Runner did, so it answers 500 with no reason word:
 * inventing one would tell a member to take an action that cannot help.
 */
function answerFailure(res: ServerResponse, error: unknown): void {
  if (error instanceof KnowledgeError) {
    refuse(res, error.reason)
    return
  }
  json(res, 500, { error: 'internal' })
}
