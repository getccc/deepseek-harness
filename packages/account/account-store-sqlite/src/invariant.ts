/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-account-store-sqlite`.
 * @module @deepseek-ai/dsh-account-store-sqlite/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-account-store-sqlite'

/** Cordis companion plugin name. */
export const name = 'account-store-sqlite-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the durable relations this backend must hold — a login
// name unique inside its organization, an account belonging to an existing
// organization — are declared to SQLite as a unique index and a foreign key, so
// the database rejects a violating write rather than admitting one for a
// runtime check to find afterwards.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
