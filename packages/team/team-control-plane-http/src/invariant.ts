/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-team-control-plane-http`.
 * @module @deepseek-ai/dsh-team-control-plane-http/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-control-plane-http'

/** Cordis companion plugin name. */
export const name = 'team-control-plane-http-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package registers three HTTP routes that parse a
// body and hand it to the device-authorization seam. Every relation worth
// checking — a code spent once, a signature that verifies, a family revoked on
// replay — belongs to that seam and its store, and their tests own it.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
