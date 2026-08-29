/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-team-account-client`.
 * @module @deepseek-ai/dsh-team-account-client/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-account-client'

/** Cordis companion plugin name. */
export const name = 'team-account-client-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package holds two credential records and calls the
// Control Plane. The relation that matters — a credential naming a device that
// proved possession of its key — is established by the Control Plane, not here,
// and this side has no authoritative stream to check it against.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
