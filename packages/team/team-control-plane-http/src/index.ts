/**
 * The Control Plane's Runner-facing authentication and credential endpoints.
 *
 * These endpoints take no browser session. The Runner opens a transaction,
 * authenticates an organization account, and redeems the approved code with
 * its PKCE verifier and device signature; refresh uses the same device proof.
 * @module @deepseek-ai/dsh-team-control-plane-http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-account-auth'
import { OrgId } from '@deepseek-ai/dsh-account-store'
import type {} from '@deepseek-ai/dsh-audit'
import {
  DEVICE_PLATFORMS,
  FamilyId,
  TransactionId,
  type DevicePlatform,
  type RedeemRequest,
  type RefreshRequest,
  type StartRequest,
} from '@deepseek-ai/dsh-device-authorization'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  DEVICE_PATH_PREFIX,
  MINIMUM_PROTOCOL_VERSION,
  LOGIN_PATH,
  PROTOCOL_VERSION,
  REDEEM_PATH,
  REFRESH_PATH,
  START_PATH,
  protocolSupport,
  type LoginSuccess,
} from './protocol.ts'

export {
  DEVICE_PATH_PREFIX,
  MINIMUM_PROTOCOL_VERSION,
  LOGIN_PATH,
  PROTOCOL_VERSION,
  REDEEM_PATH,
  REFRESH_PATH,
  START_PATH,
  protocolSupport,
  type ProtocolRefusal,
  type ProtocolSupport,
  type LoginSuccess,
  type TeamMemberIdentity,
  type WireRefusal,
} from './protocol.ts'

/** Cordis plugin name. */
export const name = 'team-control-plane-http'
/** Services required before the endpoints may register. */
export const inject = ['webServer', 'accountStore', 'accountAuth', 'audit', 'deviceAuthorization']

/** Plugin config: account namespace, endpoint prefix, and request limit. */
export interface Config {
  /** The organization this single-organization Control Plane serves. */
  organizationId: string
  /** Path prefix the endpoints are served under. */
  pathPrefix: string
  /** Largest request body accepted, in bytes. */
  maxRequestBodyBytes: number
}

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  organizationId: z.string().required(),
  pathPrefix: z.string().default(DEVICE_PATH_PREFIX),
  maxRequestBodyBytes: z.natural().min(1).default(16 * 1024),
})

/** Read a JSON body, or the reason it cannot be read. */
async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown> | string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > limit) return 'body too large'
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : 'body must be a JSON object'
  } catch {
    // A Runner that sent something unparsable gets the same answer as one that
    // sent the wrong shape: this is a wire boundary, and nothing beyond it runs.
    return 'body must be JSON'
  }
}

/** Write one JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * Map a rejected seam call onto the wire.
 *
 * A refusal carries the seam's own word, which is what lets a Runner tell "try
 * again" from "bind this computer again". Anything else is this deployment's
 * problem, not the Runner's, and says so without describing itself.
 */
function fail(res: ServerResponse, error: unknown): void {
  if (error instanceof InvalidCredentialsError) {
    json(res, 401, { error: 'unauthorized' })
    return
  }
  const reason = error instanceof Error && 'reason' in error ? String(error.reason) : undefined
  if (reason === undefined) {
    json(res, 500, { error: 'internal' })
    return
  }
  // A body this endpoint could not read is the caller's mistake; every other
  // reason is the seam deciding, which is not a 400.
  json(res, error instanceof MalformedBodyError ? 400 : 403, { error: 'refused', reason })
}

/** A reasonless password refusal suitable for the Runner-facing wire. */
class InvalidCredentialsError extends Error {
  constructor() {
    super('the account credentials were refused')
    this.name = 'InvalidCredentialsError'
  }
}

/** Raised when a request body does not carry what the endpoint requires. */
class MalformedBodyError extends Error {
  readonly reason = 'malformed-body'
  constructor(field: string) {
    super(`field ${JSON.stringify(field)} is missing or not of the required type`)
    this.name = 'MalformedBodyError'
  }
}

/** Read one required string field. */
function str(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.length === 0) throw new MalformedBodyError(field)
  return value
}

/** Read one required integer field. */
function int(body: Record<string, unknown>, field: string): number {
  const value = body[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new MalformedBodyError(field)
  return value
}

/** Read the platform, which the seam's word list governs. */
function platform(body: Record<string, unknown>): DevicePlatform {
  const value = str(body, 'platform')
  if (!(DEVICE_PLATFORMS as readonly string[]).includes(value)) throw new MalformedBodyError('platform')
  return value as DevicePlatform
}

/** Parse a request to open a transaction. */
function parseStart(body: Record<string, unknown>): StartRequest {
  return {
    publicKey: str(body, 'publicKey'),
    platform: platform(body),
    runnerVersion: str(body, 'runnerVersion'),
    pkceChallenge: str(body, 'pkceChallenge'),
    callbackUri: str(body, 'callbackUri'),
    protocolVersion: int(body, 'protocolVersion'),
  }
}

/** Parse a request to turn an authorization code into a credential. */
function parseRedeem(body: Record<string, unknown>): RedeemRequest {
  return {
    transactionId: TransactionId(str(body, 'transactionId')),
    code: str(body, 'code'),
    pkceVerifier: str(body, 'pkceVerifier'),
    deviceSignature: str(body, 'deviceSignature'),
    callbackUri: str(body, 'callbackUri'),
    protocolVersion: int(body, 'protocolVersion'),
  }
}

/** Parse a request to exchange a refresh token. */
function parseRefresh(body: Record<string, unknown>): RefreshRequest {
  return {
    familyId: FamilyId(str(body, 'familyId')),
    refreshToken: str(body, 'refreshToken'),
    deviceSignature: str(body, 'deviceSignature'),
  }
}

/**
 * Answer a Runner whose protocol version this build does not speak.
 *
 * A body carrying no version at all is left to the per-endpoint parsing, which
 * names the missing field; only a version that is present and outside the range
 * is answered here.
 * @param res - the response, owned by this function when it returns false.
 * @param body - the parsed request body.
 * @returns true when the request may continue.
 */
function answerUnsupportedProtocol(res: ServerResponse, body: Record<string, unknown>): boolean {
  const version = body['protocolVersion']
  if (typeof version !== 'number' || protocolSupport(version) === 'supported') return true
  // 426 rather than 400: the request was understood and refused for what the
  // Runner is, which is the one refusal an update fixes.
  json(res, 426, {
    error: 'refused',
    reason: 'protocol-unsupported',
    minimum: MINIMUM_PROTOCOL_VERSION,
    current: PROTOCOL_VERSION,
  })
  return false
}

/**
 * Register the Runner-facing authentication and credential endpoints.
 * @param ctx - Host plugin context carrying the web server and the seam.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config): void {
  if (config.organizationId.trim().length === 0) {
    throw new Error('team-control-plane-http: organizationId must name the organization this Control Plane serves')
  }
  const organizationId = OrgId(config.organizationId)
  const prefix = config.pathPrefix
  const limit = config.maxRequestBodyBytes

  const post = (path: string, run: (body: Record<string, unknown>) => Promise<unknown>): WebRoute => ({
    kind: 'exact',
    path: `${prefix}${path}`,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'method not allowed' })
        return
      }
      const body = await readJson(req, limit)
      if (typeof body === 'string') {
        json(res, 400, { error: body })
        return
      }
      // The version is decided before anything else reads the body. A Runner
      // this build cannot speak to must learn that, and not a downstream
      // complaint about a field whose meaning changed underneath it.
      if (!answerUnsupportedProtocol(res, body)) return
      try {
        json(res, 200, await run(body))
      } catch (error) {
        fail(res, error)
      }
    },
  })

  // Each body is parsed into the seam's own request before the seam sees it.
  // This is a wire boundary: the seam's types are a promise its callers keep,
  // and a caller that reached it over HTTP has made no such promise.
  const routes = [
    post(START_PATH, body => ctx.deviceAuthorization.start(parseStart(body))),
    post(LOGIN_PATH, async (body) => {
      const transactionId = TransactionId(str(body, 'transactionId'))
      await ctx.deviceAuthorization.describe(transactionId)
      const outcome = await ctx.accountAuth.authenticate(
        organizationId,
        str(body, 'loginName'),
        str(body, 'secret'),
      )
      if (!outcome.ok) {
        await ctx.audit.record({
          orgId: organizationId,
          action: 'member.login',
          outcome: 'denied',
          reason: 'invalid-credentials',
          metadata: { authMethod: 'password' },
        })
        throw new InvalidCredentialsError()
      }
      const authenticated = await ctx.audit.record({
        orgId: organizationId,
        principalId: outcome.userId,
        action: 'member.login',
        outcome: 'allowed',
        metadata: { authMethod: 'password' },
      })
      const member = await ctx.accountStore.getUser(outcome.userId)
      if (member === undefined) {
        throw new Error(`team-control-plane-http: authenticated account ${outcome.userId} is missing`)
      }
      const confirmed = await ctx.deviceAuthorization.confirm(transactionId, {
        orgId: organizationId,
        userId: outcome.userId,
        authenticationId: `audit:${authenticated.seq.toString()}`,
      })
      return {
        ...confirmed,
        member: { loginName: member.loginName, displayName: member.displayName },
      } satisfies LoginSuccess
    }),
    post(REDEEM_PATH, body => ctx.deviceAuthorization.redeem(parseRedeem(body))),
    post(REFRESH_PATH, body => ctx.deviceAuthorization.refresh(parseRefresh(body))),
  ]
  for (const route of routes) {
    ctx.effect(() => ctx.webServer.register(route), `team-control-plane-http: ${route.path}`)
  }
}
