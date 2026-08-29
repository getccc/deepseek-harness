/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-account-store`.
 * @module @deepseek-ai/dsh-account-store/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-account-store'

/** Cordis companion plugin name. */
export const name = 'account-store-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package declares an abstract service and its
// vocabulary, mounting nothing itself. Whichever provider implements the
// service owns the durable relations its rows must satisfy, and checks them.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
