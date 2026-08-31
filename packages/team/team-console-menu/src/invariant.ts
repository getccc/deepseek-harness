/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-team-console-menu`.
 * @module @deepseek-ai/dsh-team-console-menu/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-console-menu'

/** Cordis companion plugin name. */
export const name = 'team-console-menu-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package declares an abstract service, a shipped
// catalog, and one pure check over the permission catalog. The relation that
// matters — an organization's stored tree against the entries this build
// ships — belongs to whichever provider seeds it, and its tests own it.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
