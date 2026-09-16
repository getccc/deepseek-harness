// Keyless assembled-browser coverage for the two knowledge panels over the
// real Host Typert Remote flow. The Control Plane is the one thing faked: a
// fixture `ctx.knowledge` mounted in this process stands in for it, because no
// keyless scenario can reach a real one. This is also the only tier that
// exercises the generated Remote client, which counts declared arguments — a
// panel call that omits a trailing optional fails here and nowhere else.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  Knowledge, KnowledgeDocRef, KnowledgeRef,
  type KnowledgeBaseEntry, type KnowledgeDocumentContent, type KnowledgeDocumentPage,
  type KnowledgeDocumentRequest, type KnowledgeDocumentsRequest,
  type KnowledgeSearchRequest, type KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { saveFailureShot } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./knowledge-panels.overlay.yml', import.meta.url))
const ANCHORS = [fileURLToPath(new URL('../../../packages/bundle/team/package.json', import.meta.url))]

const LINGANG = KnowledgeRef('weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266')
const NANCHANG = KnowledgeRef('weknora:prod:08f25606-8876-49cc-b509-70e84828db08')
const MANUAL = KnowledgeDocRef(`${LINGANG}/doc-1`)
const DRILL = KnowledgeDocRef(`${LINGANG}/doc-3`)

/**
 * What a Control Plane would answer, as a Runner-side service.
 *
 * Fixed answers rather than a recorded transport: the snapshot harness records
 * model traffic alone, so the Control Plane is the one layer a keyless
 * scenario has to supply itself. Everything above it — the Remote, the panels,
 * the slots — is the shipped code.
 *
 * It mounts after boot, so the launch prints one best-effort warning for the
 * controller row waiting on `knowledge`; the row activates when this arrives.
 */
class FixtureKnowledge extends Knowledge {
  catalog(): Promise<readonly KnowledgeBaseEntry[]> {
    return Promise.resolve([
      { ref: LINGANG, displayName: '临港智慧园区知识库', description: '园区运维、安防与应急预案', kind: 'document' },
      { ref: NANCHANG, displayName: '南昌制造基地知识库', description: '', kind: 'document' },
    ])
  }

  documents(request: KnowledgeDocumentsRequest): Promise<KnowledgeDocumentPage> {
    const rows = request.ref === LINGANG
      ? [
        { id: 'doc-1', title: '园区运维手册 v3', fileName: '园区运维手册v3.pdf', fileType: 'pdf', byteSize: 2_340_000, state: 'ready' as const },
        { id: 'doc-3', title: '2026 年度应急演练实施方案', fileName: '应急演练实施方案.md', fileType: 'md', byteSize: 12_400, state: 'ready' as const },
        { id: 'doc-4', title: '门禁设备台账', fileName: '门禁设备台账.xlsx', fileType: 'xlsx', byteSize: 240_000, state: 'processing' as const },
      ]
      : [{ id: 'doc-9', title: '产线交接规范', fileName: '产线交接规范.docx', fileType: 'docx', byteSize: 54_000, state: 'ready' as const }]
    return Promise.resolve({
      ref: request.ref,
      documents: rows.map(row => ({
        docRef: KnowledgeDocRef(`${request.ref}/${row.id}`),
        ref: request.ref,
        title: row.title,
        fileName: row.fileName,
        fileType: row.fileType,
        byteSize: row.byteSize,
        state: row.state,
        updatedAt: Date.parse('2026-09-10T02:00:00Z'),
      })),
      page: request.page ?? 1,
      pageSize: 20,
      total: rows.length,
    })
  }

  documentContent(request: KnowledgeDocumentRequest): Promise<KnowledgeDocumentContent> {
    return Promise.resolve({
      kind: 'text',
      docRef: request.docRef,
      fileName: '应急演练实施方案.md',
      text: '# 2026 年度应急演练实施方案\n\n演练覆盖消防、电力中断、危化品泄漏三类场景。',
      truncated: false,
    })
  }

  search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult> {
    return Promise.resolve({
      query: request.query,
      searched: [{ ref: LINGANG, displayName: '临港智慧园区知识库', description: '', kind: 'document' }],
      passages: [
        {
          ref: LINGANG,
          docRef: MANUAL,
          title: '园区运维手册 v3',
          text: '一级故障：接报后 30 分钟内到场，1 小时内形成处置方案。',
          truncated: false,
          score: 0.87,
        },
        {
          ref: LINGANG,
          docRef: MANUAL,
          title: '园区运维手册 v3',
          text: '值班经理需在每日 18:00 前完成交班记录。',
          truncated: true,
          score: 0.61,
        },
        {
          ref: LINGANG,
          docRef: DRILL,
          title: '2026 年度应急演练实施方案',
          text: '演练覆盖消防、电力中断、危化品泄漏三类场景。',
          truncated: false,
          score: 0.53,
        },
      ],
      truncated: false,
    })
  }
}

describe('web e2e: knowledge panels', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  // Every scope any Session records, in order: the discussion opens a Session
  // of its own, so the assertion cannot address one known in advance.
  const scopes: unknown[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: ANCHORS })
    await scaffold.ctx.plugin(FixtureKnowledge).await()
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => {
      if (event.type === 'knowledge/scope') scopes.push(event.data)
    })
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1500, height: 940 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await scaffold?.close()
  })

  it('lists the authorized knowledge bases, the documents in one, and one document', async () => {
    onTestFailed(async () => { await saveFailureShot(page, 'knowledge-panels-browse') })
    await page.getByRole('button', { name: '知识库', exact: true }).click()
    await page.getByText('临港智慧园区知识库').waitFor({ timeout: 15_000 })
    await page.getByText('南昌制造基地知识库').waitFor()
    await page.getByText('选择左侧的知识库，查看其中的文档').waitFor()

    await page.getByRole('button', { name: /临港智慧园区知识库/u }).click()
    await page.getByText('园区运维手册 v3').waitFor({ timeout: 15_000 })
    // What a member acts on: the state words, the size, and how far the list
    // goes — all read from the answer, none of it invented in the panel.
    await page.getByText('共 3 篇').waitFor()
    await page.getByText('解析中').waitFor()
    expect(await page.getByRole('button', { name: '上一页' }).isDisabled()).toBe(true)
    expect(await page.getByRole('button', { name: '下一页' }).isDisabled()).toBe(true)

    await page.getByRole('button', { name: /2026 年度应急演练实施方案/u }).click()
    await page.getByText('演练覆盖消防、电力中断、危化品泄漏三类场景。').waitFor({ timeout: 15_000 })
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it('ranks a retrieval under its documents and opens one as a narrowed conversation', async () => {
    onTestFailed(async () => { await saveFailureShot(page, 'knowledge-panels-search') })
    await page.getByRole('button', { name: '知识库检索', exact: true }).click()
    await page.getByPlaceholder('描述你要找的内容').fill('一级故障响应时间')
    await page.getByRole('button', { name: '检索', exact: true }).click()

    // Three passages from two documents: the two sharing a document group
    // under its better score, which is what the summary counts.
    await page.getByText('共 3 段，来自 2 篇原文').waitFor({ timeout: 15_000 })
    await page.getByText('相似度 0.87').waitFor()
    await page.getByText('（本段已截断）').waitFor()

    await page.getByRole('button', { name: '讨论这篇原文' }).first().click()
    // The retrieval panel gives way to the conversation it opened, whose
    // composer holds the passage: the member lands in the discussion, not
    // beside it.
    await page.getByPlaceholder('描述你要找的内容').waitFor({ state: 'hidden', timeout: 20_000 })
    const composer = page.locator('[data-composer-input]')
    await composer.getByText('关于《园区运维手册 v3》中的这段内容：').waitFor({ timeout: 20_000 })
    expect(await composer.innerText()).toContain('一级故障：接报后 30 分钟内到场，1 小时内形成处置方案。')

    // Narrowed to the result's document, recorded as the one knowledge base
    // carrying it.
    expect(scopes.at(-1)).toEqual({
      version: 1,
      mode: 'selected',
      bases: [{ ref: LINGANG, displayName: '临港智慧园区知识库', docRefs: [MANUAL] }],
    })
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
