// Keyless assembled-browser coverage for the composer GMO supply-chain control
// over the real Host Typert Remote flow. The Control Plane is the one thing
// faked: a fixture `ctx.gmo` mounted in this process stands in for it, because
// no keyless scenario can reach a real one. This is also the only tier that
// exercises the generated Remote client, which counts declared arguments — a
// control call that omits a trailing optional fails here and nowhere else.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  Gmo, GmoCategoryRef, GmoResultRef,
  type GmoAnswer, type GmoAskRequest, type GmoCategoryEntry, type GmoDescribeRequest, type GmoDescription,
  type GmoResultPage, type GmoResultsRequest,
} from '@deepseek-ai/dsh-gmo'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./gmo-composer.overlay.yml', import.meta.url))
const ANCHORS = [fileURLToPath(new URL('../../../packages/bundle/team/package.json', import.meta.url))]

const GB = GmoCategoryRef('exceltools:gmo:gb')
const MFC = GmoCategoryRef('exceltools:gmo:mfc')
const RESULT = GmoResultRef(`${GB}/0123456789abcdef0123456789abcdef`)

/**
 * What a Control Plane would answer, as a Runner-side service.
 *
 * Fixed answers rather than a recorded transport: the snapshot harness records
 * model traffic alone, so the Control Plane is the one layer a keyless
 * scenario has to supply itself. Everything above it — the Remote, the
 * control, the tools, the prompt section — is the shipped code.
 *
 * It mounts after boot, so the launch prints one best-effort warning for the
 * rows waiting on `gmo`; they activate when this arrives.
 */
class FixtureGmo extends Gmo {
  catalog(): Promise<readonly GmoCategoryEntry[]> {
    return Promise.resolve([
      { ref: GB, displayName: 'GB / GL 分配' },
      { ref: MFC, displayName: 'MFC 分配' },
    ])
  }

  results(request: GmoResultsRequest): Promise<GmoResultPage> {
    return Promise.resolve({
      ref: request.ref,
      results: [{
        resultRef: RESULT, ref: request.ref, name: '一键处理 · 2026-W42', toolName: 'GB 一键处理',
        period: '2026-W42', rows: 1200, createdAt: '2026-10-12 09:30', stages: [],
      }],
      page: 1,
      pageSize: 20,
      total: 1,
    })
  }

  describe(request: GmoDescribeRequest): Promise<GmoDescription> {
    return Promise.resolve({
      resultRef: request.resultRef,
      ref: GB,
      categoryLabel: 'GB / GL 分配',
      name: '一键处理 · 2026-W42',
      toolName: 'GB 一键处理',
      period: '2026-W42',
      rows: 1200,
      createdAt: '2026-10-12 09:30',
      today: '2026-10-16',
      weekStart: '2026-10-12',
      stages: [],
      fields: [{ key: 'remaining_gap', label: '剩余缺口', type: 'number', filter: '', description: '分配后仍未满足的需求数量。' }],
      sources: [],
      glossary: '',
    })
  }

  ask(request: GmoAskRequest): Promise<GmoAnswer> {
    return Promise.resolve({ resultRef: request.resultRef, ref: GB, kind: request.query.kind, data: { total: 1200 } })
  }
}

describe('web e2e: the composer GMO supply-chain control', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  // Every scope any Session records, in order, with the Session that recorded
  // it: the blank conversation the workspace pick opens is not known in advance.
  const scopes: { sessionId: string; data: unknown }[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: ANCHORS })
    await scaffold.ctx.plugin(FixtureGmo).await()
    scaffold.ctx.on('session/event', (session, event: SessionEvent) => {
      if (event.type === 'gmo/scope') scopes.push({ sessionId: session.id, data: event.data })
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

  it('chooses a category, which the log, the prompt, and the tool list all agree on, and clears it again', async () => {
    onTestFailed(async () => { await saveFailureShot(page, 'gmo-composer') })
    // A fresh conversation starts with no category: the chip says the bare
    // noun, and no GMO tool is offered.
    const chip = page.getByRole('button', { name: 'GMO供应链：未选择' })
    await chip.waitFor({ timeout: 15_000 })
    expect(scopes).toEqual([])

    // Opening the control reads the authorized directory through the Remote.
    await chip.click()
    await page.getByRole('menuitem', { name: 'GB / GL 分配' }).waitFor({ timeout: 15_000 })
    await page.getByRole('menuitem', { name: 'MFC 分配' }).waitFor()
    await page.getByRole('menuitem', { name: 'GB / GL 分配' }).click()

    // The choice is recorded with the name the directory held, and the chip
    // now names it from the projection of that same event.
    await expect.poll(() => scopes.at(-1)?.data).toEqual({
      version: 1, mode: 'selected', category: { ref: GB, displayName: 'GB / GL 分配' },
    })
    const chosen = page.getByRole('button', { name: 'GMO供应链：GB / GL 分配' })
    await chosen.waitFor({ timeout: 15_000 })
    await expect.poll(async () => await page.getByRole('menuitem').count()).toBe(0)

    // The model's side of the same fold: every tool is offered, and the
    // prompt section names exactly the recorded category.
    const sessionId = scopes.at(-1)?.sessionId ?? ''
    await expect.poll(() => toolsOf(sessionId)).toEqual(expect.arrayContaining([
      'gmo_list_results', 'gmo_describe_result', 'gmo_aggregate', 'gmo_overview', 'gmo_rows',
    ]))
    const agent = scaffold.ctx.agents.get(sessionId as never)
    const prompt = scaffold.ctx.get('systemPrompt') as SystemPrompt
    const assembly = await prompt.assemble({ agent: agent as never })
    expect(assembly.sections.find(section => section.name === 'gmo:scope')?.text).toContain('for the category GB / GL 分配')

    // Clicking the chosen category again leaves GMO analysis: the log says
    // off, the chip says the bare noun, and the tools are withdrawn.
    await chosen.click()
    await page.getByRole('menuitem', { name: 'GB / GL 分配' }).waitFor({ timeout: 15_000 })
    await page.getByRole('menuitem', { name: 'GB / GL 分配' }).click()
    await expect.poll(() => scopes.at(-1)?.data).toEqual({ version: 1, mode: 'off' })
    await page.getByRole('button', { name: 'GMO供应链：未选择' }).waitFor({ timeout: 15_000 })
    await expect.poll(() => toolsOf(sessionId).filter(name => name.startsWith('gmo_'))).toEqual([])

    // Nothing that identifies the excel-tools deployment reached the browser:
    // the control shows names and governed references, never an address or a token.
    expect(await page.content()).not.toMatch(/etg_|baseUrl|credentialRef|10\.1\.120\.90/u)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
