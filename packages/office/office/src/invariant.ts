/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-office`.
 * @module @deepseek-ai/dsh-office/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-office'

/** Cordis companion plugin name. */
export const name = 'office-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the controller holds nothing between calls, and the
 * prompt section and projection are pure folds of the Session log. The one
 * relationship — that a recorded choice is a kind this build knows — is
 * enforced inside `choose` by {@link parseOfficeChoice} and asserted by the
 * package's tests rather than watched.
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
