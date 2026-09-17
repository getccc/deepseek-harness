/**
 * The three things a model sees, and the one rule that removes all of them.
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
  BiChartRef,
  BiProjectRef,
  type BiChartPage,
  type BiChartsRequest,
  type BiQueryRequest,
  type BiQueryResult,
  type BiScope,
} from '@deepseek-ai/dsh-bi'
import * as ToolBi from '@deepseek-ai/dsh-tool-bi'
import {
  BI_LIST_CHARTS,
  BI_QUERY_CHART,
  BI_SCOPE_SECTION,
  renderScopeSection,
} from '@deepseek-ai/dsh-tool-bi'

const REF = BiProjectRef('webi:prod:690c0727-1af5-4b7a-8465-ebd2845f2266')
const OTHER = BiProjectRef('webi:prod:08f25606-8876-49cc-b509-70e84828db08')
const CHART = BiChartRef(`${REF}/1b2c3d4e-0000-4000-8000-000000000001`)
const SELECTED: BiScope = { version: 1, mode: 'selected', project: { ref: REF, displayName: 'Demo YH' } }
const OFF: BiScope = { version: 1, mode: 'off' }

/** One chart page, as the Runner provider answers with it. */
function page(patch: Partial<BiChartPage> = {}): BiChartPage {
  return {
    ref: REF,
    charts: [{
      chartRef: CHART,
      ref: REF,
      name: '销售总览',
      spaceName: '经营看板',
      description: '按月的销售额与订单数。',
      kind: 'line',
      updatedAt: 1756857600000,
    }],
    page: 1,
    pageSize: 20,
    total: 1,
    ...patch,
  }
}

/** One run, as the Runner provider answers with it. */
function run(patch: Partial<BiQueryResult> = {}): BiQueryResult {
  return {
    chartRef: CHART,
    ref: REF,
    name: '销售总览',
    kind: 'line',
    description: '按月的销售额与订单数。',
    fields: [
      { id: 'orders_month', label: '月份', role: 'dimension', type: 'date' },
      { id: 'orders_amount', label: '销售额', role: 'metric', type: 'number' },
    ],
    filters: '订单状态 = 已完成',
    rows: [['2026-01', 1200.5], ['2026-02', 980]],
    rowCount: 2,
    truncated: false,
    cellsTruncated: false,
    ...patch,
  }
}

/** One assembly: the real tools registry, a scripted BI service, one agent. */
interface Mounted {
  ctx: Context
  /** What the next listing answers with. */
  pageAnswer: BiChartPage
  /** What the next run answers with. */
  runAnswer: BiQueryResult
  /** Every listing that reached the BI service. */
  listings: BiChartsRequest[]
  /** Every run that reached the BI service. */
  runs: BiQueryRequest[]
  /** The agent whose Session log the tools and the section fold. */
  agent: { session: { id: string; events: unknown[]; snapshotEvents: () => unknown[] }; ctx: Context }
  /** That Session's log, mutable so a test can record a scope change. */
  events: unknown[]
  /** The agent scope's key, for reading tool visibility. */
  scopeKey: ScopeKey
  /** When true, the registry reports no agent for the Session. */
  noAgent: boolean
}

let counter = 0

/**
 * Mount the tools over the real registry with one agent whose Session log
 * holds the given scope. Only the BI service is scripted: everything the tools
 * are asserted through — argument validation, the output schema, rendering —
 * runs for real.
 */
async function mountTool(scope: BiScope = SELECTED, config: ToolBi.Config = {}): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const state: Mounted = {
    ctx,
    pageAnswer: page(),
    runAnswer: run(),
    listings: [],
    runs: [],
    agent: { session: { id: 'session-1', events: [], snapshotEvents: () => [] }, ctx },
    events: [],
    scopeKey: { agent: 'unset' },
    noAgent: false,
  }
  ctx.provide('bi', {
    catalog: () => Promise.resolve([]),
    charts: (request: BiChartsRequest) => {
      state.listings.push(request)
      return Promise.resolve(state.pageAnswer)
    },
    query: (request: BiQueryRequest) => {
      state.runs.push(request)
      return Promise.resolve(state.runAnswer)
    },
  })
  const events: unknown[] = scope.mode === 'off' ? [] : [{ seq: 0, type: 'bi/scope', data: scope }]
  const key: ScopeKey = { agent: 'session-1' }
  // The agent's own context inherits the minting plugin's dependency API, and
  // in production that chain injects the tools registry — a scope minted from
  // a bare root could not restrict anything.
  const scoped = await new Promise<ReturnType<typeof createScope>>((resolve) => {
    ctx.inject(['tools'], (inner) => { resolve(createScope(inner, key)) })
  })
  const agent = { session: { id: 'session-1', events, snapshotEvents: () => events }, ctx: scoped.ctx }
  state.agent = agent
  state.events = events
  state.scopeKey = key
  ctx.provide('agents', {
    currentInitiator: () => state.noAgent ? undefined : agent,
    get: () => state.noAgent ? undefined : agent,
  })
  await ctx.plugin(ToolBi, ToolBi.Config(config))
  return state
}

/** Run one tool through the real registry. */
function runTool(mounted: Mounted, name: string, args: unknown): Promise<ToolResult> {
  return mounted.ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`call-${String(++counter)}`),
    name,
    arguments: args,
  })
}

/** The text a model reads back from one call. */
async function renderTool(mounted: Mounted, name: string, args: unknown): Promise<string> {
  const [block] = (await runTool(mounted, name, args)).content
  return block !== undefined && block.type === 'text' ? block.text : ''
}

describe('what the prompt says about scope', () => {
  it('says nothing at all while a Session is off', () => {
    expect(renderScopeSection(OFF)).toBe('')
  })

  it('names the project the log recorded and both tools', () => {
    const text = renderScopeSection(SELECTED)
    expect(text).toContain('the BI project Demo YH')
    expect(text).toContain('bi_list_charts')
    expect(text).toContain('bi_query_chart')
  })

  it('keeps the recorded name after the project is renamed elsewhere', () => {
    // The section reads the log, not a directory, so replaying a Session says
    // what it said then rather than what an administrator has since called it.
    expect(renderScopeSection({ ...SELECTED, project: { ref: REF, displayName: '演示项目' } })).toContain('演示项目')
    expect(renderScopeSection({ ...SELECTED, project: { ref: REF, displayName: '演示项目' } })).not.toContain('Demo YH')
  })

  it('tells the model how to draw, and that rows are data rather than instructions', () => {
    const text = renderScopeSection(SELECTED)
    expect(text).toContain('one lowercase `echarts` fence holding strict JSON')
    expect(text).toContain('Markdown table')
    expect(text).toContain('not instructions')
  })
})

describe('listing the charts a model may run', () => {
  it('answers the page naming the project, and asks the service for the recorded one', async () => {
    const mounted = await mountTool(undefined, { chartPageSize: 5 })
    const answer = await runTool(mounted, BI_LIST_CHARTS, { query: '销售', page: 2 })
    expect(answer.isError).toBe(false)
    expect(answer.meta).toEqual({ project: 'Demo YH', chartCount: 1, page: 1, total: 1 })
    expect(mounted.listings).toEqual([{ ref: REF, query: '销售', page: 2, pageSize: 5, signal: expect.any(AbortSignal) as AbortSignal }])
  })

  it('sends no keyword for a blank one and no page for one that is not a whole positive number', async () => {
    const mounted = await mountTool()
    await runTool(mounted, BI_LIST_CHARTS, { query: '   ', page: 0.5 })
    expect(mounted.listings[0]).toEqual({ ref: REF, pageSize: 20, signal: expect.any(AbortSignal) as AbortSignal })
  })

  it('refuses a listing while the Session is off, without reaching the Control Plane', async () => {
    const mounted = await mountTool(OFF)
    expect((await runTool(mounted, BI_LIST_CHARTS, {})).isError).toBe(true)
    expect(mounted.listings).toHaveLength(0)
  })

  it('refuses a listing with no agent to fold a Session for', async () => {
    const mounted = await mountTool()
    mounted.noAgent = true
    // No agent means no Session, and no Session means no choice was recorded;
    // that reads as off rather than as some project.
    expect((await runTool(mounted, BI_LIST_CHARTS, {})).isError).toBe(true)
    expect(mounted.listings).toHaveLength(0)
  })

  it('refuses a keyword that is not a string', async () => {
    const mounted = await mountTool()
    expect((await runTool(mounted, BI_LIST_CHARTS, { query: 7 })).isError).toBe(true)
    expect(mounted.listings).toHaveLength(0)
  })

  it('is classified parallel, because a listing mutates nothing', async () => {
    const mounted = await mountTool()
    const tools = mounted.ctx.get('tools') as ToolRuntime
    expect(tools.executionMode({
      signal: new AbortController().signal,
      callId: ToolCallId('call-mode'),
      name: BI_LIST_CHARTS,
      arguments: {},
    })).toEqual({ kind: 'parallel' })
  })
})

describe('running one chart', () => {
  it('runs the chart the listing offered, capping the row bound at the deployment ceiling', async () => {
    const mounted = await mountTool(undefined, { maxRows: 50 })
    const answer = await runTool(mounted, BI_QUERY_CHART, { chart: CHART, limit: 999 })
    expect(answer.isError).toBe(false)
    expect(answer.meta).toEqual({ project: 'Demo YH', chart: '销售总览', kind: 'line', rowCount: 2, truncated: false })
    expect(mounted.runs).toEqual([{ chartRef: CHART, limit: 50, signal: expect.any(AbortSignal) as AbortSignal }])
  })

  it('leaves an unbounded run unbounded, and ignores a bound that is not a whole positive number', async () => {
    const mounted = await mountTool()
    await runTool(mounted, BI_QUERY_CHART, { chart: CHART })
    await runTool(mounted, BI_QUERY_CHART, { chart: CHART, limit: 0 })
    expect(mounted.runs.map(request => request.limit)).toEqual([undefined, undefined])
  })

  it.each([
    ['a chart of another project', `${OTHER}/1b2c3d4e-0000-4000-8000-000000000001`],
    ['a reference that is not one', 'sales-overview'],
    ['a project reference with no chart', REF],
  ])('refuses %s without reaching the Control Plane', async (_label, chart) => {
    const mounted = await mountTool()
    const answer = await runTool(mounted, BI_QUERY_CHART, { chart })
    expect(answer.isError).toBe(true)
    expect(mounted.runs).toHaveLength(0)
  })

  it.each([
    ['no chart', {}],
    ['a chart that is not a string', { chart: 7 }],
  ])('refuses %s', async (_label, args) => {
    const mounted = await mountTool()
    expect((await runTool(mounted, BI_QUERY_CHART, args)).isError).toBe(true)
    expect(mounted.runs).toHaveLength(0)
  })

  it('refuses a run while the Session is off, without reaching the Control Plane', async () => {
    const mounted = await mountTool(OFF)
    expect((await runTool(mounted, BI_QUERY_CHART, { chart: CHART })).isError).toBe(true)
    expect(mounted.runs).toHaveLength(0)
  })

  it('is classified parallel, because a run mutates nothing', async () => {
    const mounted = await mountTool()
    const tools = mounted.ctx.get('tools') as ToolRuntime
    expect(tools.executionMode({
      signal: new AbortController().signal,
      callId: ToolCallId('call-mode-2'),
      name: BI_QUERY_CHART,
      arguments: { chart: CHART },
    })).toEqual({ kind: 'parallel' })
  })
})

describe('the prompt section is assembled from the Session log', () => {
  /** The BI section of one assembly, or undefined when it contributed none. */
  async function section(mounted: Mounted): Promise<string | undefined> {
    const prompt = mounted.ctx.get('systemPrompt') as SystemPromptRegistry
    const assembly = await prompt.assemble({ agent: mounted.agent as never })
    return assembly.sections.find(entry => entry.name === BI_SCOPE_SECTION)?.text
  }

  it('contributes nothing while the Session is off', async () => {
    // The section is registered and resolves to empty; rendering drops it.
    expect(await section(await mountTool(OFF))).toBe('')
  })

  it('names the recorded project under a selection', async () => {
    expect(await section(await mountTool())).toContain('the BI project Demo YH')
  })

  it('contributes nothing when there is no agent to fold a Session for', async () => {
    const mounted = await mountTool()
    const prompt = mounted.ctx.get('systemPrompt') as SystemPromptRegistry
    const assembly = await prompt.assemble({})
    expect(assembly.sections.find(entry => entry.name === BI_SCOPE_SECTION)?.text).toBe('')
  })
})

describe('the tools exist only while the Session analyzes a project', () => {
  /** Whether both tools are visible to the agent's own scope. */
  function visible(mounted: Mounted): boolean {
    const tools = mounted.ctx.get('tools') as ToolRuntime
    const names = new Set(tools.schemas(mounted.scopeKey).map(schema => schema.name))
    const both = names.has(BI_LIST_CHARTS) && names.has(BI_QUERY_CHART)
    const neither = !names.has(BI_LIST_CHARTS) && !names.has(BI_QUERY_CHART)
    // The two are hidden and shown together, never one without the other.
    expect(both || neither).toBe(true)
    return both
  }

  it('hides both tools for an agent whose Session is off', async () => {
    const mounted = await mountTool(OFF)
    expect(visible(mounted)).toBe(true)
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never, source: 'startup' })
    expect(visible(mounted)).toBe(false)
  })

  it('leaves both tools in place for an agent whose Session analyzes a project', async () => {
    const mounted = await mountTool()
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never, source: 'startup' })
    expect(visible(mounted)).toBe(true)
  })

  it('reveals the tools when a Session chooses a project mid-conversation', async () => {
    const mounted = await mountTool(OFF)
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never, source: 'startup' })
    expect(visible(mounted)).toBe(false)
    mounted.events.push({ seq: 0, type: 'bi/scope', data: SELECTED })
    mounted.ctx.emit('session/event', mounted.agent.session as never, { seq: 0, type: 'bi/scope', data: SELECTED } as never)
    expect(visible(mounted)).toBe(true)
  })

  it('hides them again when a Session turns BI off', async () => {
    const mounted = await mountTool()
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never, source: 'startup' })
    mounted.events.length = 0
    mounted.ctx.emit('session/event', mounted.agent.session as never, { seq: 1, type: 'bi/scope', data: OFF } as never)
    expect(visible(mounted)).toBe(false)
  })

  it('leaves a scope change alone when no agent is driving that Session', async () => {
    const mounted = await mountTool(OFF)
    mounted.noAgent = true
    mounted.ctx.emit('session/event', mounted.agent.session as never, { seq: 1, type: 'bi/scope', data: SELECTED } as never)
    // A Session with no live agent has no scope to restrict; visibility is
    // settled when an agent is created for it.
    expect(visible(mounted)).toBe(true)
  })

  it('ignores a session event that is not a scope change', async () => {
    const mounted = await mountTool(OFF)
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never, source: 'startup' })
    mounted.events.push({ seq: 1, type: 'bi/scope', data: SELECTED })
    mounted.ctx.emit('session/event', mounted.agent.session as never, { seq: 1, type: 'turn/start', data: { turn: 1 } } as never)
    // Only a scope change re-evaluates; an unrelated event leaves it alone.
    expect(visible(mounted)).toBe(false)
  })

  it('releases a disposed agent’s restriction rather than orphaning it', async () => {
    const mounted = await mountTool(OFF)
    mounted.ctx.emit('agent/created', { agent: mounted.agent as never, source: 'startup' })
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
    init: () => BiScope
    apply: (state: BiScope, event: { type: string; data: unknown }) => BiScope
    view: (state: BiScope) => unknown
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
    ctx.provide('bi', {
      catalog: () => Promise.resolve([]),
      charts: () => Promise.resolve(page()),
      query: () => Promise.resolve(run()),
    })
    ctx.provide('agents', { currentInitiator: () => undefined, get: () => undefined })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolBi, ToolBi.Config({}))
    if (registered === undefined) throw new Error('the BI unit did not register')
    const definition = registered as {
      key: string
      init: () => BiScope
      apply: (state: BiScope, event: { type: string; data: unknown }) => BiScope
      stateSchema: { parse: (value: unknown) => unknown }
      wire: { view: (state: BiScope) => unknown; viewSchema: { parse: (value: unknown) => unknown } }
    }
    expect(definition.key).toBe('bi')
    return {
      init: definition.init,
      apply: definition.apply,
      view: definition.wire.view,
      parse: value => definition.stateSchema.parse(value),
    }
  }

  it('starts a Session at off and takes the last recorded scope', async () => {
    const { init, apply } = await unit()
    expect(init()).toEqual(OFF)
    expect(apply(init(), { type: 'bi/scope', data: SELECTED })).toEqual(SELECTED)
  })

  it('keeps the scope in force when a recorded one is not one this build reads', async () => {
    const { init, apply } = await unit()
    const selected = apply(init(), { type: 'bi/scope', data: SELECTED })
    // A value the parser refuses leaves the scope as it was: silently turning
    // a member's choice off is a change they did not ask for.
    expect(apply(selected, { type: 'bi/scope', data: { version: 9, mode: 'everything' } })).toBe(selected)
  })

  it('returns the same state for an event it does not own', async () => {
    const { init, apply } = await unit()
    const state = init()
    // An unchanged reference is what produces zero downstream work.
    expect(apply(state, { type: 'turn/start', data: { turn: 1 } })).toBe(state)
  })

  it('serves clients the whole scope, name included', async () => {
    const { view } = await unit()
    expect(view(SELECTED)).toEqual(SELECTED)
  })

  it.each([
    ['off', OFF],
    ['a selection', SELECTED],
  ])('validates a persisted %s row before it seeds a fold', async (_label, value) => {
    const { parse } = await unit()
    expect(parse(value)).toEqual(value)
  })

  it.each([
    ['an unknown version', { version: 2, mode: 'off' }],
    ['an unknown mode', { version: 1, mode: 'all' }],
    ['a selection with no project', { version: 1, mode: 'selected' }],
    ['a project with no name', { version: 1, mode: 'selected', project: { ref: REF } }],
    ['an extra field', { version: 1, mode: 'off', extra: true }],
  ])('refuses a persisted row holding %s', async (_label, value) => {
    const { parse } = await unit()
    expect(() => parse(value)).toThrow()
  })
})

describe('the text a model reads back', () => {
  it('numbers the charts, names the project and the page, and carries each reference', async () => {
    const mounted = await mountTool()
    mounted.pageAnswer = page({
      charts: [
        ...page().charts,
        { chartRef: BiChartRef(`${REF}/1b2c3d4e-0000-4000-8000-000000000002`), ref: REF, name: '库存', spaceName: '', description: '', kind: 'table', updatedAt: undefined },
      ],
      page: 2,
      pageSize: 2,
      total: 5,
    })
    const text = await renderTool(mounted, BI_LIST_CHARTS, {})
    expect(text).toContain('Saved charts in Demo YH (page 2 of 3, 5 charts):')
    expect(text).toContain('[1] 销售总览 (line, 经营看板) — 按月的销售额与订单数。')
    expect(text).toContain(`chart: ${CHART}`)
    expect(text).toContain('[2] 库存 (table)\n')
  })

  it('names only the page when the total is unknown', async () => {
    const mounted = await mountTool()
    mounted.pageAnswer = page({ total: undefined })
    expect(await renderTool(mounted, BI_LIST_CHARTS, {})).toContain('(page 1):')
  })

  it('says plainly when nothing matched', async () => {
    const mounted = await mountTool()
    mounted.pageAnswer = page({ charts: [], total: 0 })
    expect(await renderTool(mounted, BI_LIST_CHARTS, { query: '利润' })).toBe('No saved charts in Demo YH matched.')
  })

  it('renders a run as its facts and a Markdown table of the rows', async () => {
    const mounted = await mountTool()
    mounted.runAnswer = run({
      rows: [['2026-01', 1200.5], ['a|b\nc', null], [true, 0]],
      rowCount: 40,
      truncated: true,
      cellsTruncated: true,
    })
    const text = await renderTool(mounted, BI_QUERY_CHART, { chart: CHART })
    expect(text).toContain('Ran 销售总览 (line) in Demo YH.')
    expect(text).toContain('Description: 按月的销售额与订单数。')
    expect(text).toContain('Saved filters: 订单状态 = 已完成')
    expect(text).toContain('Columns: 月份 [orders_month, dimension, date]; 销售额 [orders_amount, metric, number]')
    expect(text).toContain('| 月份 | 销售额 |\n| --- | --- |\n| 2026-01 | 1200.5 |\n| a\\|b c |  |\n| true | 0 |')
    expect(text).toContain('3 of 40 rows. More rows exist than were returned. Some text cells were cut to the deployment\'s bound.')
  })

  it('leaves out the facts a chart has none of, and counts rows alone when the total is unknown', async () => {
    const mounted = await mountTool()
    mounted.runAnswer = run({
      description: '',
      filters: '',
      fields: [{ id: 'orders_month', label: '月份', role: 'dimension', type: '' }],
      rows: [['2026-01']],
      rowCount: undefined,
    })
    const text = await renderTool(mounted, BI_QUERY_CHART, { chart: CHART })
    expect(text).not.toContain('Description:')
    expect(text).not.toContain('Saved filters:')
    expect(text).toContain('Columns: 月份 [orders_month, dimension]')
    expect(text).toContain('\n\n1 rows.')
  })

  it('says plainly when the chart returned no rows', async () => {
    const mounted = await mountTool()
    mounted.runAnswer = run({ rows: [], rowCount: 0 })
    expect(await renderTool(mounted, BI_QUERY_CHART, { chart: CHART })).toContain('The chart returned no rows.')
  })
})
