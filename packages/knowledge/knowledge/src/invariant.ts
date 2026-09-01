/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-knowledge`.
 * @module @deepseek-ai/dsh-knowledge/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-knowledge'

/** Cordis companion plugin name. */
export const name = 'knowledge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the seam owns no registry and observes no stream of
 * its own. Scope is a fold over the Session log, which `dsh-session` already
 * holds to, and every authorization relationship this capability depends on
 * lives in the Control Plane rather than in this process.
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
