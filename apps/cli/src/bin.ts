#!/usr/bin/env node
/**
 * Command-line entry for dsh.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { isPackagedExecutable, loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from './args.ts'
import { carriedScript } from './node-carrier.ts'

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/**
 * Run the public dsh command-line interface.
 * @returns a promise that settles when the selected command mode finishes.
 */
export async function runCli(): Promise<void> {
  const invocation = parseDshArgs(process.argv.slice(2), readVersion())

  switch (invocation.mode) {
    case 'profile': {
      const { runProfile } = await import('./profile-boot.ts')
      await runProfile({
        environment: loadLayeredEnv('dsh'),
        profile: invocation.profile,
        fromDefaultProfile: invocation.fromDefaultProfile,
        patchFiles: invocation.patches,
        args: invocation.args,
      })
      break
    }
    case 'plugin': {
      const { runPlugin } = await import('./plugin.ts')
      process.exit(runPlugin(invocation.profile, invocation.args))
      break
    }
    case 'dump-config': {
      const { runDumpConfig } = await import('./dump-config.ts')
      runDumpConfig(
        invocation.profile,
        invocation.defaultOnly,
        invocation.patches,
        invocation.fromDefaultProfile,
      )
      break
    }
    default:
      invocation satisfies never
      throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
  }
}

/**
 * Run one executable launch. A child of the packaged executable that spawned
 * `process.execPath` with its own script is served before the launcher
 * grammar: argv becomes what `node <script>` gives, and Node's own main-module
 * path runs it. Every other launch runs {@link runCli}. The single-file
 * runtime's bootstrap calls this, because there this module is not the main
 * module.
 * @returns a promise that settles when the CLI finishes, or at once for a carried script.
 */
export async function runExecutable(): Promise<void> {
  const carried = isPackagedExecutable() ? carriedScript(process.argv.slice(2), existsSync) : undefined
  if (carried !== undefined) {
    process.argv.splice(1, 1)
    const { runMain } = createRequire(import.meta.url)('node:module') as { runMain: () => void }
    runMain()
    return
  }
  await runCli()
}

if (import.meta.main) await runExecutable()
