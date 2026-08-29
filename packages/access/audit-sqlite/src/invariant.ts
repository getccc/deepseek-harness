/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-audit-sqlite`.
 * @module @deepseek-ai/dsh-audit-sqlite/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-audit-sqlite'

/** Cordis companion plugin name. */
export const name = 'audit-sqlite-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: what this backend must hold — an event naming an action
// this build audits, metadata naming a registered key, every token column short
// and plain, and no row ever amended or removed — is declared to SQLite as
// foreign keys, CHECK constraints, and triggers, so a violating write is
// refused rather than admitted for a runtime check to find afterwards.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
