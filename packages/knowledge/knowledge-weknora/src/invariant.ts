/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-knowledge-weknora`.
 * @module @deepseek-ai/dsh-knowledge-weknora/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-knowledge-weknora'

/** Cordis companion plugin name. */
export const name = 'knowledge-weknora-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider holds no mutable state between calls and
 * publishes no event stream. Its owned relationship — that every returned
 * passage came from a knowledge base the request named — is enforced inside
 * `search` and asserted by the package's contract tests, where a fixture can
 * answer with a base nobody asked for.
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
