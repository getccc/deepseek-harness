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
 * mount rather than silently guarding nothing.
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
  /** Global tool names removed from visibility. */
  deny?: string[]
}

/** Runtime schema for the restriction row: one of the two lists is required. */
export const Config: z<Config> = z.union([
  z.object({ allow: z.array(z.string()).required() }),
  z.object({ deny: z.array(z.string()).required() }),
])

/**
 * Install the mask for the mounting context's scope.
 * @param ctx - an agent-scope context; an unscoped context is refused by the registry.
 * @param config - the allow-list or the deny-list.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.tools.restrict(config), 'tool-restriction: mask')
}
