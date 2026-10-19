/** The Team identity retains space before any model output, with web tools offered and no composer switch. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-tool-web'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot, writeComposerDraft } from './support.ts'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./team-conversation.overlay.yml', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/team-conversation/ui.expected.md', import.meta.url))

describe('Team conversation layout', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let agent: Agent | undefined
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      replayFixture: join(ROOT, 'snapshots/web/chat-preset/session.v3.jsonl'),
      // Browser submissions add RPC and time-zone fields absent from the Host-authored recording.
      compareReplaySession: false,
      extraOverlayPath: OVERLAY,
      extraInstallAnchors: [join(ROOT, 'packages/bundle/team/package.json')],
    })
    // Hold the real loop before its first request so the empty process seat is deterministic.
    scaffold.ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      agent = subject
      entered.resolve(undefined)
      await release.promise
      return next()
    })
    browser = await chromium.launch()
    page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1500, height: 940 } })
    await page.route('**/team/account', route => route.fulfill({
      json: { loginName: 'layout-member', displayName: 'Layout Member' },
    }))
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]')
    await page.getByRole('button', { name: '新建对话', exact: true }).click()
    await writeComposerDraft(page, page.locator('[data-composer-input]').first(),
      'Reply exactly CHAT_PRESET_REQUEST_OK and stop.')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await entered.promise
    await vi.waitFor(() => {
      expect(agent!.session.snapshotEvents().filter(event => event.type === 'web/access').map(event => event.data))
        .toEqual([{ enabled: true }])
    })
    await page.locator('[data-slot="conversation.chat.assistant-identity"] > [data-status="running"]').waitFor()
  })

  afterAll(async () => {
    release.resolve(undefined)
    const failures: unknown[] = []
    await page?.close().catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw new AggregateError(failures, 'Team conversation teardown failed')
  })

  it('keeps the opening identity above the running status on wide and narrow screens', async () => {
    const view = page!
    onTestFailed(() => saveFailureShot(view, 'team-conversation-layout'))
    for (const width of [1500, 390]) {
      for (const colorScheme of ['light', 'dark'] as const) {
        await view.setViewportSize({ width, height: 940 })
        await view.emulateMedia({ colorScheme })
        const bounds = await view.locator('[data-slot="conversation.chat.assistant-identity"] > [data-status="running"]')
          .evaluate((identity) => {
            const seat = identity.closest('[data-chat-flow-key]')!
            const status = document.querySelector('[data-chat-running]')!
            const rect = identity.getBoundingClientRect()
            const row = seat.getBoundingClientRect()
            return {
              identityHeight: rect.height, seatHeight: row.height,
              identityBottom: rect.bottom, followingTop: status.getBoundingClientRect().top,
              pageWidth: document.documentElement.scrollWidth, viewport: window.innerWidth,
            }
          })
        expect(bounds.identityHeight).toBeGreaterThan(0)
        expect(bounds.seatHeight).toBeGreaterThanOrEqual(bounds.identityHeight)
        expect(bounds.followingTop).toBeGreaterThanOrEqual(bounds.identityBottom)
        expect(bounds.pageWidth).toBeLessThanOrEqual(bounds.viewport)
      }
    }
    await view.setViewportSize({ width: 1500, height: 940 })
    await view.emulateMedia({ colorScheme: 'light' })
    release.resolve(undefined)
    await agent!.whenIdle()
    const request = agent!.session.snapshotEvents().find(event => event.type === 'request/header')
    expect(request?.data.header.tools?.map(tool => tool.name).sort()).toEqual(['web_fetch', 'web_search'])
    await view.getByText('CHAT_PRESET_REQUEST_OK', { exact: true }).waitFor()
    expect(await view.getByRole('button', { name: /联网/u }).count()).toBe(0)
    const snapshot = await captureStableAria(view, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(EXPECTED, snapshot, webSnapshotMode())
  })
})
