/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-open-in-app`.
 * @module @deepseek-ai/dsh-host-open-in-app/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-open-in-app'

/** Cordis companion plugin name. */
export const name = 'host-open-in-app-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the three webserver routes are registered as effects the row's disposal
 * removes, and the application catalog is resolved per pass from the launch environment and
 * PATH probes; the package emits no cordis events and keeps no cross-plugin mutable data, so the
 * host-routes spec (HMR removal, SSH refusal, shared resolution pass) is the enforcement point.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
