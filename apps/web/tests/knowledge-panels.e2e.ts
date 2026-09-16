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
import { pdfFixture } from '../../../packages/client/ui-sidebar-documentpreview/tests/pdf-fixture.ts'
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
      {
        ref: LINGANG, displayName: '临港智慧园区知识库', description: '园区运维、安防与应急预案', kind: 'document',
        documentCount: 3, createdAt: Date.parse('2026-09-01T06:59:39Z'),
      },
      // No count and no creation time: what a Control Plane older than those
      // fields answers, and the card has to leave its footer out.
      { ref: NANCHANG, displayName: '南昌制造基地知识库', description: '', kind: 'document' },
    ])
  }

  documents(request: KnowledgeDocumentsRequest): Promise<KnowledgeDocumentPage> {
    const first = [
      { id: 'doc-1', title: '园区运维手册 v3', description: '园区一级、二级故障的响应时限、处置流程与值班交接要求，覆盖供配电、暖通与安防三类系统。', fileName: '园区运维手册v3.pdf', fileType: 'pdf', byteSize: 2_340_000, state: 'ready' as const, day: '2026-09-12T02:00:00Z' },
      { id: 'doc-3', title: '2026 年度应急演练实施方案', description: '年度应急演练的组织分工、场景设计与评估标准，包含消防、电力中断、危化品泄漏三类场景。', fileName: '应急演练实施方案.md', fileType: 'md', byteSize: 12_400, state: 'ready' as const, day: '2026-09-10T02:00:00Z' },
      { id: 'doc-4', title: '门禁设备台账', description: '', fileName: '门禁设备台账.xlsx', fileType: 'xlsx', byteSize: 240_000, state: 'processing' as const, day: '2026-09-08T02:00:00Z' },
    ]
    // The Lingang base reports 190 documents at 20 a page, so the pager has
    // ten pages and folds a run of them; each page carries the same three rows
    // under its own ids.
    const rows = request.ref === LINGANG
      ? first.map(row => ({ ...row, id: `${row.id}-p${String(request.page ?? 1)}` }))
      : [{ id: 'doc-9', title: '产线交接规范', description: '南昌基地产线换班时的设备状态确认、异常记录与责任交接流程。', fileName: '产线交接规范.docx', fileType: 'docx', byteSize: 54_000, state: 'ready' as const, day: '2026-09-11T02:00:00Z' }]
    return Promise.resolve({
      ref: request.ref,
      documents: rows.map(row => ({
        docRef: KnowledgeDocRef(`${request.ref}/${row.id}`),
        ref: request.ref,
        title: row.title,
        description: row.description,
        fileName: row.fileName,
        fileType: row.fileType,
        byteSize: row.byteSize,
        state: row.state,
        updatedAt: Date.parse(row.day),
      })),
      page: request.page ?? 1,
      pageSize: 20,
      total: request.ref === LINGANG ? 190 : rows.length,
    })
  }

  documentContent(request: KnowledgeDocumentRequest): Promise<KnowledgeDocumentContent> {
    // The manual is a PDF and the drill plan a Markdown file, each served as
    // its original bytes the way a Control Plane serves a file under its bound.
    if (request.docRef.includes('/doc-1-')) {
      return Promise.resolve({
        kind: 'bytes', docRef: request.docRef, fileName: '园区运维手册v3.pdf', contentType: 'application/pdf', bytes: pdfFixture(),
      })
    }
    return Promise.resolve({
      kind: 'bytes',
      docRef: request.docRef,
      fileName: '应急演练实施方案.md',
      contentType: 'text/markdown; charset=utf-8',
      bytes: new TextEncoder().encode('# 2026 年度应急演练实施方案\n\n演练覆盖消防、电力中断、危化品泄漏三类场景。\n\n> 每季度至少组织一次综合演练。\n'),
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
  // Every scope any Session records, in order, with the Session that recorded
  // it: the discussion opens a Session of its own, so the assertion cannot
  // address one known in advance.
  const scopes: { sessionId: string; data: unknown }[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: ANCHORS })
    await scaffold.ctx.plugin(FixtureKnowledge).await()
    scaffold.ctx.on('session/event', (session, event: SessionEvent) => {
      if (event.type === 'knowledge/scope') scopes.push({ sessionId: session.id, data: event.data })
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
    await page.getByText('你有权限的知识库，点击卡片查看其中的文档').waitFor()
    await page.getByText('3 篇文档').waitFor()
    await page.getByText('创建于 2026-09-01').waitFor()

    await page.getByRole('button', { name: /临港智慧园区知识库/u }).click()
    await page.getByText('园区运维手册 v3').waitFor({ timeout: 15_000 })
    // What a member acts on: a state only when it is not the ordinary one, the
    // size, and how far the list goes — all read from the answer.
    await page.getByText('解析中').waitFor()
    expect(await page.getByText('可检索').count()).toBe(0)
    const pager = page.getByRole('navigation', { name: '文档分页' })
    await pager.getByText('共 190 篇').waitFor()
    expect(await pager.getByRole('button', { name: '上一页' }).isDisabled()).toBe(true)
    expect(await pager.getByRole('button', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page')
    await pager.getByRole('button', { name: '第 10 页' }).click()
    await expect.poll(async () => await pager.getByRole('button', { name: '第 10 页' }).getAttribute('aria-current')).toBe('page')
    expect(await pager.getByRole('button', { name: '下一页' }).isDisabled()).toBe(true)
    await pager.getByRole('button', { name: '第 1 页' }).click()
    await expect.poll(async () => await pager.getByRole('button', { name: '第 1 页' }).getAttribute('aria-current')).toBe('page')

    // A document opens in the drawer beside the list, drawn by the renderer
    // registered for its kind: Markdown as a document, a PDF as its pages.
    await page.getByRole('button', { name: /2026 年度应急演练实施方案/u }).click()
    const drawer = page.getByRole('dialog', { name: '2026 年度应急演练实施方案' })
    const markdown = drawer.locator('[data-document-markdown]')
    await markdown.getByRole('heading', { name: '2026 年度应急演练实施方案' }).waitFor({ timeout: 15_000 })
    await markdown.locator('blockquote', { hasText: '每季度至少组织一次综合演练。' }).waitFor()
    await drawer.getByRole('button', { name: '复制内容' }).waitFor()
    await drawer.getByRole('button', { name: '下载原文件' }).waitFor()
    // The drawer leaves once its exit has played.
    await drawer.getByRole('button', { name: '关闭' }).click()
    await expect.poll(async () => await page.getByRole('dialog').count()).toBe(0)

    await page.getByRole('button', { name: /园区运维手册 v3/u }).click()
    const manual = page.getByRole('dialog', { name: '园区运维手册 v3' })
    await manual.getByRole('img', { name: 'PDF 第 1 页', exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
    expect(await manual.locator('[data-pdf-page]').count()).toBe(2)
    expect(await manual.getByRole('button', { name: '复制内容' }).count()).toBe(0)
    await page.keyboard.press('Escape')
    await expect.poll(async () => await page.getByRole('dialog').count()).toBe(0)

    // The breadcrumb is what takes a member back to the cards.
    await page.getByRole('button', { name: '知识库', exact: true }).nth(1).click()
    await page.getByText('你有权限的知识库，点击卡片查看其中的文档').waitFor()
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it('shows the documents, ranks a retrieval, and opens a result as a conversation over it', async () => {
    onTestFailed(async () => { await saveFailureShot(page, 'knowledge-panels-search') })
    await page.getByRole('button', { name: '知识检索', exact: true }).click()
    // Before a search: every authorized knowledge base's documents, newest
    // first, each with the source's own summary.
    await page.getByText('南昌基地产线换班时的设备状态确认、异常记录与责任交接流程。').waitFor({ timeout: 15_000 })
    const box = page.getByPlaceholder('你想知道什么？')
    await box.fill('一级故障 响应')
    await box.press('Enter')

    // Three passages from two documents: the two sharing a document group
    // under its better score, which is what the rank follows. The query's
    // terms are marked inside the text.
    await page.getByText('相关度最高的 2 篇原文').waitFor({ timeout: 15_000 })
    await page.getByText('排名 1').waitFor()
    await page.getByText('相似度 0.87').waitFor()
    await page.getByText('（本段已截断）').waitFor()
    await page.locator('mark', { hasText: '一级故障' }).first().waitFor()

    await page.getByRole('button', { name: /园区运维手册 v3/u }).first().click()
    // The retrieval panel gives way to the conversation it opened: the
    // document sits above the composer the way an attached file does, and
    // nothing is typed for the member.
    await box.waitFor({ state: 'hidden', timeout: 20_000 })
    const dock = page.getByRole('group', { name: '本次对话基于 临港智慧园区知识库 中的这些文档回答' })
    await dock.getByText('园区运维手册 v3').waitFor({ timeout: 20_000 })
    expect((await page.locator('[data-composer-input]').innerText()).trim()).toBe('')

    // Narrowed to the result's document, recorded with the title it was chosen by.
    const recorded = scopes.at(-1)
    expect(recorded?.data).toEqual({
      version: 1,
      mode: 'selected',
      bases: [{ ref: LINGANG, displayName: '临港智慧园区知识库', documents: [{ ref: MANUAL, title: '园区运维手册 v3' }] }],
    })
    // The conversation is a chat, and it can search that document: the chat
    // composition lets knowledge search through where the deployment
    // registers it, and the tool is offered once the scope is recorded.
    const agent = scaffold.ctx.agents.get(recorded?.sessionId as never)
    expect(agent === undefined ? [] : scaffold.ctx.tools.schemas(agent).map(schema => schema.name)).toContain('knowledge_search')

    // Taking the document off leaves the conversation without knowledge.
    await dock.getByRole('button', { name: '从本次对话中移除 园区运维手册 v3' }).click()
    await expect.poll(() => scopes.at(-1)?.data).toEqual({ version: 1, mode: 'off' })
    await dock.waitFor({ state: 'detached', timeout: 20_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
