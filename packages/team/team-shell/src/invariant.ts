/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-team-shell`.
 * @module @deepseek-ai/dsh-team-shell/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-shell'

/** Cordis companion plugin name. */
export const name = 'team-shell-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package registers HTTP routes that read a session,
// ask access control, and call a seam. Every relation worth checking — a
// session naming an active account, a grant admitting an action, an audit
// record carrying only catalog words — belongs to one of those seams, and
// their stores and tests own it.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
