/**
 * The Control Plane's Runner-facing web search routes: verify the device
 * token, decide `web.search` for the member, run the search through the
 * Control Plane's own `ctx.web` (where the company search credential lives),
 * record the outcome, and answer with the web service's result or a closed
 * refusal. A second route answers the decision alone, so a Runner can offer
 * search only to a member who may use it. A request cannot say who is asking
 * or which provider answers.
 * @module @deepseek-ai/dsh-web-search-gateway-http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-access-control'
import type {} from '@deepseek-ai/dsh-audit'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type {} from '@deepseek-ai/dsh-device-authorization'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { WebError, type WebSearchResult } from '@deepseek-ai/dsh-web'
import {
  ACCESS_TOKEN_HEADER,
  MINIMUM_WEB_SEARCH_PROTOCOL_VERSION,
  WEB_ACCESS_PATH,
  WEB_SEARCH_PATH,
  WEB_SEARCH_PROTOCOL_VERSION,
  type WebSearchRefusalReason,
} from './protocol.ts'

export {
  ACCESS_TOKEN_HEADER,
  MINIMUM_WEB_SEARCH_PROTOCOL_VERSION,
  WEB_ACCESS_PATH,
  WEB_SEARCH_PATH,
  WEB_SEARCH_PROTOCOL_VERSION,
  WEB_SEARCH_REFUSAL_REASONS,
  type AccessAnswer,
  type AccessBody,
  type SearchAnswer,
  type SearchBody,
  type WebSearchProtocolRefusal,
  type WebSearchRefusal,
  type WebSearchRefusalReason,
} from './protocol.ts'

/** Cordis plugin name. */
export const name = 'web-search-gateway-http'

/** The services the route reads: the listener, the search seam, the token verifier, the decision, and the record. */
export const inject = ['webServer', 'web', 'deviceAuthorization', 'accessControl', 'audit']

/** The governed resource type `web.search` is decided on. */
export const WEB_SEARCH_RESOURCE_TYPE = 'web_search'

/** The action a role must hold on that type for the member to search. */
export const WEB_SEARCH_ACTION = 'web.search'

/** Plugin config. */
export interface Config {
  /** Largest request body accepted; a query needs little. Defaults to 16384. */
  maxRequestBodyBytes?: number
}

const DEFAULT_MAX_REQUEST_BODY_BYTES = 16 * 1024

/** Config schema; the loader fills the default before {@link apply} runs. */
export const Config: z<Config> = z.object({
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

type ResolvedConfig = Required<Config>

const STATUS_BY_REASON: Readonly<Record<WebSearchRefusalReason, number>> = {
  'unauthenticated': 401,
  'not-allowed': 403,
  'upstream-unavailable': 502,
  'upstream-invalid': 502,
  'update-required': 426,
  'cancelled': 499,
}

/**
 * Web error codes that mean the Control Plane's own search backend is not
 * usable right now: no provider, no credential, an ambiguous or misconfigured
 * selection. Every other code is the provider answering badly.
 */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'WEB_PROVIDER_UNAVAILABLE',
  'WEB_PROVIDER_AMBIGUOUS',
  'WEB_PROVIDER_CONFIGURED_MISSING',
  'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
  'WEB_PROVIDER_CREDENTIAL_MISSING',
])

/** The member a verified token stands for. */
interface Principal {
  readonly orgId: OrgId
  readonly principalId: UserId
  readonly deviceId: string
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a JSON object body under a byte bound, refusing as it streams rather
 * than after it has all arrived.
 * @param req - the request.
 * @param limit - the most bytes the body may carry.
 * @returns the object, or undefined for an oversized, unparsable, or non-object body.
 */
async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > limit) return undefined
    chunks.push(chunk)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    // A body that is not JSON is a proxy error page or a truncated request;
    // either way this build cannot read it, and the parser's own message
    // describes our parse rather than the caller's mistake.
    return undefined
  }
  return isRecord(parsed) ? parsed : undefined
}

/**
 * The refusal reason a failed search answers with, and the word the audit
 * record keeps for it.
 * @param error - what the web service threw.
 * @returns the reason, or undefined for a failure that is not a web failure.
 */
export function reasonOf(error: unknown): Extract<WebSearchRefusalReason, 'upstream-unavailable' | 'upstream-invalid' | 'cancelled'> | undefined {
  if (!(error instanceof WebError)) return undefined
  if (error.code === 'WEB_ABORTED') return 'cancelled'
  return UNAVAILABLE_CODES.has(error.code) ? 'upstream-unavailable' : 'upstream-invalid'
}

/**
 * Mount the search route.
 * @param ctx - the Control Plane context.
 * @param config - the body bound.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled the defaulted field.
  const { maxRequestBodyBytes: limit } = config as ResolvedConfig
  // The governed resource is registered once per organization per process:
  // registration is idempotent on the identity it names, and a type grant a
  // role already holds covers it the moment it exists.
  const governed = new Set<string>()

  async function govern(orgId: OrgId): Promise<void> {
    if (governed.has(orgId)) return
    await ctx.accessControl.registerResource({
      orgId,
      type: WEB_SEARCH_RESOURCE_TYPE,
      externalRef: orgId,
      displayName: 'Web search',
    })
    governed.add(orgId)
  }

  async function record(
    principal: Principal,
    outcome: 'allowed' | 'denied' | 'error',
    itemCount?: number,
    failure?: Exclude<ReturnType<typeof reasonOf>, undefined>,
  ): Promise<void> {
    await ctx.audit.record({
      orgId: principal.orgId,
      action: WEB_SEARCH_ACTION,
      outcome,
      principalId: principal.principalId,
      resourceId: principal.orgId,
      deviceId: principal.deviceId,
      ...(outcome === 'denied' ? { reason: 'no-grant' } : {}),
      metadata: {
        ...(itemCount === undefined ? {} : { itemCount }),
        ...(failure === undefined ? {} : { webFailure: failure }),
      },
    })
  }

  /**
   * Open one request: method, body, version, then token. The version is
   * decided before any other field is read and before the token is verified:
   * decoding a body under a grammar its sender did not mean is how a version
   * check stops being one, and sending an out-of-date Runner to sign in again
   * cannot help it.
   * @returns the body and the member, or undefined once the refusal is written.
   */
  async function open(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ body: Record<string, unknown>; principal: Principal } | undefined> {
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
      || version < MINIMUM_WEB_SEARCH_PROTOCOL_VERSION
      || version > WEB_SEARCH_PROTOCOL_VERSION) {
      json(res, 426, {
        error: 'web',
        reason: 'update-required',
        minimum: MINIMUM_WEB_SEARCH_PROTOCOL_VERSION,
        current: WEB_SEARCH_PROTOCOL_VERSION,
      })
      return undefined
    }
    const header = req.headers[ACCESS_TOKEN_HEADER]
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined
    const claims = token === undefined ? undefined : await ctx.deviceAuthorization.verifyAccessToken(token)
    // One answer for an unknown token, a lapsed one, and a revoked device.
    if (claims === undefined) {
      json(res, STATUS_BY_REASON.unauthenticated, { error: 'web', reason: 'unauthenticated' })
      return undefined
    }
    return { body, principal: { orgId: claims.orgId, principalId: claims.principalId, deviceId: claims.deviceId } }
  }

  /** The `web.search` decision for one member, asked fresh so a revoked grant lands on this call. */
  async function decide(principal: Principal): Promise<boolean> {
    await govern(principal.orgId)
    const decision = await ctx.accessControl.authorize({
      orgId: principal.orgId,
      principalId: principal.principalId,
      deviceId: principal.deviceId,
      action: WEB_SEARCH_ACTION,
      resourceType: WEB_SEARCH_RESOURCE_TYPE,
      resourceId: principal.orgId,
    })
    return decision.allowed
  }

  const access: WebRoute = {
    kind: 'exact',
    path: WEB_ACCESS_PATH,
    handler: async (req, res) => {
      const opened = await open(req, res)
      if (opened === undefined) return
      // The decision alone, unrecorded: what a Runner offers is not an act
      // the audit log accounts for; the search a member then runs is.
      json(res, 200, { allowed: await decide(opened.principal) })
    },
  }

  const search: WebRoute = {
    kind: 'exact',
    path: WEB_SEARCH_PATH,
    handler: async (req, res) => {
      const opened = await open(req, res)
      if (opened === undefined) return
      const { body, principal } = opened
      const query = body['query']
      const maxResults = body['maxResults']
      if (typeof query !== 'string' || query.trim() === '') {
        json(res, 400, { error: 'malformed' })
        return
      }
      if (maxResults !== undefined && (typeof maxResults !== 'number' || !Number.isSafeInteger(maxResults) || maxResults < 1)) {
        json(res, 400, { error: 'malformed' })
        return
      }
      if (!await decide(principal)) {
        await record(principal, 'denied')
        json(res, STATUS_BY_REASON['not-allowed'], { error: 'web', reason: 'not-allowed' })
        return
      }
      let result: WebSearchResult
      try {
        result = await ctx.web.search({ query, ...(maxResults === undefined ? {} : { maxResults }) })
      } catch (error) {
        const reason = reasonOf(error)
        if (reason === undefined) {
          await record(principal, 'error')
          json(res, 500, { error: 'internal' })
          return
        }
        await record(principal, 'error', undefined, reason)
        json(res, STATUS_BY_REASON[reason], { error: 'web', reason })
        return
      }
      await record(principal, 'allowed', result.sources.length)
      json(res, 200, {
        ...(result.content === undefined ? {} : { content: result.content }),
        sources: result.sources,
        truncated: result.truncated,
      })
    },
  }
  ctx.effect(() => ctx.webServer.register(access), 'web-search-gateway-http: access route')
  ctx.effect(() => ctx.webServer.register(search), 'web-search-gateway-http: search route')
}
