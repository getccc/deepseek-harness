/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-http-transport`.
 * @module @deepseek-ai/dsh-llm-http-transport/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-http-transport'

/** Cordis companion plugin name. */
export const name = 'llm-http-transport-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package declares an abstract service and one closed
// operation list, mounting nothing. What matters — a request reaching only the
// provider its transport chose — belongs to whichever transport is mounted.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
