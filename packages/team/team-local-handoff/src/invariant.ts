/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-team-local-handoff`.
 * @module @deepseek-ai/dsh-team-local-handoff/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-local-handoff'

/** Cordis companion plugin name. */
export const name = 'team-local-handoff-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package registers three navigation routes. Their
// one owned relation — a callback accepted only against the state this process
// minted, and only once — lives entirely inside a single request handler, where
// its tests observe it directly.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
