/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-access-control-sqlite`.
 * @module @deepseek-ai/dsh-access-control-sqlite/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-access-control-sqlite'

/** Cordis companion plugin name. */
export const name = 'access-control-sqlite-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the durable relations this backend must hold — a grant
// naming a permission this build governs, a binding naming a role that exists,
// a resource unique within its organization and type — are declared to SQLite
// as foreign keys and unique indexes, so a violating write is refused rather
// than admitted for a runtime check to find afterwards.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
