/**
 * The per-session web switch: the log owns the state, the tools exist for an
 * agent exactly while its Session has the switch on, the `/web` command
 * flips it, and the projection folds the same value for clients.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import SystemPrompt, { type SystemPrompt as SystemPromptRegistry } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import { WEB_ACCESS_COMMAND, webAccessProjectionDefinition, type WebAccessProjection } from '@deepseek-ai/dsh-tool-web'

/** One logged event, as the fake Session stores it. */
interface Logged { seq: number; type: string; data: unknown }

/** One mounted tool-web over a fake agent whose Session log the switch folds. */
interface Mounted {
  ctx: Context
  /** The Session log, mutable so a test can seed a state or read what was appended. */
  events: Logged[]
  /** The agent the fake registry reports for the Session; its ctx is a real scope. */
  agent: {
    id: string
    session: { id: string; snapshotEvents: () => Logged[]; append: (type: string, data: unknown) => Logged }
    ctx: Context
  }
  scopeKey: ScopeKey
  /** When true, the registry reports no agent for the Session. */
  noAgent: boolean
  /** Every command definition the switch registered. */
  commands: CommandDefinition[]
  /** Every projection definition the switch registered. */
  projections: ProjectionDefinition<'webAccess', WebAccessProjection>[]
}

async function mountSwitch(config: ToolWeb.Config, seed: Logged[] = []): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(WebRuntime, {})
  const state: Mounted = {
    ctx, events: seed, scopeKey: { agent: 'session-1' }, noAgent: false,
    commands: [],
    projections: [],
    agent: { id: 'session-1', session: { id: 'session-1', snapshotEvents: () => [], append: () => { throw new Error('unset') } }, ctx },
  }
  ctx.provide('commands', { register: (definition: CommandDefinition) => { state.commands.push(definition); return () => {} } })
  ctx.provide('sessionProjections', {
    register: (definition: ProjectionDefinition<'webAccess', WebAccessProjection>) => { state.projections.push(definition); return () => {} },
  })
  // The agent's own context inherits the minting plugin's dependency API, as
  // the production chain does; a scope minted from a bare root could not restrict.
  const scoped = await new Promise<ReturnType<typeof createScope>>((resolve) => {
    ctx.inject(['tools'], (inner) => { resolve(createScope(inner, state.scopeKey)) })
  })
  const session = {
    id: 'session-1',
    snapshotEvents: () => state.events,
    append: (type: string, data: unknown): Logged => {
      const event: Logged = { seq: state.events.length, type, data }
      state.events.push(event)
      ctx.emit('session/event', session as never, event as never)
      return event
    },
  }
  state.agent = { id: 'session-1', session, ctx: scoped.ctx }
  ctx.provide('agents', { get: () => state.noAgent ? undefined : state.agent })
  await ctx.plugin(ToolWeb, ToolWeb.Config(config))
  return state
}

/** The web tool names the agent's own scope sees. */
function visible(mounted: Mounted): string[] {
  return mounted.ctx.tools.schemas(mounted.scopeKey).map(schema => schema.name).filter(name => name.startsWith('web_')).sort()
}

/** The web guidance sections of one assembly for the agent's scope. */
async function guidance(mounted: Mounted): Promise<string[]> {
  const prompt = mounted.ctx.get('systemPrompt') as SystemPromptRegistry
  const assembly = await prompt.assemble({ scope: mounted.scopeKey })
  return assembly.sections.filter(section => section.name.startsWith('tool:web_') && section.text !== '').map(section => section.name)
}

function created(mounted: Mounted): void {
  mounted.ctx.emit('agent/created', { agent: mounted.agent as never })
}

/** Run the registered `/web` command with the given input. */
async function web(mounted: Mounted, rawInput: string): Promise<CommandResult> {
  const definition = mounted.commands.find(candidate => candidate.name === WEB_ACCESS_COMMAND)
  if (definition === undefined) throw new Error('the switch registered no /web command')
  return await definition.handler({ agent: mounted.agent, rawInput } as unknown as CommandInvocation)
}

describe('sessionSwitch config', () => {
  it('is absent by default and accepts only on or off', () => {
    expect(ToolWeb.Config({}).sessionSwitch).toBeUndefined()
    expect(ToolWeb.Config({ sessionSwitch: 'on' }).sessionSwitch).toBe('on')
    expect(ToolWeb.Config({ sessionSwitch: 'off' }).sessionSwitch).toBe('off')
    expect(() => ToolWeb.Config({ sessionSwitch: 'maybe' } as never)).toThrow()
  })

  it('refuses a switch with nothing to switch', async () => {
    await expect(mountSwitch({ search: false, fetch: false, sessionSwitch: 'on' }))
      .rejects.toThrow(/sessionSwitch needs search or fetch enabled/)
  })

  it('mounts no switch without the field: always-on tools, no command, no projection', async () => {
    const mounted = await mountSwitch({})
    created(mounted)
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
    expect(mounted.events).toEqual([])
    expect(mounted.commands).toEqual([])
    expect(mounted.projections).toEqual([])
  })
})

describe('the log owns the switch', () => {
  it('records the initial off value when the agent is created and withholds the tools and their guidance', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'off' })
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
    created(mounted)
    expect(mounted.events).toEqual([{ seq: 0, type: 'web/access', data: { enabled: false } }])
    expect(visible(mounted)).toEqual([])
    expect(await guidance(mounted)).toEqual([])
    // The host's own view keeps the whole surface.
    expect(mounted.ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(['web_fetch', 'web_search'])
  })

  it('records the initial on value and offers the tools with their guidance', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'on' })
    created(mounted)
    expect(mounted.events).toEqual([{ seq: 0, type: 'web/access', data: { enabled: true } }])
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
    expect(await guidance(mounted)).toEqual(['tool:web_search', 'tool:web_fetch'])
  })

  it('follows a resumed log rather than the configured initial value, without appending', async () => {
    const seeded = [{ seq: 0, type: 'turn/start', data: { turn: 1 } }, { seq: 1, type: 'web/access', data: { enabled: true } }]
    const mounted = await mountSwitch({ sessionSwitch: 'off' }, seeded)
    created(mounted)
    expect(mounted.events).toHaveLength(2)
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
    // The last logged value wins.
    mounted.events.push({ seq: 2, type: 'web/access', data: { enabled: false } })
    created(mounted)
    expect(visible(mounted)).toEqual([])
  })

  it('withholds only the tools this composition registered', async () => {
    const mounted = await mountSwitch({ search: false, sessionSwitch: 'off' })
    created(mounted)
    expect(visible(mounted)).toEqual([])
    expect(mounted.ctx.tools.schemas().map(schema => schema.name)).toEqual(['web_fetch'])
    await web(mounted, 'on')
    expect(visible(mounted)).toEqual(['web_fetch'])
  })
})

describe('the /web command', () => {
  it('is registered with its usage hint', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'off' })
    expect(mounted.commands.map(definition => [definition.name, definition.input?.hint])).toEqual([['web', '[on|off]']])
  })

  it('turns the switch on and off, reporting an idempotent request as such', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'off' })
    created(mounted)
    expect(await web(mounted, 'off')).toEqual({ kind: 'success', text: 'Web access is already off.' })
    expect(await web(mounted, ' on ')).toEqual({ kind: 'success', text: 'Web access on: web search and page fetching are offered from the next step.' })
    expect(mounted.events.at(-1)).toEqual({ seq: 1, type: 'web/access', data: { enabled: true } })
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
    expect(await web(mounted, 'on')).toEqual({ kind: 'success', text: 'Web access is already on.' })
    expect(await web(mounted, 'off')).toEqual({ kind: 'success', text: 'Web access off: web search and page fetching are withheld from the next step.' })
    expect(visible(mounted)).toEqual([])
    expect(mounted.events).toHaveLength(3)
  })

  it('flips the current value when given no word and rejects any other word', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'on' })
    // No agent created yet: the fold falls back to the configured initial value.
    expect(await web(mounted, '')).toEqual({ kind: 'success', text: 'Web access off: web search and page fetching are withheld from the next step.' })
    expect(await web(mounted, '')).toEqual({ kind: 'success', text: 'Web access on: web search and page fetching are offered from the next step.' })
    expect(await web(mounted, 'sometimes')).toEqual({ kind: 'error', text: 'Usage: /web [on|off]' })
    expect(mounted.events.map(event => event.data)).toEqual([{ enabled: false }, { enabled: true }])
  })
})

describe('the restriction follows the log', () => {
  it('ignores a logged change for a Session no agent is driving, and any other event', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'off' })
    created(mounted)
    expect(visible(mounted)).toEqual([])
    mounted.noAgent = true
    mounted.agent.session.append('web/access', { enabled: true })
    // A Session with no live agent has no scope to lift; visibility is settled
    // when an agent is created for it.
    expect(visible(mounted)).toEqual([])
    mounted.noAgent = false
    mounted.ctx.emit('session/event', mounted.agent.session as never, { seq: 9, type: 'turn/start', data: { turn: 1 } } as never)
    expect(visible(mounted)).toEqual([])
    created(mounted)
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
  })

  it('releases a disposed agent\'s restriction rather than orphaning it', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'off' })
    created(mounted)
    expect(visible(mounted)).toEqual([])
    mounted.ctx.emit('agent/disposed', { agent: mounted.agent as never })
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
    // Disposing an agent that was never masked is a no-op.
    mounted.ctx.emit('agent/disposed', { agent: mounted.agent as never })
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
  })
})

describe('the webAccess projection', () => {
  it('is registered by a switch-bearing row and folds the last logged value', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'off' })
    expect(mounted.projections).toEqual([webAccessProjectionDefinition])
    const definition = webAccessProjectionDefinition
    expect(definition.key).toBe('webAccess')
    const start = definition.init()
    expect(start).toEqual({ enabled: null })
    const on = definition.apply(start, { seq: 0, type: 'web/access', data: { enabled: true } } as never)
    expect(on).toEqual({ enabled: true })
    expect(definition.apply(on, { seq: 1, type: 'turn/start', data: { turn: 1 } } as never)).toBe(on)
    expect(definition.apply(on, { seq: 2, type: 'web/access', data: { enabled: false } } as never)).toEqual({ enabled: false })
    expect(definition.wire.view(on)).toBe(on)
    expect(definition.stateSchema.parse({ enabled: null })).toEqual({ enabled: null })
    expect(() => definition.stateSchema.parse({ enabled: 'yes' })).toThrow()
  })
})
