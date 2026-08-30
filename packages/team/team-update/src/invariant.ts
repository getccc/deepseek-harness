/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-team-update`.
 * @module @deepseek-ai/dsh-team-update/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-update'

/** Cordis companion plugin name. */
export const name = 'team-update-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package is a pure decision over a manifest and what
// this computer is. It mounts nothing, holds no state, and the relation that
// matters — a release installed only when its signature verifies — is a
// property of one function, which its tests observe directly.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
