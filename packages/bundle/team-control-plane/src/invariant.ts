/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-team-control-plane`.
 * @module @deepseek-ai/dsh-team-control-plane/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-team-control-plane'

/** Cordis companion plugin name. */
export const name = 'team-control-plane-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package is a static patch-list carrier (a YAML
// document of loader rows owned by other packages); it mounts no service,
// emits no events, and owns no mutable relation to check. The absence of local
// execution capability is a composition fact, asserted by this package's tests
// against the patch list and the profile template, not observable at runtime.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
