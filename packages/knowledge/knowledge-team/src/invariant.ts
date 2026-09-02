/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-knowledge-team`.
 * @module @deepseek-ai/dsh-knowledge-team/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-knowledge-team'

/** Cordis companion plugin name. */
export const name = 'knowledge-team-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider holds nothing between calls and publishes
 * no event stream. Its owned relationship — that no knowledge credential or
 * address exists in this process to leak — is an absence, which the package's
 * tests assert by inspecting the requests it actually sends.
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
