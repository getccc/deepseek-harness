/**
 * Office documents opened from Files render in the right Sidebar through the
 * Team-only renderers, mounted here over the shipped web composition by an
 * overlay: Word pages through docx-preview and an Excel workbook as a table
 * with worksheet tabs.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { minimalDocx, workbookBytes } from '../../../packages/client/ui-sidebar-documentpreview-office/tests/fixtures.ts'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./office-preview.overlay.yml', import.meta.url))
// The lifecycle recording supplies the one turn that opens a conversation;
// the Sidebar controls sit on the conversation frame, not on the hero.
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url))
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: office documents in the Sidebar', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false, extraOverlayPath: OVERLAY })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })

  it('renders a Word document and an Excel workbook opened from Files', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-office-preview'))
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    const cwd = scaffold.ctx.agents.get(sessionId)?.session.header.cwd
    if (cwd === undefined) throw new Error('settled Session has no workspace cwd')
    await Promise.all([
      writeFile(join(cwd, 'brief.docx'), await minimalDocx('OFFICE_DOCX_TEXT')),
      writeFile(join(cwd, 'totals.xlsx'), workbookBytes({
        Totals: [['Item', 'Total'], ['OFFICE_XLSX_CELL', 42]],
        Notes: [['OFFICE_XLSX_SECOND']],
      })),
    ])

    const column = page.locator('[data-rightbar-col]')
    await page.locator('[data-sidebar-right-expand]').click()
    await column.locator('[data-files-state="tree"]').waitFor({ state: 'visible' })
    await column.locator('[data-files-reload]').click()
    const filesTab = column.locator('[data-dockkit-tab]').filter({ has: page.getByText('Files', { exact: true }) })
    const preview = column.locator('[data-document-preview]')
    const openFile = async (name: string): Promise<void> => {
      await filesTab.click()
      await column.locator('[data-files-entry="file"]').getByRole('button', { name, exact: true }).click()
      await expect.poll(async () => (await preview.getAttribute('data-textpreview-url'))?.endsWith(`/${name}`)).toBe(true)
    }

    await openFile('brief.docx')
    const docx = preview.locator('[data-office-preview="docx"]')
    await docx.getByText('OFFICE_DOCX_TEXT').waitFor({ timeout: 15_000 })
    expect(await docx.locator('[hidden]').count()).toBe(0)

    await openFile('totals.xlsx')
    const sheet = preview.locator('[data-office-preview="xlsx"]')
    await sheet.getByRole('cell', { name: 'OFFICE_XLSX_CELL' }).waitFor({ timeout: 15_000 })
    await sheet.getByRole('tab', { name: 'Notes' }).click()
    await sheet.getByRole('cell', { name: 'OFFICE_XLSX_SECOND' }).waitFor({ timeout: 5_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)
})
