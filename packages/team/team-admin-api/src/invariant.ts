/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-team-admin-api`.
 * @module @deepseek-ai/dsh-team-admin-api/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-admin-api'

/** Cordis companion plugin name. */
export const name = 'team-admin-api-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: this package owns no data of its own. Every write it
// accepts lands in the account, access-control, device, or model service that
// owns it, and each of those checks its own relations; the relation this
// package would assert — an allowed write beside its audit row — is asserted
// by the audit package against the stream it owns.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
