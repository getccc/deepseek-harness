/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list, and the layer must move the
 * Team Runner off the port `dsh web` already defaults to.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'

const root = fileURLToPath(new URL('..', import.meta.url))

interface PatchRow {
  id?: string
  name?: string
  config?: Record<string, unknown>
  insert?: PatchRow[]
}

function patchRows(): PatchRow[] {
  const parsed = yaml.load(
    readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError('team patch must parse to a patch list')
  return parsed as PatchRow[]
}

describe('dsh-team bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as { dsh?: { bundle?: { patch?: string } } }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(Array.isArray(patchRows())).toBe(true)
  })

  it('separates the rows it overrides from the plugins it adds', () => {
    for (const row of patchRows()) {
      if (row.insert === undefined) {
        // An override targets a row an earlier layer inserted, so it names an
        // id and never a plugin: naming one would silently create a new row
        // instead of replacing the intended config.
        expect(row.name).toBeUndefined()
        expect(row.id).toBeTypeOf('string')
        continue
      }
      // An insert is new, so every row in it names both.
      for (const inserted of row.insert) {
        expect(inserted.id).toBeTypeOf('string')
        expect(inserted.name).toBeTypeOf('string')
      }
    }
  })

  it('adds the team account, the local handoff, and the company model transport', () => {
    const inserted = new Map(patchRows().flatMap(row => row.insert ?? [])
      .map(row => [row.id as string, row.name as string]))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    for (const [id, name] of [
      ['team-account-client', '@deepseek-ai/dsh-team-account-client'],
      ['team-local-handoff', '@deepseek-ai/dsh-team-local-handoff'],
      ['llm-http-transport', '@deepseek-ai/dsh-llm-http-transport-team'],
    ] as const) {
      expect(inserted.get(id), id).toBe(name)
      expect(manifest.dependencies ?? {}, id).toHaveProperty(name)
    }
  })

  it('leaves the company and the version unnamed, so a Runner nobody configured does not bind', () => {
    // A Runner that guessed its Control Plane would send a public key to a
    // stranger, and one that invented a version would put a wrong fact in
    // front of the administrator reading the device list.
    const client = patchRows().flatMap(row => row.insert ?? [])
      .find(row => row.id === 'team-account-client')
    expect(client?.config).not.toHaveProperty('controlPlaneUrl')
    expect(client?.config).not.toHaveProperty('runnerVersion')
  })

  it('points the callback at the same loopback port the Runner binds', () => {
    // The address is bound into every authorization code and compared on
    // redemption, so a callback naming another port is a binding that always
    // fails at the last step.
    const client = patchRows().flatMap(row => row.insert ?? [])
      .find(row => row.id === 'team-account-client')
    const expression = (client?.config?.['callbackUri'] as { __jsExpr: string }).__jsExpr
    expect(evaluate({ ctx: { webStartup: {} } }, expression)).toBe('http://127.0.0.1:3090/team/callback')
    expect(evaluate({ ctx: { webStartup: { port: 4200 } } }, expression))
      .toBe('http://127.0.0.1:4200/team/callback')
  })

  it('defaults the Team Runner to a port dsh web does not already claim', () => {
    const webserver = patchRows().find(row => row.id === 'webserver')
    expect(webserver).toBeDefined()
    // `dsh web` composes `?? 3080`; a Team Runner is a background service that
    // must coexist with it, so the two defaults may never converge.
    const expression = (webserver!.config!['port'] as { __jsExpr: string }).__jsExpr
    const port: unknown = evaluate({ ctx: { webStartup: {} } }, expression)
    expect(port).toBe(3090)
    expect(port).not.toBe(3080)
  })

  it('keeps --port authoritative over the composed default', () => {
    const webserver = patchRows().find(row => row.id === 'webserver')!
    const expression = (webserver.config!['port'] as { __jsExpr: string }).__jsExpr
    expect(evaluate({ ctx: { webStartup: { port: 8080 } } }, expression)).toBe(8080)
  })

  it('restates every webserver config key it owns, because a patch replaces the whole config', () => {
    const webserver = patchRows().find(row => row.id === 'webserver')!
    expect(Object.keys(webserver.config!).sort()).toEqual([
      'compression',
      'compressionLevel',
      'compressionThresholdBytes',
      'host',
      'port',
    ])
  })
})
