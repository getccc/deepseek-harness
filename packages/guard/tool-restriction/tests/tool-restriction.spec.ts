import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { bindScopeParent, createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as ToolRestriction from '@deepseek-ai/dsh-tool-restriction'

/** Mount the registry (with its systemPrompt dependency) on a fresh context. */
async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** Mint a scope whose key doubles as a minimal Agent-like object, optionally parented. */
async function mintScope(ctx: Context, name: string, parent?: Agent): Promise<{ scope: Scope; key: Agent }> {
  const key = { id: name as SessionId } as Agent
  if (parent !== undefined) bindScopeParent(key, parent)
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) },
    { inject: ['tools', 'systemPrompt'] }))
  return { scope, key }
}

function tool(name: string): ToolDefinition {
  return defineContentToolFixture({
    name,
    description: `tool ${name}`,
    parameters: {},
    async execute() { return [{ type: 'text', text: `ran:${name}` }] },
  })
}

const names = (ctx: Context, key: Agent): string[] => ctx.tools.schemas(key).map(t => t.name).sort()

describe('the mask a preset row declares', () => {
  it('removes every global tool from the agents joined to its scope when allow is empty', async () => {
    const ctx = await mount()
    ctx.tools.register(tool('knowledge_search'))
    ctx.tools.register(tool('web_search'))
    const standing = await mintScope(ctx, 'preset')
    await standing.scope.ctx.plugin(ToolRestriction, { allow: [] })
    const agent = await mintScope(ctx, 'agent', standing.key)

    expect(names(ctx, agent.key)).toEqual([])
    // A tool the deployment registers later is masked too: the mask is a
    // standing filter over the live global layer, not a snapshot.
    ctx.tools.register(tool('added_later'))
    expect(names(ctx, agent.key)).toEqual([])
    // Other scopes and the global view keep the whole surface.
    expect(names(ctx, (await mintScope(ctx, 'other')).key)).toEqual(['added_later', 'knowledge_search', 'web_search'])
  })

  it('keeps a tool named as allowed-when-registered only in a deployment that registered it', async () => {
    // A Team deployment registers knowledge search before any preset mounts;
    // a deployment that never registers it must still compose the preset.
    const team = await mount()
    team.tools.register(tool('knowledge_search'))
    team.tools.register(tool('web_search'))
    const teamPreset = await mintScope(team, 'preset')
    await teamPreset.scope.ctx.plugin(ToolRestriction, { allow: [], allowWhenRegistered: ['knowledge_search'] })
    expect(names(team, (await mintScope(team, 'agent', teamPreset.key)).key)).toEqual(['knowledge_search'])

    const plain = await mount()
    plain.tools.register(tool('web_search'))
    const plainPreset = await mintScope(plain, 'preset')
    await plainPreset.scope.ctx.plugin(ToolRestriction, { allow: [], allowWhenRegistered: ['knowledge_search'] })
    expect(names(plain, (await mintScope(plain, 'agent', plainPreset.key)).key)).toEqual([])
    // Registered after the row mounted, it stays masked: the list is read once.
    plain.tools.register(tool('knowledge_search'))
    expect(names(plain, (await mintScope(plain, 'agent-2', plainPreset.key)).key)).toEqual([])
  })

  it('keeps only the allow-list, removes the deny-list, and lifts with the row', async () => {
    const ctx = await mount()
    for (const name of ['read', 'bash', 'web']) ctx.tools.register(tool(name))
    const allowing = await mintScope(ctx, 'allowing')
    const denying = await mintScope(ctx, 'denying')
    const allowRow = await allowing.scope.ctx.plugin(ToolRestriction, { allow: ['read'] })
    await denying.scope.ctx.plugin(ToolRestriction, { deny: ['bash'] })

    expect(names(ctx, allowing.key)).toEqual(['read'])
    expect(names(ctx, denying.key)).toEqual(['read', 'web'])
    await allowRow.dispose()
    expect(names(ctx, allowing.key)).toEqual(['bash', 'read', 'web'])
  })

  it('validates that a row declares at least one list, and intersects both', async () => {
    // The Loader validates a row's config through this schema before apply
    // runs; an absent list is never read as an empty one.
    expect(() => ToolRestriction.Config({})).toThrow(/allow|deny/)
    expect(ToolRestriction.Config({ deny: ['x'] })).toEqual({ deny: ['x'] })

    const ctx = await mount()
    for (const name of ['read', 'bash', 'web']) ctx.tools.register(tool(name))
    const standing = await mintScope(ctx, 'preset')
    await standing.scope.ctx.plugin(ToolRestriction, { allow: ['read', 'bash'], deny: ['bash'] })
    expect(names(ctx, (await mintScope(ctx, 'agent', standing.key)).key)).toEqual(['read'])
  })

  it('refuses a name no global tool carries when the row mounts', async () => {
    const ctx = await mount()
    const standing = await mintScope(ctx, 'preset')
    await expect(standing.scope.ctx.plugin(ToolRestriction, { deny: ['ghost'] }))
      .rejects.toThrow(/unknown global tool "ghost"/)
  })

  it('refuses a host-plane mount, where the mask would cover every agent', async () => {
    const ctx = await mount()
    await expect(ctx.plugin(ToolRestriction, { allow: [] })).rejects.toThrow(/requires a scoped context/)
  })
})
