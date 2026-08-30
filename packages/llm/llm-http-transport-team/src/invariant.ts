/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-http-transport-team`.
 * @module @deepseek-ai/dsh-llm-http-transport-team/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-http-transport-team'

/** Cordis companion plugin name. */
export const name = 'llm-http-transport-team-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the transport reads an access token per call and posts
// a body. It holds no state, and the relation that matters — no credential and
// no address in what it sends — is a property of the request it builds, which
// its tests read directly.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
