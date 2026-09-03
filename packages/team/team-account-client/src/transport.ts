/**
 * The TLS trust a Runner's Control Plane calls go through.
 *
 * A deployment that terminates TLS with a certificate no public authority
 * signed names the signing certificate here. The trust it installs reaches
 * only the calls made through the returned function: the process keeps Node's
 * default trust for every other host it talks to, so a Runner that must accept
 * one company certificate does not thereby accept it for the whole internet.
 * @module
 */

import { readFileSync } from 'node:fs'
import { Agent, fetch as undiciFetch } from 'undici'
import type { RequestInit, Response } from 'undici'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export type { Response, RequestInit } from 'undici'

/**
 * One Control Plane call.
 *
 * Undici's `fetch`, not the global one: a dispatcher carrying private trust is
 * an Undici `Agent`, and the global `fetch` rejects a dispatcher from a
 * different Undici instance with `UND_ERR_INVALID_ARG`.
 */
export type ControlPlaneFetch = (url: URL, init?: RequestInit) => Promise<Response>

/**
 * The fetch every Control Plane call in this plugin goes through.
 *
 * `ca` names a PEM file. Its certificates replace the public authorities for
 * Control Plane connections only, which is what makes this a pinning of the
 * deployment's own certificate rather than an extra authority the Runner
 * trusts everywhere. An unreadable file throws here, at plugin construction,
 * because a Runner that quietly fell back to public trust would report a
 * misconfigured deployment as an ordinary TLS failure much later.
 *
 * The agent owns a connection pool, so it is closed when the plugin unloads.
 * @param ctx - the plugin context whose unload closes the connection pool.
 * @param ca - path to the PEM file to trust, or undefined for Node's default trust.
 * @returns the fetch to use for every Control Plane call.
 */
export function controlPlaneFetch(ctx: Context, ca: string | undefined): ControlPlaneFetch {
  if (ca === undefined) return (url, init) => undiciFetch(url, init)
  const certificate = readFileSync(ca, 'utf8')
  const agent = new Agent({ connect: { ca: certificate } })
  ctx.effect(() => async () => { await agent.close() }, 'controlPlaneFetch.agent()')
  return (url, init) => undiciFetch(url, { ...init, dispatcher: agent })
}

/**
 * The two fields every Control Plane client carries: which Control Plane, and
 * what it accepts as that Control Plane's certificate.
 *
 * Spread into a plugin's own `z.object`, so the three Runner-side clients
 * cannot drift on the address or the trust the deployment configured for them.
 */
export const controlPlaneConfigFields = {
  controlPlaneUrl: z.string().required(),
  controlPlaneCa: z.string(),
}
