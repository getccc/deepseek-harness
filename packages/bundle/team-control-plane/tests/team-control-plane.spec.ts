/**
 * The Control Plane holds company credentials and answers every member Runner,
 * so it must not be able to execute code, read files, or drive an Agent on the
 * machine it runs on. That is a composition fact, and these tests are what
 * hold it: they fail the moment a row reintroduces one of those capabilities.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const root = fileURLToPath(new URL('..', import.meta.url))

interface Row {
  id?: string
  name?: string
  config?: Record<string, unknown>
  insert?: Row[]
}

/**
 * Every package that executes code, reaches the filesystem, or drives an Agent
 * on its host. Named individually rather than matched by prefix so that adding
 * a capability package forces a deliberate decision here instead of silently
 * matching or silently escaping a pattern.
 */
const LOCAL_EXECUTION_PACKAGES: readonly string[] = [
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-agent-spine-demo',
  '@deepseek-ai/dsh-fs-local',
  '@deepseek-ai/dsh-fs-sandbox',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-sandbox-local',
  '@deepseek-ai/dsh-bash-local',
  '@deepseek-ai/dsh-bash-sandbox',
  '@deepseek-ai/dsh-pwsh-local',
  '@deepseek-ai/dsh-pwsh-sandbox',
  '@deepseek-ai/dsh-terminal',
  '@deepseek-ai/dsh-terminal-bash',
  '@deepseek-ai/dsh-lsp-stdio',
  '@deepseek-ai/dsh-code-runtime-worker-thread',
  '@deepseek-ai/dsh-code-runtime-python',
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-bash-persistent',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-tool-pwsh-persistent',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-tool-str-replace-editor',
  '@deepseek-ai/dsh-tool-terminal',
  '@deepseek-ai/dsh-tool-lsp',
]

function rows(): Row[] {
  const parsed = yaml.load(
    readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError('control-plane patch must parse to a patch list')
  return (parsed as Row[]).flatMap(patch => patch.insert ?? [])
}

describe('dsh-team-control-plane bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as { dsh?: { bundle?: { patch?: string } } }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(rows().length).toBeGreaterThan(0)
  })

  it('is a standalone tree: every row names its plugin, because nothing earlier inserted it', () => {
    for (const row of rows()) {
      expect(row.id).toBeTypeOf('string')
      expect(row.name).toBeTypeOf('string')
    }
  })

  it('mounts no plugin that executes code, reads files, or drives an Agent', () => {
    const mounted = new Set(rows().map(row => row.name))
    for (const forbidden of LOCAL_EXECUTION_PACKAGES) {
      expect(mounted.has(forbidden), `${forbidden} must not appear in the Control Plane tree`).toBe(false)
    }
  })

  it('declares no dependency on a local-execution package, so no row can reach one', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    // The Loader resolves a bare plugin specifier through the declaring
    // manifest, so an absent dependency is a second, independent barrier: a
    // row added without also declaring its package fails to load rather than
    // quietly mounting.
    for (const forbidden of LOCAL_EXECUTION_PACKAGES) {
      expect(manifest.dependencies ?? {}).not.toHaveProperty(forbidden)
    }
  })

  it('mounts every company service the Control Plane is, each declared as a dependency', () => {
    const mounted = new Map(rows().map(row => [row.id as string, row.name as string]))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    for (const [id, name] of [
      ['account-store', '@deepseek-ai/dsh-account-store-sqlite'],
      ['account-auth', '@deepseek-ai/dsh-account-auth-password'],
      ['access-control', '@deepseek-ai/dsh-access-control-sqlite'],
      ['audit', '@deepseek-ai/dsh-audit-sqlite'],
      ['device-authorization', '@deepseek-ai/dsh-device-authorization-sqlite'],
      ['team-control-plane-http', '@deepseek-ai/dsh-team-control-plane-http'],
      ['team-shell', '@deepseek-ai/dsh-team-shell'],
    ] as const) {
      expect(mounted.get(id), id).toBe(name)
      expect(manifest.dependencies ?? {}, id).toHaveProperty(name)
    }
  })

  it('writes every store under the DSH home, not the working directory', () => {
    // A background service is started from wherever the service manager
    // happens to be; a relative path would scatter one deployment's data
    // across whatever directories it was launched from.
    //
    const stores = rows().filter(row => row.config?.['path'] !== undefined)
    expect(stores).toHaveLength(4)
    for (const row of stores) {
      const expression = (row.config?.['path'] as { __jsExpr: string }).__jsExpr
      expect(expression, row.id).toMatch(/^dshHomePath\('control-plane', '[a-z]+\.sqlite'\)$/u)
    }
  })

  it('leaves the organization unnamed, so a Control Plane nobody configured does not start', () => {
    // The Team Shell requires it and refuses to load without it. Supplying a
    // default here would mean authenticating members against an organization
    // no one chose.
    const shell = rows().find(row => row.id === 'team-shell')
    expect(shell?.config).not.toHaveProperty('organizationId')
  })

  it('binds loopback by default, leaving network exposure to a deployment patch', () => {
    const webserver = rows().find(row => row.id === 'webserver')
    expect(webserver?.config).toMatchObject({ host: '127.0.0.1' })
    // Distinct from the Team Runner (3090) and dsh web (3080): a maintainer
    // running all three during development must not hit a bind conflict.
    expect(webserver?.config?.['port']).toBe(3095)
  })
})
