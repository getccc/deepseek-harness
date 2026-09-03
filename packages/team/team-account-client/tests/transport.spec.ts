/**
 * The trust a Runner's Control Plane calls carry.
 *
 * What is asserted here is the seam around the trust: which fetch a call goes
 * through, that a named certificate file must exist before the plugin runs at
 * all, and that unloading releases the connection pool. That a pinned
 * certificate is the *only* one accepted is a property of the TLS handshake
 * rather than of this module, and is covered against a real Control Plane
 * serving a privately signed certificate — proving it here would mean
 * committing a signing key to the repository.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { controlPlaneFetch } from '../src/transport.ts'

let plane: Server
let origin: string
let directory: string

/** A certificate file holding one PEM block, which is all the agent reads at construction. */
function certificateFile(name: string): string {
  const path = join(directory, name)
  // Undici reads this only when a connection is verified, so the bytes need to
  // be a certificate the agent accepts at construction, not a usable trust
  // anchor for any server this test starts.
  writeFileSync(path, [
    '-----BEGIN CERTIFICATE-----',
    'MIIBFzCBvqADAgECAgEBMAoGCCqGSM49BAMCMA8xDTALBgNVBAMMBHRlc3QwHhcN',
    'MjYwOTAyMDAwMDAwWhcNMzYwOTAyMDAwMDAwWjAPMQ0wCwYDVQQDDAR0ZXN0MFkw',
    'EwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2QqTPfHMGvDZLXTRDLYPjHVWlXFcNXCz',
    'Q6kNnKmVIVvcnUgLjMEcMRVvOL0Kg6QqxvBEwqzTGe9GxKPTr1sPGqMQMA4wDAYD',
    'VR0TBAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiEA0000000000000000000000',
    '-----END CERTIFICATE-----',
    '',
  ].join('\n'))
  return path
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'dsh-transport-'))
  plane = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  plane.listen(0, '127.0.0.1')
  await once(plane, 'listening')
  const address = plane.address()
  origin = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`
})

afterEach(async () => {
  plane.close()
  await once(plane, 'close')
  rmSync(directory, { recursive: true, force: true })
})

describe('the Control Plane fetch', () => {
  it('reaches the Control Plane when no certificate is named', async () => {
    const ctx = new Context()
    const call = controlPlaneFetch(ctx, undefined)
    const response = await call(new URL('/team/device/login', origin))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('reaches the Control Plane when one is', async () => {
    const ctx = new Context()
    const call = controlPlaneFetch(ctx, certificateFile('ca.crt'))
    const response = await call(new URL('/team/device/login', origin))
    expect(response.status).toBe(200)
    await ctx.fiber.dispose()
  })

  it('refuses to start when the named certificate cannot be read', () => {
    const ctx = new Context()
    expect(() => controlPlaneFetch(ctx, join(directory, 'absent.crt')))
      .toThrow(/ENOENT|no such file/u)
  })

  it('releases the connection pool when the plugin unloads', async () => {
    const ctx = new Context()
    const call = controlPlaneFetch(ctx, certificateFile('ca.crt'))
    await call(new URL('/team/device/login', origin))
    await ctx.fiber.dispose()
    // A closed agent refuses the next call rather than opening a socket the
    // unloaded plugin would own.
    await expect(call(new URL('/team/device/login', origin))).rejects.toThrow()
  })
})
