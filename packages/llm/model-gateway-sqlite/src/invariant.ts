/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-model-gateway-sqlite`.
 * @module @deepseek-ai/dsh-model-gateway-sqlite/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-model-gateway-sqlite'

/** Cordis companion plugin name. */
export const name = 'model-gateway-sqlite-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: what the catalog must hold — one row per stable ref
// within an organization, a positive output ceiling, and a status the word list
// governs — is declared to SQLite as a primary key and CHECK constraints, so a
// violating write is refused rather than admitted for a runtime check to find.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
