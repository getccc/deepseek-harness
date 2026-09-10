/** Host HTTP bridge for browser-client RPC. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-credentials'
// Activates the webServer Context merge used below.
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { API_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority } from './api-request-trust.ts'
import { BrowserAuth } from './browser-auth.ts'
import { HostConnectionService } from './rpc-host.ts'
import type {
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionTrustRequest,
} from './rpc.ts'
import { ConnectionRecoveryConfigSchema, resolveConnectionConfig, type ConnectionRecoveryConfig } from './recovery-config.ts'

export type {
  ConnectionFetchMethod,
  ConnectionFetchHandler,
  ConnectionFetchRoute,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRequestRejection,
  ConnectionRpcResult,
  ConnectionRequestBodyMode,
  ConnectionTrustRequest,
  ClientRequest,
  HostConnectionHandle,
  HostConnectionFetch,
  HostConnectionRpc,
  RpcMessage,
  ServerResponse,
} from './rpc.ts'
export { RpcId, transportError } from './rpc.ts'
export {
  clientRequestSchema,
  rpcErrorSchema,
  rpcIdSchema,
  rpcMessageSchema,
  rpcResultSchema,
  serverResponseSchema,
} from './rpc-schema.ts'
export { HostConnectionService } from './rpc-host.ts'

export { API_PATH } from './api-path.ts'

/**
 * Exact route that ends this browser's session with the local application.
 * A person reaches it by navigating; it is not part of the RPC surface, so it
 * never appears in a generated client contract.
 */
export const LOCK_PATH = '/lock'

/**
 * The local browser session, as a navigation endpoint outside this package
 * needs it.
 *
 * Only two operations are published: ask whether this browser already holds the
 * session, and hand it one. Everything else about the cookie — its name, its
 * signature, its lifetime — stays here, so a second plugin cannot mint a
 * session this package would then have to keep compatible with.
 */
export interface BrowserSession {
  /**
   * Whether the request carries this activation's valid session cookie.
   * @param request - request headers carrying Host and Cookie.
   * @returns true only for an unexpired cookie signed by this activation's secret.
   */
  isAuthenticated(request: ConnectionTrustRequest): boolean
  /**
   * Issue the session and hand the browser to `destination` without a redirect,
   * which a `SameSite=Strict` cookie would not survive on a cross-site arrival.
   * @param req - the navigation request, which must carry a Host header.
   * @param res - the response, owned by this method when it returns true.
   * @param destination - same-origin path to hand the browser to, such as `/`.
   * @returns true when the session was issued.
   */
  issueSession(req: ConnectionIndexRequest, res: ConnectionIndexResponse, destination: string): boolean
  /**
   * Expire the request's valid session cookie and redirect to a same-origin destination.
   * @param req - the navigation request carrying the browser session.
   * @param res - the response, owned by this method.
   * @param destination - same-origin path opened after the session ends.
   * @returns whether an authenticated session was ended.
   */
  endSession(req: ConnectionIndexRequest, res: ConnectionIndexResponse, destination: string): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The local browser session; provided by `client-connection` when it mounts. */
    browserSession: BrowserSession
  }
}

/** Stable Cordis plugin name. */
export const name = 'client-connection'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection. */
export const inject = ['credentials']

/** Browser authentication, request limits, and connection recovery configuration. */
export interface ConnectionConfig {
  /** Browser recovery timing, injected into each served page. */
  recovery?: ConnectionRecoveryConfig
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by; the Web runtime derives LAN IP literals from an active all-interface
   * bind. An entry that is not a bare, canonical authority fails plugin load.
   */
  trustedHosts?: string[]
  /** Absolute browser-session lifetime in days. Default: 30. */
  cookieMaxAgeDays?: number
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionConfig> = z.object({
  recovery: ConnectionRecoveryConfigSchema.default({}),
  trustedHosts: z.array(String).default([]),
  cookieMaxAgeDays: z.natural().min(1).default(30),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Provides carrier-neutral RPC and Fetch registries. When `webServer` is
 * present, the plugin also mounts the `/api` browser transport with Host/Origin
 * checks and persistent browser authentication.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export async function apply(ctx: Context, config?: ConnectionConfig): Promise<void> {
  const recovery = resolveConnectionConfig(config?.recovery)
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const cookieMaxAgeDays = config?.cookieMaxAgeDays ?? 30
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const browserAuth = await BrowserAuth.create(ctx.root, ctx.credentials, cookieMaxAgeDays)
  const connection = new HostConnectionService(ctx, trustedHosts, browserAuth)
  ctx.inject(['webServer'], (webCtx) => {
    assertImageBodyCapacity(webCtx, maxRequestBodyBytes)
    webCtx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: '__DSH_CONNECTION_RECOVERY__', value: recovery })
    })
    const fetchHandler = connection.createSharedFetchHandler(API_PATH)
    const route: WebRoute = {
      kind: 'prefix',
      path: API_PATH,
      handler: async (req, res) => {
        const rejection = connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        await bridge(req, res, fetchHandler, maxRequestBodyBytes)
      },
    }
    webCtx.effect(() => webCtx.webServer.register(route), 'client-connection: /api route')
    // Navigation-only, and deliberately outside the /api prefix: it carries no
    // RPC, reads no request body, and reaches no Host capability, so the browser
    // trust fence that guards /api has nothing to guard here. What protects it is
    // the cookie's own SameSite=Strict — see BrowserAuth.lock.
    const lockRoute: WebRoute = {
      kind: 'exact',
      path: LOCK_PATH,
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
          res.end('method not allowed\n')
          return
        }
        browserAuth.lock(req, res)
      },
    }
    webCtx.effect(() => webCtx.webServer.register(lockRoute), 'client-connection: lock route')
  })
  // Published for local navigation endpoints that must hand a browser the same
  // session this package checks — the team handoff is the current one.
  ctx.provide('browserSession', browserAuth)
  ctx.inject(['attachments'], (attachmentCtx) => {
    assertImageBodyCapacity(attachmentCtx, maxRequestBodyBytes)
  })
}
