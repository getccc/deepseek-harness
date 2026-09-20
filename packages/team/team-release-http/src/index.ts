/**
 * The Control Plane's Runner-facing release route: verify the device token,
 * decide whether this member is offered staged releases, and answer with the
 * newest release they are offered together with the version floor.
 *
 * The route hands back the signed document it was given and nothing else. It
 * cannot sign, so a Control Plane an attacker controls can withhold a release
 * or offer an older one — which the installed application refuses as
 * `not-newer` — but cannot make a build install anything.
 * @module @deepseek-ai/dsh-team-release-http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-access-control'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type {} from '@deepseek-ai/dsh-device-authorization'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { RELEASE_RESOURCE_TYPE, RELEASE_STAGED_ACTION } from '@deepseek-ai/dsh-team-release'
import {
  ACCESS_TOKEN_HEADER,
  MINIMUM_RELEASE_PROTOCOL_VERSION,
  RELEASE_MANIFEST_PATH,
  RELEASE_PROTOCOL_VERSION,
} from './protocol.ts'

export {
  ACCESS_TOKEN_HEADER,
  MINIMUM_RELEASE_PROTOCOL_VERSION,
  RELEASE_MANIFEST_PATH,
  RELEASE_PROTOCOL_VERSION,
  type ManifestAnswer,
  type ManifestBody,
} from './protocol.ts'

export { RELEASE_RESOURCE_TYPE, RELEASE_STAGED_ACTION } from '@deepseek-ai/dsh-team-release'

/** Plugin config: the one bound a request body may carry. */
export interface Config {
  /** The most bytes a request body may carry; the body holds one number. */
  maxRequestBodyBytes?: number
}

/** Cordis plugin name. */
export const name = 'team-release-http'

/** The services the route reads: the listener, the releases, the token verifier, and the decision. */
export const inject = ['webServer', 'teamReleases', 'deviceAuthorization', 'accessControl']

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  maxRequestBodyBytes: z.natural().min(64).default(4_096),
})

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

/**
 * Read a JSON object body under a byte bound, refusing as it streams.
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
    // A body that is not JSON is a proxy error page or a truncated request.
    return undefined
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined
}

/**
 * Register the Runner-facing release route.
 * @param ctx - the Control Plane context.
 * @param config - the request-body bound.
 */
export function apply(ctx: Context, config: Config): void {
  const limit = (config as Required<Config>).maxRequestBodyBytes
  // The governed resource is registered once per organization per process:
  // registration is idempotent on the identity it names, and a type grant a
  // role already holds covers it the moment it exists.
  const governed = new Set<string>()

  async function govern(orgId: OrgId): Promise<void> {
    if (governed.has(orgId)) return
    await ctx.accessControl.registerResource({
      orgId,
      type: RELEASE_RESOURCE_TYPE,
      externalRef: orgId,
      displayName: 'Staged releases',
    })
    governed.add(orgId)
  }

  /**
   * Open one request: method, body, version, then token. The version is
   * decided before the token is verified, because sending an out-of-date
   * Runner to sign in again cannot help it.
   */
  async function open(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<Principal | undefined> {
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
    if (typeof version !== 'number' || version < MINIMUM_RELEASE_PROTOCOL_VERSION || version > RELEASE_PROTOCOL_VERSION) {
      json(res, 426, {
        error: 'protocol',
        minimum: MINIMUM_RELEASE_PROTOCOL_VERSION,
        current: RELEASE_PROTOCOL_VERSION,
      })
      return undefined
    }
    const header = req.headers[ACCESS_TOKEN_HEADER]
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined
    const claims = token === undefined ? undefined : await ctx.deviceAuthorization.verifyAccessToken(token)
    // One answer for an unknown token, a lapsed one, and a revoked device.
    if (claims === undefined) {
      json(res, 401, { error: 'unauthenticated' })
      return undefined
    }
    return { orgId: claims.orgId, principalId: claims.principalId, deviceId: claims.deviceId }
  }

  /** Whether this member is offered releases before everyone else. */
  async function staged(principal: Principal): Promise<boolean> {
    await govern(principal.orgId)
    const decision = await ctx.accessControl.authorize({
      orgId: principal.orgId,
      principalId: principal.principalId,
      deviceId: principal.deviceId,
      action: RELEASE_STAGED_ACTION,
      resourceType: RELEASE_RESOURCE_TYPE,
      resourceId: principal.orgId,
    })
    return decision.allowed
  }

  const manifest: WebRoute = {
    kind: 'exact',
    path: RELEASE_MANIFEST_PATH,
    handler: async (req, res) => {
      const principal = await open(req, res)
      if (principal === undefined) return
      const offered = ctx.teamReleases.offered(principal.orgId, await staged(principal))
      const floor = ctx.teamReleases.floor(principal.orgId)
      if (offered === undefined) {
        // Nothing is published for this member: not a failure, and not a
        // document either, so the shell's manifest read reports it as one.
        json(res, 404, { error: 'no release', minimumVersion: floor?.version ?? null })
        return
      }
      const document = JSON.parse(offered.manifest) as { manifest?: unknown }
      json(res, 200, {
        manifest: document.manifest,
        signature: offered.signature,
        minimumVersion: floor?.version ?? null,
      })
    },
  }
  ctx.effect(() => ctx.webServer.register(manifest), 'team-release-http: manifest route')
}
