/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-account-auth-password`.
 * @module @deepseek-ai/dsh-account-auth-password/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-account-auth-password'

/** Cordis companion plugin name. */
export const name = 'account-auth-password-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: every relation this provider must hold is between a
// call and the account store's own rows — a failure increments the counter, a
// success clears it — and the store is the authority for both. There is no
// mutable state here for a runtime check to read; the package's tests assert
// the transitions against a real store.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
