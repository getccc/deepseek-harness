/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-knowledge-gateway-sqlite`.
 * @module @deepseek-ai/dsh-knowledge-gateway-sqlite/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-knowledge-gateway-sqlite'

/** Cordis companion plugin name. */
export const name = 'knowledge-gateway-sqlite-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider publishes no event stream, and its owned
 * relationship — that every returned passage came from a knowledge base this
 * request authorized — is enforced inside `search` and asserted by the
 * package's tests, where a source can answer with a base nobody named. The
 * catalog-to-managed-resource correspondence is repaired by the next
 * synchronization rather than asserted continuously, because the two databases
 * cannot commit together.
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
