/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-knowledge-source`.
 * @module @deepseek-ai/dsh-knowledge-source/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-knowledge-source'

/** Cordis companion plugin name. */
export const name = 'knowledge-source-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the seam owns no registry and publishes no event
 * stream. A provider's own bounds are enforced on each call, and the
 * relationship worth asserting — that a searched knowledge base was authorized
 * — belongs to the gateway, which is the party that authorized it.
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
