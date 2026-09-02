/**
 * The two things a model sees, and the one rule that removes both.
 *
 * The prompt section is asserted against a Session log rather than against a
 * directory, because that is the claim: what the model is told is what the log
 * holds, so a replay says what it said then.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { type SystemPrompt as SystemPromptRegistry } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolResult } from '@deepseek-ai/dsh-tools'
import {
  KnowledgeRef,
  type KnowledgeScope,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'
import * as ToolKnowledge from '@deepseek-ai/dsh-tool-knowledge'
import {
  KNOWLEDGE_SCOPE_SECTION,
  KNOWLEDGE_SEARCH,
  renderScopeSection,
} from '@deepseek-ai/dsh-tool-knowledge'

const REF_A = KnowledgeRef('weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266')
const REF_B = KnowledgeRef('weknora:prod:08f25606-8876-49cc-b509-70e84828db08')

/** One search result, as the Runner provider answers with it. */
function result(patch: Partial<KnowledgeSearchResult> = {}): KnowledgeSearchResult {
  return {
    query: '年假',
    searched: [{ ref: REF_A, displayName: '临港知识库', description: '', kind: 'document' }],
    passages: [{
      ref: REF_A, title: '运维手册', text: '一级故障 30 分钟内响应。', truncated: false, score: 0.3,
    }],
    truncated: false,
    ...patch,
  }
}

/** One assembly: the real tools registry, a scripted knowledge service, one agent. */
interface Mounted {
  ctx: Context
  /** What the next search answers with. */
  knowledgeAnswer: KnowledgeSearchResult
  /** Every request that reached the knowledge service. */
  calls: KnowledgeSearchRequest[]
  /** The scoped context the agent owns, for visibility assertions. */
  agentCtx: Context
  /** The agent whose Session log the tool and the section fold. */
  agent: { session: { id: string; events: unknown[] }; ctx: Context }
  /** That Session's log, mutable so a test can record a scope change. */
  events: unknown[]
  /** The agent scope's key, for reading tool visibility. */
  scopeKey: ScopeKey
  /** When true, the registry reports no agent for the Session. */
  noAgent: boolean
}

let counter = 0

/**
 * Mount the tool over the real registry with one agent whose Session log holds
 * the given scope. Only the knowledge service is scripted: everything the tool
 * is asserted through — argument validation, the output schema, rendering —
 * runs for real.
 */
async function mountTool(
  scope: KnowledgeScope = { version: 1, mode: 'all' },
  config: ToolKnowledge.Config = {},
): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const state: Mounted = {
    ctx,
    knowledgeAnswer: {
      query: '', searched: [], passages: [], truncated: false,
    },
    calls: [],
    agentCtx: ctx,
    agent: { session: { id: 'session-1', events: [] }, ctx },
    events: [],
    scopeKey: { agent: 'unset' },
    noAgent: false,
  }
  ctx.provide('knowledge', {
    catalog: () => Promise.resolve([]),
    search: (request: KnowledgeSearchRequest) => {
      state.calls.push(request)
      return Promise.resolve(state.knowledgeAnswer)
    },
  })
  const events: unknown[] = scope.mode === 'off' ? [] : [{ seq: 0, type: 'knowledge/scope', data: scope }]
  const key: ScopeKey = { agent: 'session-1' }
  // The agent's own context inherits the minting plugin's dependency API, and
  // in production that chain injects the tools registry — a scope minted from
  // a bare root could not restrict anything.
  const scoped = await new Promise<ReturnType<typeof createScope>>((resolve) => {
    ctx.inject(['tools'], (inner) => { resolve(createScope(inner, key)) })
  })
  const agent = { session: { id: 'session-1', events }, ctx: scoped.ctx }
  state.agentCtx = scoped.ctx
  state.agent = agent
  state.events = events
  state.scopeKey = key
  ctx.provide('agents', {
    currentInitiator: () => state.noAgent ? undefined : agent,
    get: () => state.noAgent ? undefined : agent,
  })
  await ctx.plugin(ToolKnowledge, ToolKnowledge.Config(config))
  return state
}

/**
 * Run the tool through the real registry.
 *
 * The canonical value is registry-internal, so a caller sees exactly what a
 * model and a presenter see: rendered content, an error flag, and the
 * presentation payload the output declaration projected.
 */
function runTool(mounted: Mounted, args: unknown): Promise<ToolResult> {
  return mounted.ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`call-${String(++counter)}`),
    name: KNOWLEDGE_SEARCH,
    arguments: args,
  })
}

/** The text a model reads back from one call. */
async function renderTool(mounted: Mounted, args: unknown): Promise<string> {
  const [block] = (await runTool(mounted, args)).content
  return block !== undefined && block.type === 'text' ? block.text : ''
}

describe('what the prompt says about scope', () => {
  it('says nothing at all while a Session is off', () => {
    expect(renderScopeSection({ version: 1, mode: 'off' })).toBe('')
  })

  it('names no knowledge base under all, because none was recorded', () => {
    const text = renderScopeSection({ version: 1, mode: 'all' })
    expect(text).toContain('knowledge_search')
    expect(text).toContain('every knowledge base this member may read')
  })

  it('names exactly the knowledge bases the log recorded', () => {
    const scope: KnowledgeScope = {
      version: 1,
      mode: 'selected',
      bases: [
        { ref: REF_A, displayName: '临港知识库' },
        { ref: REF_B, displayName: '南昌知识库' },
      ],
    }
    const text = renderScopeSection(scope)
    expect(text).toContain('临港知识库、南昌知识库')
  })

  it('keeps the recorded name after the knowledge base is renamed elsewhere', () => {
    // The section reads the log, not a directory, so replaying a Session says
    // what it said then rather than what an administrator has since called it.
    const recorded: KnowledgeScope = {
      version: 1, mode: 'selected', bases: [{ ref: REF_A, displayName: '临港知识库' }],
    }
    expect(renderScopeSection(recorded)).toContain('临港知识库')
    expect(renderScopeSection(recorded)).not.toContain('2026')
  })

  it('tells the model the passages are data rather than instructions', () => {
    for (const scope of [
      { version: 1, mode: 'all' } as const,
      { version: 1, mode: 'selected', bases: [{ ref: REF_A, displayName: 'x' }] } as const,
    ]) {
      expect(renderScopeSection(scope)).toContain('not instructions')
    }
  })
})

describe('the result a model reads', () => {
  it('answers passages naming what was searched, and asks the service for the right scope', async () => {
    const mounted = await mountTool()
    mounted.knowledgeAnswer = result()
    const answer = await runTool(mounted, { query: '年假' })
    expect(answer.isError).toBe(false)
    expect(answer.meta).toEqual({ knowledgeBases: ['临港知识库'], passageCount: 1, truncated: false })
    expect(mounted.calls[0]).toMatchObject({ query: '年假', scope: { mode: 'all' } })
  })

  it('refuses a search while the Session is off, without reaching the Control Plane', async () => {
    const mounted = await mountTool({ version: 1, mode: 'off' })
    expect((await runTool(mounted, { query: '年假' })).isError).toBe(true)
    expect(mounted.calls).toHaveLength(0)
  })

  it('narrows to the selected references the log holds', async () => {
    const mounted = await mountTool({
      version: 1, mode: 'selected', bases: [{ ref: REF_A, displayName: '临港知识库' }],
    })
    mounted.knowledgeAnswer = result()
    await runTool(mounted, { query: '年假' })
    expect(mounted.calls[0]?.scope).toEqual({ mode: 'selected', refs: [REF_A] })
  })

  it('caps a caller’s result bound at the deployment ceiling', async () => {
    const mounted = await mountTool(undefined, { maxResults: 3 })
    mounted.knowledgeAnswer = result()
    await runTool(mounted, { query: '年假', max_results: 99 })
    expect(mounted.calls[0]?.maxResults).toBe(3)
  })

  it.each([
    ['no query', {}],
    ['an empty query', { query: '   ' }],
    ['a query that is not a string', { query: 7 }],
    ['a query of the wrong shape entirely', { query: ['年假'] }],
  ])('refuses %s', async (_label, args) => {
    const mounted = await mountTool()
    expect((await runTool(mounted, args)).isError).toBe(true)
    expect(mounted.calls).toHaveLength(0)
  })

  it('refuses a search with no agent to fold a Session for', async () => {
    const mounted = await mountTool()
    mounted.noAgent = true
    // No agent means no Session, and no Session means no choice was recorded;
    // that reads as off rather than as everything.
    expect((await runTool(mounted, { query: '年假' })).isError).toBe(true)
    expect(mounted.calls).toHaveLength(0)
  })

  it('is classified parallel, because a knowledge read mutates nothing', async () => {
    const mounted = await mountTool()
    const tools = mounted.ctx.get('tools') as ToolRuntime
    expect(tools.executionMode({
      signal: new AbortController().signal,
      callId: ToolCallId('call-mode'),
      name: KNOWLEDGE_SEARCH,
      arguments: { query: '年假' },
    })).toEqual({ kind: 'parallel' })
  })

  it('runs two searches concurrently, because a read mutates nothing', async () => {
    const mounted = await mountTool()
    mounted.knowledgeAnswer = result()
    const [first, second] = await Promise.all([
      runTool(mounted, { query: '年假' }),
      runTool(mounted, { query: '加班' }),
    ])
    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    expect(mounted.calls.map(call => call.query).sort()).toEqual(['加班', '年假'].sort())
  })

  it('ignores a result bound that is not a whole positive number', async () => {
    const mounted = await mountTool()
    mounted.knowledgeAnswer = result()
    await runTool(mounted, { query: '年假', max_results: 1.5 })
    expect(mounted.calls[0]?.maxResults).toBeUndefined()
  })
})

describe('the prompt section is assembled from the Session log', () => {
  /** The knowledge section of one assembly, or undefined when it contributed none. */
  async function section(mounted: Mounted): Promise<string | undefined> {
    const prompt = mounted.ctx.get('systemPrompt') as SystemPromptRegistry
    const assembly = await prompt.assemble({ agent: mounted.agent as never })
    return assembly.sections.find(entry => entry.name === KNOWLEDGE_SCOPE_SECTION)?.text
  }

  it('contributes nothing while the Session is off', async () => {
    // The section is registered and resolves to empty; rendering drops it.
    expect(await section(await mountTool({ version: 1, mode: 'off' }))).toBe('')
  })

  it('names the recorded knowledge bases under a selection', async () => {
    const mounted = await mountTool({
      version: 1,
      mode: 'selected',
      bases: [{ ref: REF_A, displayName: '临港知识库' }, { ref: REF_B, displayName: '南昌知识库' }],
    })
    expect(await section(mounted)).toContain('临港知识库、南昌知识库')
  })

  it('states the breadth under all', async () => {
    expect(await section(await mountTool())).toContain('every knowledge base this member may read')
  })

  it('contributes nothing when there is no agent to fold a Session for', async () => {
    const mounted = await mountTool()
    const prompt = mounted.ctx.get('systemPrompt') as SystemPromptRegistry
    const assembly = await prompt.assemble({})
    expect(assembly.sections.find(entry => entry.name === KNOWLEDGE_SCOPE_SECTION)?.text).toBe('')
  })
})

describe('the tool exists only while the Session uses knowledge', () => {
  /** Whether `knowledge_search` is visible to the agent's own scope. */
  function visible(mounted: Mounted): boolean {
    const tools = mounted.ctx.get('tools') as ToolRuntime
    return tools.schemas(mounted.scopeKey).some(schema => schema.name === KNOWLEDGE_SEARCH)
  }

  it('hides the tool for an agent whose Session is off', async () => {
    const mounted = await mountTool({ version: 1, mode: 'off' })
    expect(visible(mounted)).toBe(true)
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never })
    expect(visible(mounted)).toBe(false)
  })

  it('leaves the tool in place for an agent whose Session uses knowledge', async () => {
    const mounted = await mountTool()
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never })
    expect(visible(mounted)).toBe(true)
  })

  it('reveals the tool when a Session turns knowledge on mid-conversation', async () => {
    const mounted = await mountTool({ version: 1, mode: 'off' })
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never })
    expect(visible(mounted)).toBe(false)
    mounted.events.push({ seq: 0, type: 'knowledge/scope', data: { version: 1, mode: 'all' } })
    mounted.ctx.emit('session/event', mounted.agent.session as never, {
      seq: 0, type: 'knowledge/scope', data: { version: 1, mode: 'all' },
    } as never)
    expect(visible(mounted)).toBe(true)
  })

  it('hides it again when a Session turns knowledge off', async () => {
    const mounted = await mountTool()
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never })
    mounted.events.length = 0
    mounted.ctx.emit('session/event', mounted.agent.session as never, {
      seq: 1, type: 'knowledge/scope', data: { version: 1, mode: 'off' },
    } as never)
    expect(visible(mounted)).toBe(false)
  })

  it('leaves a scope change alone when no agent is driving that Session', async () => {
    const mounted = await mountTool({ version: 1, mode: 'off' })
    mounted.noAgent = true
    mounted.ctx.emit('session/event', mounted.agent.session as never, {
      seq: 1, type: 'knowledge/scope', data: { version: 1, mode: 'all' },
    } as never)
    // A Session with no live agent has no scope to restrict; visibility is
    // settled when an agent is created for it.
    expect(visible(mounted)).toBe(true)
  })

  it('ignores a session event that is not a scope change', async () => {
    const mounted = await mountTool({ version: 1, mode: 'off' })
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never })
    mounted.events.push({ seq: 1, type: 'knowledge/scope', data: { version: 1, mode: 'all' } })
    mounted.ctx.emit('session/event', mounted.agent.session as never, {
      seq: 1, type: 'turn/start', data: { turn: 1 },
    } as never)
    // Only a scope change re-evaluates; an unrelated event leaves it alone.
    expect(visible(mounted)).toBe(false)
  })

  it('releases a disposed agent’s restriction rather than orphaning it', async () => {
    const mounted = await mountTool({ version: 1, mode: 'off' })
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never })
    expect(visible(mounted)).toBe(false)
    // Disposal normally takes the scope and every registration on it. Lifting
    // here as well is what keeps a restriction from outliving the agent that
    // caused it, in the case where the scope survives.
    mounted.ctx.emit('agent/disposed', { agent: mounted.agent as never })
    expect(visible(mounted)).toBe(true)
  })
})

describe('the projection a client reads', () => {
  /** Register the unit against a real registry and fold one log through it. */
  async function unit(): Promise<{
    init: () => KnowledgeScope
    apply: (state: KnowledgeScope, event: { type: string; data: unknown }) => KnowledgeScope
    view: (state: KnowledgeScope) => unknown
    parse: (value: unknown) => unknown
  }> {
    const ctx = new Context()
    let registered: Record<string, unknown> | undefined
    ctx.provide('sessionProjections', {
      register: (definition: Record<string, unknown>) => {
        registered = definition
        return () => {}
      },
    })
    ctx.provide('knowledge', { catalog: () => Promise.resolve([]), search: () => Promise.resolve({}) })
    ctx.provide('agents', { currentInitiator: () => undefined, get: () => undefined })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolKnowledge, ToolKnowledge.Config({}))
    if (registered === undefined) throw new Error('the knowledge unit did not register')
    const definition = registered as {
      key: string
      init: () => KnowledgeScope
      apply: (state: KnowledgeScope, event: { type: string; data: unknown }) => KnowledgeScope
      stateSchema: { parse: (value: unknown) => unknown }
      wire: { view: (state: KnowledgeScope) => unknown; viewSchema: { parse: (value: unknown) => unknown } }
    }
    expect(definition.key).toBe('knowledge')
    return {
      init: definition.init,
      apply: definition.apply,
      view: definition.wire.view,
      parse: value => definition.stateSchema.parse(value),
    }
  }

  it('starts a Session at off and takes the last recorded scope', async () => {
    const { init, apply } = await unit()
    expect(init()).toEqual({ version: 1, mode: 'off' })
    const all = apply(init(), { type: 'knowledge/scope', data: { version: 1, mode: 'all' } })
    expect(all).toEqual({ version: 1, mode: 'all' })
  })

  it('returns the same state for an event it does not own', async () => {
    const { init, apply } = await unit()
    const state = init()
    // An unchanged reference is what produces zero downstream work.
    expect(apply(state, { type: 'turn/start', data: { turn: 1 } })).toBe(state)
  })

  it('serves clients the whole scope, names included', async () => {
    const { view } = await unit()
    const scope: KnowledgeScope = {
      version: 1, mode: 'selected', bases: [{ ref: REF_A, displayName: '临港知识库' }],
    }
    expect(view(scope)).toEqual(scope)
  })

  it.each([
    ['off', { version: 1, mode: 'off' }],
    ['all', { version: 1, mode: 'all' }],
    ['a selection', { version: 1, mode: 'selected', bases: [{ ref: REF_A, displayName: 'x' }] }],
  ])('validates a persisted %s row before it seeds a fold', async (_label, value) => {
    const { parse } = await unit()
    expect(parse(value)).toEqual(value)
  })

  it.each([
    ['an unknown version', { version: 2, mode: 'off' }],
    ['an unknown mode', { version: 1, mode: 'everything' }],
    ['a selection with no bases', { version: 1, mode: 'selected' }],
    ['a base with no name', { version: 1, mode: 'selected', bases: [{ ref: REF_A }] }],
    ['an extra field', { version: 1, mode: 'off', extra: true }],
  ])('refuses a persisted row holding %s', async (_label, value) => {
    const { parse } = await unit()
    expect(() => parse(value)).toThrow()
  })
})

describe('the text a model reads back', () => {
  it('numbers passages, names what was searched, and marks truncation', async () => {
    const mounted = await mountTool()
    mounted.knowledgeAnswer = result({
      passages: [
        { ref: REF_A, title: '运维手册', text: '一级故障', truncated: true, score: 0.3 },
        { ref: REF_A, title: '', text: '二级故障', truncated: false, score: 0.2 },
      ],
      truncated: true,
    })
    const text = await renderTool(mounted, { query: '年假' })
    expect(text).toContain('Searched 临港知识库.')
    expect(text).toContain('[1] 运维手册')
    expect(text).toContain('…passage truncated')
    expect(text).toContain('[2]\n二级故障')
    expect(text).toContain('More passages matched than were returned.')
  })

  it('says plainly when nothing matched', async () => {
    const mounted = await mountTool()
    mounted.knowledgeAnswer = result({ passages: [] })
    expect(await renderTool(mounted, { query: '年假' })).toBe('No passages in 临港知识库 matched.')
  })
})
