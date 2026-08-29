/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-account-auth`.
 * @module @deepseek-ai/dsh-account-auth/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-account-auth'

/** Cordis companion plugin name. */
export const name = 'account-auth-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package declares an abstract service and mounts
// nothing. The relation that matters — a failed attempt leaves sign-in state
// consistent with what the account store recorded — belongs to whichever
// provider performs the attempt, and its tests own it.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
