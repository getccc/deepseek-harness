/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-quota`.
 * @module @deepseek-ai/dsh-quota/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-quota'

/** Cordis companion plugin name. */
export const name = 'quota-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package declares an abstract service and two static
// word lists, mounting nothing. The relation that matters — one settlement per
// reservation, and never more than it held — belongs to whichever provider
// keeps the ledger, and its tests own it.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
