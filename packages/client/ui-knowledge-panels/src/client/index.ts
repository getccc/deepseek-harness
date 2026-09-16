/**
 * Knowledge panels plugin, browser half: two rows under the sidebar's New work
 * task entry, and the two main panels they address — the knowledge bases this
 * member may search with the documents in one of them, and the retrieval they
 * run over them.
 *
 * Both panels read the Team-only `knowledge` Remote namespace, which
 * `@deepseek-ai/dsh-client-ui-knowledge` mounts; this plugin waits for it
 * rather than mounting it a second time, because a namespace is mounted once
 * per Client. Nothing a panel shows is kept between reads: the directory is
 * what the Control Plane authorized on the last call, and a retrieval answer
 * belongs to the query that asked for it.
 *
 * A retrieval starts no model turn and records no Session event. The one thing
 * these panels write is a `knowledge/scope` event, on the Session a member
 * opens from a result — which is the same event `/knowledge` records, through
 * the same Remote.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  KnowledgeChoice, KnowledgeDocumentContentView, KnowledgeDocumentsView, KnowledgeSearchView,
} from '@deepseek-ai/dsh-api-knowledge-controller/types'
// Type-only: the assembled Client Remote face these panels call.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-knowledge-controller/remote'
// Type-only: pulls the composer input face (a discussion opens with a draft).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the layout SlotMap merge (the keyed `main` panel seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the sidebar SlotMap merge (the panel-row list seat).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { KnowledgeBasesGlyph, KnowledgeSearchGlyph } from './Glyphs.tsx'
import { KnowledgeBasesPanel, type KnowledgeBasesInjected } from './KnowledgeBasesPanel.tsx'
import { KnowledgeSearchPanel, type DiscussTarget, type KnowledgeSearchInjected } from './KnowledgeSearchPanel.tsx'
import { en, zh, type KnowledgePanelsKey } from './locales.ts'

export { formatScore, groupByDocument } from './results.ts'
export type { DocumentGroup } from './results.ts'
export type { DocumentPreviewProps } from './DocumentPreview.tsx'
export { DocumentPreview } from './DocumentPreview.tsx'
export type { KnowledgeBasesInjected, KnowledgeBasesPanelProps } from './KnowledgeBasesPanel.tsx'
export type { DiscussTarget, KnowledgeSearchInjected, KnowledgeSearchPanelProps } from './KnowledgeSearchPanel.tsx'
export type { KnowledgePanelsKey, Translate } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The knowledge panels' copy. */
    knowledgePanels: KnowledgePanelsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'knowledgePanels'

/** The knowledge-base list: its sidebar row id, and the main panel it addresses. */
export const BASES_PANEL = 'knowledge' as MainPanelId

/** The retrieval panel: its sidebar row id, and the main panel it addresses. */
export const SEARCH_PANEL = 'knowledge-search' as MainPanelId

/**
 * Where these rows sit among the sidebar's panel rows.
 *
 * The list is ordered by this number and nothing else registers into it today,
 * so the two knowledge rows keep the order a member reads them in: what there
 * is, then how to search it.
 */
const BASES_ORDER = 10
const SEARCH_ORDER = 20

/** Required services: the panels' slot registry, the Remote face, and locale. */
export const inject = ['locale', 'remote', 'slots']

/**
 * Client plugin body: wait for the `knowledge` namespace, then register the
 * rows and panels over it.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.inject(['conversation', 'layout', 'locale', 'remote.knowledge', 'sessions', 'slots'], registerUi)
}

/**
 * Read one Remote answer, failing loud enough for a panel to show.
 *
 * Every call below passes every parameter the Remote declares: the generated
 * client counts declared arguments rather than required ones, so a call that
 * omits a trailing optional fails before it reaches the wire.
 */
function unwrap<T>(result: RemoteResult<T>): T {
  // Failure strings stay English (error-surface policy: not localized); the
  // panels show their own localized notice and never this text.
  if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
  return result.value
}

/** Register the two navigation rows and the two panels over a live `knowledge` namespace. */
function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-knowledge-panels: dictionaries')
  const t = ctx.locale.bind(NS)

  // What the knowledge-base list asked the retrieval panel to start from. It
  // is a request rather than a selection: the panel keeps it only while its
  // own directory read still holds that knowledge base.
  const requested = createSnapshotStore<readonly string[]>([])

  const directory = async (): Promise<readonly KnowledgeChoice[]> =>
    unwrap(await ctx.remote.knowledge.directory())

  const documents = async (knowledgeRef: string, page: number): Promise<KnowledgeDocumentsView> =>
    unwrap(await ctx.remote.knowledge.documents(knowledgeRef, page))

  const content = async (docRef: string): Promise<KnowledgeDocumentContentView> =>
    unwrap(await ctx.remote.knowledge.documentContent(docRef))

  const search = async (query: string, knowledgeRefs: readonly string[]): Promise<KnowledgeSearchView> =>
    unwrap(await ctx.remote.knowledge.search(
      query,
      knowledgeRefs.length === 0 ? 'all' : 'selected',
      [...knowledgeRefs],
    ))

  /**
   * Open a conversation about one passage: a new Session, scoped to the
   * document the passage came from, with the passage in its composer.
   *
   * The scope is recorded before the Session is shown, so the conversation a
   * member sees is already the one they asked for; the draft is written after,
   * because the composer's input machine exists once the Session is open.
   *
   * A result that named no document — a passage whose source this build could
   * not address — falls back to its knowledge base, which is the narrowest
   * scope such a result supports.
   */
  const discuss = async (target: DiscussTarget, draft: string): Promise<void> => {
    const sessionId = await ctx.sessions.create()
    unwrap(target.docRef === undefined
      ? await ctx.remote.knowledge.choose(sessionId, 'selected', [target.knowledgeRef])
      : await ctx.remote.knowledge.choose(sessionId, 'documents', [target.docRef]))
    ctx.sessions.open(sessionId)
    ctx.layout.selectPanel(null)
    const scope = ctx.sessions.scope(sessionId)
    if (scope !== undefined) ctx.conversation.input.for(scope).setDraft(draft)
  }

  ctx.slots.inject('sidebar.panellist', function* () {
    yield ctx.slots.register({
      name: 'sidebar.panellist',
      id: BASES_PANEL,
      order: BASES_ORDER,
      // A thunk, so the row follows a locale change without re-registering.
      label: () => t('bases.title'),
    }, KnowledgeBasesGlyph)
    yield ctx.slots.register({
      name: 'sidebar.panellist',
      id: SEARCH_PANEL,
      order: SEARCH_ORDER,
      label: () => t('search.title'),
    }, KnowledgeSearchGlyph)
  })

  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({
      name: 'main',
      key: BASES_PANEL,
      locale: NS,
      inject: (): KnowledgeBasesInjected => ({
        directory,
        documents,
        content,
        searchIn: (knowledgeRef) => {
          requested.set([knowledgeRef])
          ctx.layout.selectPanel(SEARCH_PANEL)
        },
      }),
    }, KnowledgeBasesPanel)
    yield ctx.slots.register({
      name: 'main',
      key: SEARCH_PANEL,
      locale: NS,
      inject: (): KnowledgeSearchInjected => ({
        directory,
        search,
        discuss,
        hooks: { requested },
      }),
    }, KnowledgeSearchPanel)
  })
}
