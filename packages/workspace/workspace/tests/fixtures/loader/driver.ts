#!/usr/bin/env node
/**
 * Test driver: boot the workspace Loader composition three times against one
 * session root, exercising both ways a Runner recovers its projects.
 *
 * 1. create   — two real project directories, a Workspace for each, and a
 *               session in each carrying that directory as its `cwd`.
 * 2. resume   — a plain restart: the registry reloads its own durable records.
 * 3. rebuild  — the registry's storage is wiped first, so the one-time history
 *               bootstrap must re-derive the same grouping from session
 *               headers alone.
 *
 * Writes `./workspace-loader-report.json` for the package spec's inspect step.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('workspace driver requires a config path')

const resolved = resolveConfigPath(configPath, undefined)
const alpha = resolve('./project-alpha')
const beta = resolve('./project-beta')

/** One workspace as a boot observed it, with the sessions that grouped into it. */
interface Group {
  readonly title: string
  readonly path: string
  readonly sessionIds: string[]
}

type BootContext = Awaited<ReturnType<typeof boot>>

/** Registry order plus the per-workspace session grouping. */
async function survey(ctx: BootContext): Promise<Group[]> {
  const headers = await ctx.sessionPersistence.list()
  return ctx.workspaceRegistry.list().map(workspace => ({
    title: workspace.title,
    path: workspace.path,
    sessionIds: headers
      .filter(snapshot => snapshot.header.cwd === workspace.path)
      .map(snapshot => String(snapshot.header.id))
      .sort(),
  }))
}

await mkdir(alpha, { recursive: true })
await mkdir(beta, { recursive: true })

// ---- first boot: register both workspaces and run one session in each ----
const first = await boot('workspace-loader-smoke', resolved)
let created: Group[]
try {
  await first.workspaceRegistry.create(alpha)
  await first.workspaceRegistry.create(beta)

  for (const [index, cwd] of [alpha, beta].entries()) {
    // Create the stored session through persistence so the header — and its
    // cwd — reaches storage; the registry rebuilds entirely from headers,
    // never from its own prior cache.
    const handle = await first.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION,
      id: SessionId(`loader-session-${String(index)}`),
      createdAt: Date.now(),
      cwd,
      isSeeded: false,
    })
    // An unmaterialized session leaves no file; one event publishes the header.
    await handle.append([{ type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } }])
    await handle.close()
  }

  created = await survey(first)
} finally {
  await first.fiber.dispose()
}

// ---- second boot: a plain restart reloads the registry's own records ----
const second = await boot('workspace-loader-smoke-resume', resolved)
let resumed: Group[]
try {
  resumed = await survey(second)
} finally {
  await second.fiber.dispose()
}

// ---- third boot: registry storage wiped, so only session headers remain ----
await rm('./storages', { force: true, recursive: true })
const third = await boot('workspace-loader-smoke-rebuild', resolved)
let rebuilt: Group[]
try {
  rebuilt = await survey(third)
} finally {
  await third.fiber.dispose()
}

await writeFile('./workspace-loader-report.json', JSON.stringify({ created, resumed, rebuilt }))
