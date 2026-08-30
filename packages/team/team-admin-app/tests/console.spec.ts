/**
 * Serving the console: what is reachable under its address and what is not.
 *
 * The property worth testing here is the one whose mistakes are a directory
 * traversal, so the requests are the ones an attacker would send rather than
 * the ones a browser does.
 */

import { request as httpRequest } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as consoleApp from '../src/index.ts'

/** One response, read the way a browser would see it. */
interface Landing {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

let ctx: Context
let origin: string

/** Make one request. */
function send(path: string, method = 'GET'): Promise<Landing> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${origin}${path}`, { method }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      res.on('end', () => {
        resolve({
          status: res.statusCode as number,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await ctx.plugin(consoleApp).await()
  origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('serving the administration console', () => {
  it('serves the page at its address, with and without a trailing slash', async () => {
    for (const path of ['/team/admin', '/team/admin/']) {
      const shown = await send(path)
      expect(shown.status, path).toBe(200)
      expect(shown.headers['content-type'], path).toContain('text/html')
      // The build uses relative asset URLs, so the served page has to say what
      // they are relative to; without it, the no-slash form resolves them one
      // directory too high.
      expect(shown.body, path).toContain('<base href="/team/admin/">')
      expect(shown.body, path).toContain('<div id="root">')
    }
  })

  it('serves the application-s own files', async () => {
    const page = await send('/team/admin/')
    const asset = /src="\.\/(assets\/[^"]+\.js)"/u.exec(page.body)?.[1]
    expect(asset, 'the page should load a module').toBeDefined()
    const served = await send(`/team/admin/${asset as string}`)
    expect(served.status).toBe(200)
    expect(served.headers['content-type']).toContain('text/javascript')
  })

  it('refuses to leave the directory it serves', async () => {
    // Both the encoded and the plain form, because only one of them survives
    // the URL parser and the other is what a proxy might hand over.
    for (const path of [
      '/team/admin/%2e%2e/%2e%2e/package.json',
      '/team/admin/../../package.json',
    ]) {
      const refused = await send(path)
      expect([403, 404], path).toContain(refused.status)
      expect(refused.body, path).not.toContain('"name"')
    }
  })

  it('answers a file it does not have', async () => {
    expect((await send('/team/admin/assets/no-such-file.js')).status).toBe(404)
  })

  it('refuses a method that would change something', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect((await send('/team/admin/', method)).status, method).toBe(405)
    }
  })
})
