import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/chat-preset', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()
const PROMPT = 'Reply exactly CHAT_PRESET_REQUEST_OK and stop.'

/** Rendered text of the system prompt surface node, or undefined when the surface carries none. */
function systemPromptText(session: Session): string | undefined {
  const message = session.deriveMessages().find(candidate => candidate.role === 'system')
  return message?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

/**
 * The chat preset: a session created without a workspace, whose request
 * carries the persona and, once the member turns web access on, exactly the
 * two web tool schemas, and which the sidebar lists among recent
 * conversations rather than under a Workspace.
 */
describe('chat agent preset', () => {
  let scaffold: WebScaffold
  let agentHandle: AgentHandle
  let browser: Browser | undefined
  let page: Page | undefined
  let tripwire: ReturnType<typeof watchConsole> | undefined

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, compareReplaySession: true, paceMs: 10 })
    // No `cwd`: the session owns no working directory, exactly as the Web
    // client creates it when the member starts a new chat.
    agentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('chat-preset-smoke'),
      meta: { agentPreset: 'chat' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'chat').then(() => undefined),
    })
    // Off by default: once the switch has asked the web service whether this
    // member may search, it logs its initial value and registers /web on the
    // agent; every tool stays withheld meanwhile. Turning it on is what the
    // composer's 联网 chip records, so the pinned request is the switched-on one.
    await vi.waitFor(() => {
      expect(agentHandle.agent.session.snapshotEvents().filter(event => event.type === 'web/access').map(event => event.data))
        .toEqual([{ enabled: false }])
    })
    expect(scaffold.ctx.tools.schemas(agentHandle.agent)).toEqual([])
    const flipped = await scaffold.ctx.commands.execute(agentHandle.agent, '/web on', [], new AbortController().signal)
    expect(flipped?.result).toEqual({ kind: 'success', text: 'Web access on: web search and page fetching are offered from the next step.' })
    agentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: PROMPT }],
      source: { kind: 'user' },
    }))
    await agentHandle.agent.whenIdle()
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await page?.close().catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await agentHandle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'chat preset smoke teardown failed')
  })

  it('sends the persona with the two web tool schemas only, no cwd, and no workspace-bound service', async () => {
    const requestHeader = agentHandle.agent.session.requestHeader()
    if (requestHeader === undefined) throw new Error('the chat agent issued no model request')
    const systemPrompt = systemPromptText(agentHandle.agent.session)
    if (systemPrompt === undefined) throw new Error('the chat agent issued no system prompt')
    expect(agentHandle.agent.session.header.cwd).toBeUndefined()
    expect(scaffold.ctx.agentPresets.serviceFor(agentHandle.agent, 'fs')).toBeUndefined()
    expect(scaffold.ctx.agentPresets.serviceFor(agentHandle.agent, 'compaction')).toBeDefined()
    // The host-plane catalog is masked; the preset's own web rows are not.
    expect(scaffold.ctx.tools.schemas(agentHandle.agent).map(schema => schema.name)).toEqual(['web_search', 'web_fetch'])

    // The assembled prompt is pinned, normalized, in system-prompt.expected.md;
    // here only the facts the preset owns: the chat persona, no working
    // directory, the web guidance, and no goal command.
    expect(systemPrompt).toContain('You are chatting without a workspace')
    expect(systemPrompt).not.toContain('working directory is')
    expect(systemPrompt).toContain('Use the web_search tool')
    // Sorted: the replayed header carries the schemas in the fixture's normalized order.
    expect((requestHeader.tools ?? []).map(tool => tool.name).sort()).toEqual(['web_fetch', 'web_search'])
    expect(scaffold.ctx.commands.find(agentHandle.agent, 'goal')).toBeUndefined()
    expect(scaffold.ctx.commands.find(agentHandle.agent, 'web')).toBeDefined()
  })

  it.skipIf(MODE === 'record')('lists the chat among recent conversations and renders its reply', async () => {
    onTestFailed(() => { if (page !== undefined) void saveFailureShot(page, 'web-chat-preset-conversation') })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    // The chat session sits in the Recent list, never under a Workspace.
    const recent = page.getByRole('tree', { name: 'Recent' })
    await recent.waitFor({ timeout: 15_000 })
    await recent.getByRole('treeitem').first().click()
    await page.getByText('CHAT_PRESET_REQUEST_OK', { exact: true }).waitFor({ timeout: 15_000 })
    // The composer's web switch reads the projected on state the /web command logged.
    await page.getByRole('button', { name: 'Web access on, press to turn off' }).waitFor({ timeout: 15_000 })

    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'session.v3.jsonl',
      'system-prompt.expected.md',
      'tool-schemas.expected.json',
      'ui.expected.md',
    ])
  })
})
