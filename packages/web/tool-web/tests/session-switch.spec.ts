/**
 * The per-session web switch: the log owns the state, the tools exist for an
 * agent exactly while its Session has the switch on, the `/web` command
 * flips it, and the projection folds the same value for clients.
 */
import { describe, expect, it, vi } from 'vitest'
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
  /** What the stub search provider answers when asked whether the member may search. */
  permitted: () => Promise<boolean>
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
  /** Dispose the tool-web row. */
  dispose: () => Promise<void>
}

async function mountSwitch(config: ToolWeb.Config, seed: Logged[] = [], withCommands = true): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(WebRuntime, { searchProvider: 'stub' })
  const state: Mounted = {
    ctx, events: seed, scopeKey: { agent: 'session-1' }, noAgent: false,
    permitted: () => Promise.resolve(true),
    commands: [],
    projections: [],
    agent: { id: 'session-1', session: { id: 'session-1', snapshotEvents: () => [], append: () => { throw new Error('unset') } }, ctx },
    dispose: () => Promise.resolve(),
  }
  // The stub provider decides per the test's script; its availability is a
  // search-time matter the switch does not read.
  ctx.web.registerSearchProvider({
    id: 'stub',
    available: () => true,
    search: () => Promise.reject(new Error('unused')),
    permitted: () => state.permitted(),
  })
  if (withCommands) {
    ctx.provide('commands', {
      register: (definition: CommandDefinition) => {
        state.commands.push(definition)
        return () => { state.commands.splice(state.commands.indexOf(definition), 1) }
      },
    })
  }
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
  const fiber = await ctx.plugin(ToolWeb, ToolWeb.Config(config))
  state.dispose = async () => { await fiber.dispose() }
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

/** Announce the agent and let the switch's asynchronous decision settle. */
async function created(mounted: Mounted): Promise<void> {
  mounted.ctx.emit('agent/created', { agent: mounted.agent as never })
  await new Promise(resolve => setImmediate(resolve))
}

function disposed(mounted: Mounted): void {
  mounted.ctx.emit('agent/disposed', { agent: mounted.agent as never })
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
    await created(mounted)
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
    await created(mounted)
    expect(mounted.events).toEqual([{ seq: 0, type: 'web/access', data: { enabled: false } }])
    expect(visible(mounted)).toEqual([])
    expect(await guidance(mounted)).toEqual([])
    // The host's own view keeps the whole surface.
    expect(mounted.ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(['web_fetch', 'web_search'])
  })

  it('records the initial on value and offers the tools with their guidance', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'on' })
    await created(mounted)
    expect(mounted.events).toEqual([{ seq: 0, type: 'web/access', data: { enabled: true } }])
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
    expect(await guidance(mounted)).toEqual(['tool:web_search', 'tool:web_fetch'])
  })

  it('follows a resumed log rather than the configured initial value, without appending', async () => {
    const seeded = [{ seq: 0, type: 'turn/start', data: { turn: 1 } }, { seq: 1, type: 'web/access', data: { enabled: true } }]
    const mounted = await mountSwitch({ sessionSwitch: 'off' }, seeded)
    await created(mounted)
    expect(mounted.events).toHaveLength(2)
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
    // The last logged value wins.
    mounted.events.push({ seq: 2, type: 'web/access', data: { enabled: false } })
    await created(mounted)
    expect(visible(mounted)).toEqual([])
  })

  it('withholds only the tools this composition registered', async () => {
    const mounted = await mountSwitch({ search: false, sessionSwitch: 'off' })
    await created(mounted)
    expect(visible(mounted)).toEqual([])
    expect(mounted.ctx.tools.schemas().map(schema => schema.name)).toEqual(['web_fetch'])
    await web(mounted, 'on')
    expect(visible(mounted)).toEqual(['web_fetch'])
  })
})

describe('the /web command', () => {
  it('is registered on a permitted agent\'s own scope with its usage hint, and given back when the agent goes', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'off' })
    expect(mounted.commands).toEqual([])
    await created(mounted)
    expect(mounted.commands.map(definition => [definition.name, definition.input?.hint])).toEqual([['web', '[on|off]']])
    disposed(mounted)
    expect(mounted.commands).toEqual([])
  })

  it('turns the switch on and off, reporting an idempotent request as such', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'off' })
    await created(mounted)
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
    await created(mounted)
    expect(await web(mounted, '')).toEqual({ kind: 'success', text: 'Web access off: web search and page fetching are withheld from the next step.' })
    expect(await web(mounted, '')).toEqual({ kind: 'success', text: 'Web access on: web search and page fetching are offered from the next step.' })
    expect(await web(mounted, 'sometimes')).toEqual({ kind: 'error', text: 'Usage: /web [on|off]' })
    expect(mounted.events.map(event => event.data)).toEqual([{ enabled: true }, { enabled: false }, { enabled: true }])
  })
})

describe('the restriction follows the log', () => {
  it('ignores a logged change for a Session no agent is driving, and any other event', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'off' })
    await created(mounted)
    expect(visible(mounted)).toEqual([])
    mounted.noAgent = true
    mounted.agent.session.append('web/access', { enabled: true })
    // A Session with no live agent has no scope to lift; visibility is settled
    // when an agent is created for it.
    expect(visible(mounted)).toEqual([])
    mounted.noAgent = false
    mounted.ctx.emit('session/event', mounted.agent.session as never, { seq: 9, type: 'turn/start', data: { turn: 1 } } as never)
    expect(visible(mounted)).toEqual([])
    await created(mounted)
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
  })

  it('releases a disposed agent\'s restriction rather than orphaning it', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'off' })
    await created(mounted)
    expect(visible(mounted)).toEqual([])
    mounted.ctx.emit('agent/disposed', { agent: mounted.agent as never })
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
    // Disposing an agent that was never masked is a no-op.
    mounted.ctx.emit('agent/disposed', { agent: mounted.agent as never })
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
  })
})

describe('the switch is offered only to a permitted member', () => {
  it('withholds the tools, logs nothing, and registers no command when the deployment refuses', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'on', search: true, fetch: true })
    mounted.permitted = () => Promise.resolve(false)
    await created(mounted)
    expect(visible(mounted)).toEqual([])
    expect(mounted.events).toEqual([])
    expect(mounted.commands).toEqual([])
    // A logged change from elsewhere does not lift a refusal.
    mounted.agent.session.append('web/access', { enabled: true })
    expect(visible(mounted)).toEqual([])
    disposed(mounted)
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
  })

  it('treats a decision that cannot be reached as a refusal', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'on' })
    mounted.permitted = () => Promise.reject(new Error('control plane down'))
    await created(mounted)
    expect(visible(mounted)).toEqual([])
    expect(mounted.events).toEqual([])
  })

  it('withholds the tools while the decision is pending, then settles from the log', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'on' })
    let answer!: (permitted: boolean) => void
    mounted.permitted = () => new Promise((resolve) => { answer = resolve })
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never })
    expect(visible(mounted)).toEqual([])
    expect(mounted.events).toEqual([])
    answer(true)
    await new Promise(resolve => setImmediate(resolve))
    expect(mounted.events).toEqual([{ seq: 0, type: 'web/access', data: { enabled: true } }])
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
  })

  it('offers the switch without a command in a composition that has no command registry', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'on' }, [], false)
    await created(mounted)
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
    expect(mounted.events).toEqual([{ seq: 0, type: 'web/access', data: { enabled: true } }])
    expect(mounted.commands).toEqual([])
    // A logged off that repeats a withheld state keeps the one restriction.
    mounted.agent.session.append('web/access', { enabled: false })
    mounted.agent.session.append('web/access', { enabled: false })
    expect(visible(mounted)).toEqual([])
    disposed(mounted)
    expect(visible(mounted)).toEqual(['web_fetch', 'web_search'])
  })

  it('keeps the tools withheld and says so when logging the initial value fails after the decision', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'on' })
    const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    mounted.agent.session.append = () => { throw new Error('log closed') }
    await created(mounted)
    expect(visible(mounted)).toEqual([])
    expect(mounted.events).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stays withheld'))
    warn.mockRestore()
  })

  it('gives the command registry context back when the row is disposed', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'on' })
    await created(mounted)
    expect(mounted.commands).toHaveLength(1)
    await mounted.dispose()
    // The row is gone: a later agent finds no switch to decide on.
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never })
    await new Promise(resolve => setImmediate(resolve))
    expect(mounted.events).toHaveLength(1)
  })

  it('drops a decision that lands after the agent was disposed', async () => {
    const mounted = await mountSwitch({ sessionSwitch: 'on' })
    let answer!: (permitted: boolean) => void
    mounted.permitted = () => new Promise((resolve) => { answer = resolve })
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never })
    disposed(mounted)
    answer(true)
    await new Promise(resolve => setImmediate(resolve))
    expect(mounted.events).toEqual([])
    expect(mounted.commands).toEqual([])
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
