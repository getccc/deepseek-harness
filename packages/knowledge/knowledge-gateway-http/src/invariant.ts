/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-knowledge-gateway-http`.
 * @module @deepseek-ai/dsh-knowledge-gateway-http/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-knowledge-gateway-http'

/** Cordis companion plugin name. */
export const name = 'knowledge-gateway-http-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the adapter holds no state between requests and
 * publishes no event stream. Its owned relationship — that a request cannot
 * name its own principal — is structural rather than observable: the body type
 * has no field for one, and the identity comes from a verified token, which
 * the package's tests exercise against a real device-authorization provider.
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
