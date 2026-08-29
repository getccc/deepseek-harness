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

  it('overrides only rows earlier layers inserted, so the layer adds no plugin of its own', () => {
    for (const row of patchRows()) {
      expect(row.insert).toBeUndefined()
      expect(row.name).toBeUndefined()
      expect(row.id).toBeTypeOf('string')
    }
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
