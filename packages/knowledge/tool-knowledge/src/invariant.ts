/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-knowledge`.
 * @module @deepseek-ai/dsh-tool-knowledge/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-knowledge'

/** Cordis companion plugin name. */
export const name = 'tool-knowledge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns one tool registration, one prompt
 * section, and a per-agent restriction, all of which the tools registry and
 * the prompt registry already hold to. Its own relationship — that the
 * section and the tool agree, because both fold the same Session log — is
 * asserted by the package's tests over a real log rather than watched at
 * runtime.
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
