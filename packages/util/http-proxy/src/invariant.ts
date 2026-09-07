/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-http-proxy`.
 * @module @deepseek-ai/dsh-http-proxy/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-http-proxy'

/** Cordis companion plugin name. */
export const name = 'http-proxy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the policy is resolved once from the launch environment and installed as
 * one process-wide dispatcher; this package owns no event stream or mutable runtime data, and its
 * routing and bypass rules are enforced by unit tests and the bare-dispatcher gate.
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
