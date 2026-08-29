/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-device-authorization-sqlite`.
 * @module @deepseek-ai/dsh-device-authorization-sqlite/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-device-authorization-sqlite'

/** Cordis companion plugin name. */
export const name = 'device-authorization-sqlite-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: what this backend must hold — one device row per key
// within an organization, a code hash unique across transactions, a token hash
// unique across families, and a confirmed transaction naming an account — is
// declared to SQLite as unique indexes and CHECK constraints, so a violating
// write is refused rather than admitted for a runtime check to find afterwards.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
