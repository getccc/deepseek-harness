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
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici'
import type { Dispatcher, RequestInit, Response } from 'undici'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { proxyRouteFor } from '@deepseek-ai/dsh-http-proxy'

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
 * Every call follows the process-wide proxy policy. Without a certificate the
 * call rides the installed global dispatcher, which already routes by that
 * policy. With one, the trust has to travel in the origin TLS handshake, which
 * the installed dispatcher cannot carry, so this module keeps its own agents:
 * a direct one for an origin the policy leaves direct, and one per proxy that
 * tunnels through it and verifies the Control Plane with the pinned trust at
 * the far end of the tunnel. The agents own connection pools, so they are
 * closed when the plugin unloads.
 * @param ctx - the plugin context whose unload closes the connection pools.
 * @param ca - path to the PEM file to trust, or undefined for Node's default trust.
 * @returns the fetch to use for every Control Plane call.
 */
export function controlPlaneFetch(ctx: Context, ca: string | undefined): ControlPlaneFetch {
  if (ca === undefined) return (url, init) => undiciFetch(url, init)
  const certificate = readFileSync(ca, 'utf8')
  // Keyed by the proxy the route named, or by '' for the direct route.
  const agents = new Map<string, Dispatcher>()
  const agentFor = (url: URL): Dispatcher => {
    const route = proxyRouteFor(url)
    const key = route.proxied ? route.proxy : ''
    const existing = agents.get(key)
    if (existing !== undefined) return existing
    // The marker sits on each construction because the pinned trust rides the
    // origin handshake, which the installed dispatcher cannot carry.
    const agent = route.proxied
      // proxy-exempt: tunnels through the proxy `proxyRouteFor` chose, verifying the origin with the pinned trust.
      ? new ProxyAgent({ uri: route.proxy, requestTls: { ca: certificate } })
      // proxy-exempt: the route left this origin direct.
      : new Agent({ connect: { ca: certificate } })
    agents.set(key, agent)
    return agent
  }
  ctx.effect(() => async () => {
    await Promise.all([...agents.values()].map(agent => agent.close()))
  }, 'controlPlaneFetch.agents()')
  // proxy-exempt: the agent above, chosen per call by the proxy route.
  return (url, init) => undiciFetch(url, { ...init, dispatcher: agentFor(url) })
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
