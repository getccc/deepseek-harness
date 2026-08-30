/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-team-admin-app`.
 * @module @deepseek-ai/dsh-team-admin-app/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-admin-app'

/** Cordis companion plugin name. */
export const name = 'team-admin-app-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package reads files out of one directory and holds
// no state. The relation that matters — a request never leaving that directory
// — is a property of one path comparison, which its tests observe directly.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
