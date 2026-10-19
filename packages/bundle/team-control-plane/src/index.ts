/**
 * The Team Edition Control Plane profile's command-line provider. A successful
 * parse publishes {@link TEAM_CONTROL_PLANE_STARTUP_SERVICE}; every other row in
 * `cordis.patch.yml` waits for that service, so help opens no store and binds no
 * listener.
 * @module @deepseek-ai/dsh-team-control-plane
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'team-control-plane-startup'

/** Launcher service required before this app can parse its invocation. */
export const inject = ['cmdlineArgs']

/** Service every Control Plane row waits for before it starts. */
export const TEAM_CONTROL_PLANE_STARTUP_SERVICE = 'teamControlPlaneStartup'

/** Control Plane startup configuration. */
export interface Config {
  /** Profile name rendered in help and diagnostics (default `team-control-plane`). */
  profile?: string
}

/** Validate and default Control Plane startup configuration. */
export const Config: z<Config> = z.object({
  profile: z.string().default('team-control-plane'),
})

/**
 * Build this app's zero-option command and help.
 * @param profile - selected profile name rendered in the command grammar.
 * @returns a fresh program for one invocation.
 */
function controlPlaneCommand(profile: string): Command {
  return new Command()
    .name(`dsh --profile ${profile}`)
    .description('Serve the DeepSeek Harness Team Edition Control Plane over HTTP.')
    .helpOption('-h, --help', 'show this help')
    .addHelpText('after', `
Example:
  dsh --profile ${profile}     serve the Control Plane until the process is stopped
`)
}

/**
 * Accept a Control Plane profile invocation and publish readiness.
 * @param ctx - plugin context carrying the launcher's command-line values.
 * @param config - selected profile identity for command help.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const program = controlPlaneCommand(config.profile ?? 'team-control-plane')
  program.action(() => {
    ctx.provide(TEAM_CONTROL_PLANE_STARTUP_SERVICE, { accepted: true })
  })
  parseCmdline(ctx, program)
}
