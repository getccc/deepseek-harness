/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-quota-sqlite`.
 * @module @deepseek-ai/dsh-quota-sqlite/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-quota-sqlite'

/** Cordis companion plugin name. */
export const name = 'quota-sqlite-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: what this ledger must hold — at most one settlement per
// reservation, a positive reservation, and non-negative token counts — is
// declared to SQLite as a primary key and CHECK constraints, so a violating
// write is refused rather than admitted for a runtime check to find afterwards.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
