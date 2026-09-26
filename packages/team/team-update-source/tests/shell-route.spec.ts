/**
 * The loopback route the desktop shell asks: it carries the Runner's own
 * credential to the Control Plane and hands back what it answered, including
 * the refusals, because the shell decides what to do with each of them.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as source from '@deepseek-ai/dsh-team-update-source'
import { SHELL_MANIFEST_PATH } from '@deepseek-ai/dsh-team-update-source'

let runner: Context | undefined

afterEach(async () => {
  await runner?.fiber.dispose()
  runner = undefined
})

/** One Runner with a scripted account client and a scripted Control Plane. */
async function bench(options: { token?: string | Error } = {}) {
  const ctx = new Context()
  runner = ctx
  await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  ctx.provide('teamAccountClient', {
    accessToken: () => (options.token instanceof Error
      ? Promise.reject(options.token)
      : Promise.resolve(options.token ?? 'device-token')),
  })
  await ctx.plugin(source, source.Config({ controlPlaneUrl: 'https://control.test' })).await()
  return { origin: `http://127.0.0.1:${String(ctx.webServer.port)}` }
}

describe('the loopback release route', () => {
  it('refuses when this Runner holds no credential', async () => {
    const { origin } = await bench({ token: new Error('not bound') })
    const response = await fetch(`${origin}${SHELL_MANIFEST_PATH}`)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthenticated' })
  })

  it('reports an unreachable deployment rather than pretending nothing is offered', async () => {
    // The configured Control Plane does not resolve, which is what an
    // intranet Runner meets when it is off the network.
    const { origin } = await bench()
    const response = await fetch(`${origin}${SHELL_MANIFEST_PATH}`)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'unreachable' })
  })

  it('declares every service it binds', () => {
    expect(source.inject).toEqual(['webServer', 'teamAccountClient'])
  })
})
