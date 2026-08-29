/**
 * REAL-composition tier (packages/AGENTS.md): boot the workspace Loader
 * fixture as a subprocess through the same app/boot path a deployment uses,
 * with real JSONL session persistence and a real storage domain, and assert
 * that one Runner holds several project directories at once and rebuilds that
 * grouping after a restart.
 *
 * The registry's unit suite covers bootstrap ordering and rollback against a
 * hand-built context. What only a real boot can show is that the composed
 * tree wires persistence, storage, and the registry together well enough for
 * a session's `cwd` to reach the workspace it belongs to, and to survive a
 * process boundary.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/loader/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/loader/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface Group {
  readonly title: string
  readonly path: string
  readonly sessionIds: string[]
}

interface WorkspaceLoaderReport {
  readonly created: Group[]
  readonly resumed: Group[]
  readonly rebuilt: Group[]
}

describe('workspace registry through a real Loader composition', () => {
  it('holds several project directories at once and rebuilds them after a restart', async () => {
    let report: WorkspaceLoaderReport | undefined
    const { stderr } = await runLoaderSmoke({
      label: 'workspace loader smoke',
      tempDirPrefix: 'workspace-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        report = JSON.parse(await readFile(join(cwd, 'workspace-loader-report.json'), 'utf8')) as WorkspaceLoaderReport
      },
    })
    expect(stderr).not.toContain('UNHANDLED')
    expect(report).toBeDefined()
    const { created, resumed, rebuilt } = report!

    // Newest-first registry order: beta was created second, so it leads.
    expect(created.map(group => group.title)).toEqual(['project-beta', 'project-alpha'])
    // Each session grouped into its own workspace by cwd, not into a shared one.
    expect(created.map(group => group.sessionIds)).toEqual([['loader-session-1'], ['loader-session-0']])
    expect(new Set(created.map(group => group.path)).size).toBe(2)

    // A plain restart reloads the registry's own durable records.
    expect(resumed).toEqual(created)

    // With those records deleted, the one-time history bootstrap re-derives
    // the same projects from session headers alone. This is the path that
    // recovers a Runner whose registry storage was lost, and the only one
    // that proves cwd — not a cached record — carries the grouping.
    expect(rebuilt.map(group => group.path).sort()).toEqual(created.map(group => group.path).sort())
    expect(rebuilt.map(group => group.sessionIds).flat().sort())
      .toEqual(['loader-session-0', 'loader-session-1'])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
