// Keyless assembled-browser coverage for the composer BI control over the
// real Host Typert Remote flow. The Control Plane is the one thing faked: a
// fixture `ctx.bi` mounted in this process stands in for it, because no
// keyless scenario can reach a real one. This is also the only tier that
// exercises the generated Remote client, which counts declared arguments — a
// control call that omits a trailing optional fails here and nowhere else.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  Bi, BiChartRef, BiProjectRef,
  type BiChartPage, type BiChartsRequest, type BiProjectEntry, type BiQueryRequest, type BiQueryResult,
} from '@deepseek-ai/dsh-bi'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./bi-composer.overlay.yml', import.meta.url))
const ANCHORS = [fileURLToPath(new URL('../../../packages/bundle/team/package.json', import.meta.url))]

const DEMO = BiProjectRef('webi:prod:690c0727-1af5-4b7a-8465-ebd2845f2266')
const SALES = BiProjectRef('webi:prod:08f25606-8876-49cc-b509-70e84828db08')
const OVERVIEW = BiChartRef(`${DEMO}/1b2c3d4e-0000-4000-8000-000000000001`)

/**
 * What a Control Plane would answer, as a Runner-side service.
 *
 * Fixed answers rather than a recorded transport: the snapshot harness records
 * model traffic alone, so the Control Plane is the one layer a keyless
 * scenario has to supply itself. Everything above it — the Remote, the
 * control, the tools, the prompt section — is the shipped code.
 *
 * It mounts after boot, so the launch prints one best-effort warning for the
 * rows waiting on `bi`; they activate when this arrives.
 */
class FixtureBi extends Bi {
  catalog(): Promise<readonly BiProjectEntry[]> {
    return Promise.resolve([
      { ref: DEMO, displayName: 'Demo YH' },
      { ref: SALES, displayName: '销售分析' },
    ])
  }

  charts(request: BiChartsRequest): Promise<BiChartPage> {
    return Promise.resolve({
      ref: request.ref,
      charts: [{
        chartRef: OVERVIEW, ref: request.ref, name: '销售总览', spaceName: '经营看板',
        description: '按月的销售额与订单数。', kind: 'line', updatedAt: Date.parse('2026-09-12T02:00:00Z'),
      }],
      page: 1,
      pageSize: 20,
      total: 1,
    })
  }

  query(request: BiQueryRequest): Promise<BiQueryResult> {
    return Promise.resolve({
      chartRef: request.chartRef,
      ref: DEMO,
      name: '销售总览',
      kind: 'line',
      description: '按月的销售额与订单数。',
      fields: [
        { id: 'orders_month', label: '月份', role: 'dimension', type: 'date' },
        { id: 'orders_amount', label: '销售额', role: 'metric', type: 'number' },
      ],
      filters: '',
      rows: [['2026-01', 1200.5], ['2026-02', 980]],
      rowCount: 2,
      truncated: false,
      cellsTruncated: false,
    })
  }
}

describe('web e2e: the composer BI control', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  // Every scope any Session records, in order, with the Session that recorded
  // it: the blank conversation the workspace pick opens is not known in advance.
  const scopes: { sessionId: string; data: unknown }[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: ANCHORS })
    await scaffold.ctx.plugin(FixtureBi).await()
    scaffold.ctx.on('session/event', (session, event: SessionEvent) => {
      if (event.type === 'bi/scope') scopes.push({ sessionId: session.id, data: event.data })
    })
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1500, height: 940 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 180_000)

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await scaffold?.close()
  })

  /** The tool names the live agent driving one Session may call. */
  const toolsOf = (sessionId: string): string[] => {
    const agent = scaffold.ctx.agents.get(sessionId as never)
    return agent === undefined ? [] : scaffold.ctx.tools.schemas(agent).map(schema => schema.name)
  }

  it('chooses a project, which the log, the prompt, and the tool list all agree on, and clears it again', async () => {
    onTestFailed(async () => { await saveFailureShot(page, 'bi-composer') })
    // A fresh conversation starts with no project: the chip says the bare
    // noun, and no BI tool is offered.
    const chip = page.getByRole('button', { name: 'BI 分析：未选择' })
    await chip.waitFor({ timeout: 15_000 })
    expect(scopes).toEqual([])

    // Opening the control reads the authorized directory through the Remote.
    await chip.click()
    await page.getByRole('menuitem', { name: 'Demo YH' }).waitFor({ timeout: 15_000 })
    await page.getByRole('menuitem', { name: '销售分析' }).waitFor()
    await page.getByRole('menuitem', { name: 'Demo YH' }).click()

    // The choice is recorded with the name the directory held, and the chip
    // now names it from the projection of that same event.
    await expect.poll(() => scopes.at(-1)?.data).toEqual({
      version: 1, mode: 'selected', project: { ref: DEMO, displayName: 'Demo YH' },
    })
    const chosen = page.getByRole('button', { name: 'BI 分析：Demo YH' })
    await chosen.waitFor({ timeout: 15_000 })
    await expect.poll(async () => await page.getByRole('menuitem').count()).toBe(0)

    // The model's side of the same fold: both tools are offered, and the
    // prompt section names exactly the recorded project.
    const sessionId = scopes.at(-1)?.sessionId ?? ''
    await expect.poll(() => toolsOf(sessionId)).toEqual(expect.arrayContaining(['bi_list_charts', 'bi_query_chart']))
    const agent = scaffold.ctx.agents.get(sessionId as never)
    const prompt = scaffold.ctx.get('systemPrompt') as SystemPrompt
    const assembly = await prompt.assemble({ agent: agent as never })
    expect(assembly.sections.find(section => section.name === 'bi:scope')?.text).toContain('the BI project Demo YH')

    // Clicking the chosen project again leaves BI analysis: the log says off,
    // the chip says the bare noun, and the tools are withdrawn.
    await chosen.click()
    await page.getByRole('menuitem', { name: 'Demo YH' }).waitFor({ timeout: 15_000 })
    await page.getByRole('menuitem', { name: 'Demo YH' }).click()
    await expect.poll(() => scopes.at(-1)?.data).toEqual({ version: 1, mode: 'off' })
    await page.getByRole('button', { name: 'BI 分析：未选择' }).waitFor({ timeout: 15_000 })
    await expect.poll(() => toolsOf(sessionId).filter(name => name.startsWith('bi_'))).toEqual([])

    // Nothing that identifies the BI deployment reached the browser: the
    // control shows names and governed references, never an address or a key.
    expect(await page.content()).not.toMatch(/ApiKey|apiKey|baseUrl|43\.154/u)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
