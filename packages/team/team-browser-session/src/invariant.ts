/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-team-browser-session`.
 * @module @deepseek-ai/dsh-team-browser-session/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-browser-session'

/** Cordis companion plugin name. */
export const name = 'team-browser-session-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package is pure functions over one request and one
// store lookup. It mounts nothing, holds no state, and the relations that
// matter — a cookie resolving to the session whose hash the store holds, a
// CSRF value that is a function of the token and not the token itself — are
// properties its tests observe directly.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
