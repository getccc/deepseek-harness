/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-audit`.
 * @module @deepseek-ai/dsh-audit/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-audit'

/** Cordis companion plugin name. */
export const name = 'audit-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package declares an abstract service and two static
// catalogs, mounting nothing. The relation that matters — a stored record
// carrying only what its action declares — is checked where a record is
// written, by the provider's own schema and its tests.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
