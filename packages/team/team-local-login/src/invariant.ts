/** Package-owned invariant companion for `@deepseek-ai/dsh-team-local-login`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-local-login'

/** Cordis companion plugin name. */
export const name = 'team-local-login-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// The package owns request-local relations proven directly by its route tests;
// there is no independent mutable relationship for a runtime probe to inspect.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
