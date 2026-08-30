/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-model-gateway-http`.
 * @module @deepseek-ai/dsh-model-gateway-http/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-model-gateway-http'

/** Cordis companion plugin name. */
export const name = 'model-gateway-http-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the endpoint verifies a token, asks the gateway, and
// streams a response. Each relation worth checking — a token naming a live
// device, a plan naming a governed model, a settlement happening once — belongs
// to the seam that owns it, and their stores and tests own them.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
