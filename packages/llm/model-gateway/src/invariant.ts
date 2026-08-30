/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-model-gateway`.
 * @module @deepseek-ai/dsh-model-gateway/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-model-gateway'

/** Cordis companion plugin name. */
export const name = 'model-gateway-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package declares an abstract service, two word
// lists, and one pure body rewrite. The relation that matters — a call reaching
// only the model and endpoint the catalog names — belongs to whichever provider
// makes the decision, and its tests own it.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
