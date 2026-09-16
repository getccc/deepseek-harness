/**
 * A composition row that masks global tools for the agents joined to its
 * scope: everything outside `allow`, or everything inside `deny`, leaves the
 * catalog those agents see. It is the configuration face of
 * `ctx.tools.restrict()`, so a preset can state its tool surface in its own
 * composition file instead of trusting every host-plane tool's own visibility
 * rule.
 *
 * Scope-only, like the persona row: mounted inside an agent preset it applies
 * to every agent that joins that preset; mounted in the host composition it
 * fails loud, because a context-global restriction would mask every agent.
 * Names are validated against the global tools registered when the row
 * mounts, so a `deny` naming a tool the deployment never registered fails the
 * mount rather than silently guarding nothing. `allowWhenRegistered` is the one
 * deliberate exception: a shipped preset can keep a tool that only some
 * deployments register without failing the others.
 * @module @deepseek-ai/dsh-tool-restriction
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'tool-restriction'

/** The registry this row restricts. */
export const inject = ['tools']

/**
 * Plugin config: the mask, as `ctx.tools.restrict()` takes it. The schema
 * requires at least one list — a row naming neither fails validation — and
 * an absent list is never read as an empty one: `allow: []` masks every
 * global tool. Both lists together intersect.
 */
export interface Config {
  /** Global tool names that stay visible; every other global tool is removed. `[]` removes them all. */
  allow?: string[]
  /**
   * Global tool names that also stay visible, but only when some deployment
   * row has registered them by the time this row mounts; an absent one is
   * skipped rather than refused. Beside `allow` only.
   *
   * For a shipped preset that should reach a tool some deployments add — the
   * `chat` preset and Team knowledge search — without failing every deployment
   * that does not. The price is the name check `allow` gets: a misspelling
   * here masks the tool instead of failing, so list only names a registering
   * package owns. Resolved once, at mount: a tool registered afterwards stays
   * masked until the preset mounts again.
   */
  allowWhenRegistered?: string[]
  /** Global tool names removed from visibility. */
  deny?: string[]
}

/** Runtime schema for the restriction row: one of the two lists is required. */
export const Config: z<Config> = z.union([
  z.object({
    allow: z.array(z.string()).required(),
    allowWhenRegistered: z.array(z.string()),
  }),
  z.object({ deny: z.array(z.string()).required() }),
])

/**
 * Install the mask for the mounting context's scope.
 * @param ctx - an agent-scope context; an unscoped context is refused by the registry.
 * @param config - the allow-list or the deny-list.
 */
export function apply(ctx: Context, config: Config): void {
  const { allowWhenRegistered, ...restriction } = config
  // Read from the global view, which is what a restriction masks: the scope's
  // own view would already be missing a tool some nearer layer hides.
  const present = (allowWhenRegistered ?? []).filter(name => ctx.tools.get(name) !== undefined)
  const mask = restriction.allow === undefined ? restriction : { ...restriction, allow: [...restriction.allow, ...present] }
  ctx.effect(() => ctx.tools.restrict(mask), 'tool-restriction: mask')
}
