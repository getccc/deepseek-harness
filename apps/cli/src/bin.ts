#!/usr/bin/env node
/**
 * Command-line entry for dsh.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { getDshRuntimeVersion, isPackagedExecutable, loadLayeredEnv, StartupError } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseDshArgs } from './args.ts'
import { carriedScript } from './node-carrier.ts'
import { reportStartupFailure } from './startup-diagnostics.ts'

/**
 * Run the public dsh command-line interface.
 * @returns a promise that settles when the selected command mode finishes.
 */
export async function runCli(): Promise<void> {
  const version = getDshRuntimeVersion()
  const invocation = parseDshArgs(process.argv.slice(2), version)

  switch (invocation.mode) {
    case 'profile': {
      const { runProfile } = await import('./profile-boot.ts')
      try {
        await runProfile({
          environment: loadLayeredEnv('dsh'),
          profile: invocation.profile,
          fromDefaultProfile: invocation.fromDefaultProfile,
          patchFiles: invocation.patches,
          args: invocation.args,
        })
      } catch (error) {
        if (!(error instanceof StartupError)) throw error
        await reportStartupFailure(error, { home: resolveDshHome(), version, profile: invocation.profile })
        process.exit(1)
      }
      break
    }
    case 'plugin': {
      const { runPlugin } = await import('./plugin.ts')
      process.exit(await runPlugin(invocation.profile, invocation.args))
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
    case 'dump-config-schema': {
      const { runDumpConfigSchema } = await import('./dump-config-schema.ts')
      await runDumpConfigSchema(invocation.profile, invocation.patches, invocation.fromDefaultProfile)
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
