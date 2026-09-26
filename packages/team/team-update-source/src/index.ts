/**
 * The Runner's half of the desktop update: one loopback route that answers
 * the shell with the release this member is offered.
 *
 * The shell has no member credential and should not have one, while the
 * Runner already holds the device credential this deployment issued it. So
 * the Runner asks the Control Plane and hands the answer back unchanged: it
 * adds nothing the shell trusts, because the shell verifies the release key's
 * signature itself before anything is downloaded.
 * @module @deepseek-ai/dsh-team-update-source
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  controlPlaneConfigFields,
  controlPlaneFetch,
  type ControlPlaneFetch,
} from '@deepseek-ai/dsh-team-account-client'
import { ACCESS_TOKEN_HEADER, RELEASE_MANIFEST_PATH, RELEASE_PROTOCOL_VERSION } from '@deepseek-ai/dsh-team-release-http'

/** The loopback route the desktop shell asks. */
export const SHELL_MANIFEST_PATH = '/team/update/manifest'

/** How long the Control Plane has to answer before the shell is told nothing is offered. */
const REQUEST_TIMEOUT_MS = 20_000

/** Plugin config: where the Control Plane is, and how to trust it. */
export interface Config {
  /** Origin of the company Control Plane; no default. */
  controlPlaneUrl: string
  /** Absolute path of the certificate that signed the Control Plane's TLS certificate. */
  controlPlaneCa?: string
}

/** Cordis plugin name. */
export const name = 'team-update-source'

/** The listener this registers on, and the account client whose token it reads. */
export const inject = ['webServer', 'teamAccountClient']

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  ...controlPlaneConfigFields,
})

/**
 * Register the loopback release route.
 * @param ctx - the Runner context.
 * @param config - the Control Plane address and its certificate authority.
 */
export function apply(ctx: Context, config: Config): void {
  const request: ControlPlaneFetch = controlPlaneFetch(ctx, config.controlPlaneCa)

  const manifest: WebRoute = {
    kind: 'exact',
    path: SHELL_MANIFEST_PATH,
    handler: async (_req, res) => {
      const answer = await ask()
      res.writeHead(answer.status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(answer.body))
    },
  }

  /** Ask the Control Plane with this Runner's own credential. */
  async function ask(): Promise<{ status: number; body: unknown }> {
    let token: string
    try {
      token = await ctx.teamAccountClient.accessToken()
    } catch {
      // Not bound, or the credential was refused: there is no member to ask for.
      return { status: 401, body: { error: 'unauthenticated' } }
    }
    let response: Awaited<ReturnType<ControlPlaneFetch>>
    try {
      response = await request(new URL(RELEASE_MANIFEST_PATH, config.controlPlaneUrl), {
        method: 'POST',
        headers: { [ACCESS_TOKEN_HEADER]: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ protocolVersion: RELEASE_PROTOCOL_VERSION }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      // Unreachable deployment: the shell reports it and keeps the build running.
      return { status: 503, body: { error: 'unreachable' } }
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      // A reverse proxy error page rather than a Control Plane answer.
      return { status: 502, body: { error: 'unreadable' } }
    }
    return { status: response.status, body }
  }

  ctx.effect(() => ctx.webServer.register(manifest), 'team-update-source: shell manifest route')
}
