/** The main panel listing the knowledge bases this member may search, the documents in one, and one document in a drawer. */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button, IconDataOutline16, fileSizeText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  KnowledgeChoice, KnowledgeDocumentContentView, KnowledgeDocumentsView, KnowledgeDocumentView,
} from '@deepseek-ai/dsh-api-knowledge-controller/types'
// Type-only: pulls the layout SlotMap merge (the keyed `main` panel seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { DocumentPreview } from './DocumentPreview.tsx'
import { dayText, titleOf } from './documents.ts'
import type { Translate } from './locales.ts'
import { Pager } from './Pager.tsx'
import css from './panels.module.css'

/** What this panel needs from the plugin that registered it. */
export interface KnowledgeBasesInjected {
  /** The knowledge bases this member may search right now. */
  directory: () => Promise<readonly KnowledgeChoice[]>
  /** One page of one knowledge base's documents. */
  documents: (knowledgeRef: string, page: number) => Promise<KnowledgeDocumentsView>
  /** One document's content: the original file, or the parsed text standing in for it. */
  content: (docRef: string) => Promise<KnowledgeDocumentContentView>
}

/** Full panel props: the main slot's runtime share, the plugin's face, and the locale seat. */
export type KnowledgeBasesPanelProps =
  PropsRuntime<'main'>
  & InjectFace<KnowledgeBasesInjected>
  & PropsLocale<'knowledgePanels'>

/** What either level is showing right now. */
type Phase = 'loading' | 'ready' | 'failed'

/**
 * A document card's footer: its type, size, and day, and its state only when
 * that state is one a member has to know.
 *
 * A searchable document is the ordinary case and says nothing; one still
 * parsing, or one the source will not search, says so, because otherwise a
 * member has no way to tell why a retrieval never reaches it. A document the
 * source reports none of these for leaves the footer out.
 * @param props - the document and the locale seat.
 * @returns the footer, or nothing.
 */
function DocumentFacts({ document, t }: { readonly document: KnowledgeDocumentView; readonly t: Translate }) {
  const tags: string[] = []
  if (document.state === 'processing') tags.push(t('docs.state.processing'))
  if (document.state === 'unavailable') tags.push(t('docs.state.unavailable'))
  if (document.fileType !== '') tags.push(document.fileType)
  if (document.byteSize > 0) tags.push(fileSizeText(document.byteSize))
  if (document.updatedAt !== undefined) tags.push(dayText(document.updatedAt))
  if (tags.length === 0) return null
  return (
    <span className={css.cardFoot}>
      {tags.map((tag, index) => <span key={`${String(index)}:${tag}`} className={css.cardTag}>{tag}</span>)}
    </span>
  )
}

/**
 * List the authorized knowledge bases, then the documents in the one a member
 * opened, then one document beside them.
 *
 * Two levels rather than side-by-side columns: a member arrives wanting to
 * know what there is, and the breadcrumb is what takes them back up. The
 * directory is read on every mount rather than kept — a grant revoked since
 * the last look should narrow this list, and an empty answer is shown as
 * "nothing is authorized" while a refusal is shown as a failure, because a
 * member who cannot tell those apart learns the wrong thing. The document list
 * is read the same way, per knowledge base and per page, and a document's
 * content per document opened.
 * @param props - the main slot's runtime share, the plugin's face, and the locale seat.
 * @returns the panel element tree.
 */
export function KnowledgeBasesPanel({ directory, documents, content, t }: KnowledgeBasesPanelProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [entries, setEntries] = useState<readonly KnowledgeChoice[]>([])
  const [attempt, setAttempt] = useState(0)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [docsPhase, setDocsPhase] = useState<Phase>('loading')
  const [docs, setDocs] = useState<KnowledgeDocumentsView | undefined>(undefined)
  const [opened, setOpened] = useState<KnowledgeDocumentView | undefined>(undefined)

  useEffect(() => {
    let live = true
    setPhase('loading')
    directory().then((rows) => {
      if (!live) return
      setEntries(rows)
      setPhase('ready')
    }, () => {
      if (live) setPhase('failed')
    })
    return () => { live = false }
  }, [directory, attempt])

  useEffect(() => {
    if (chosen === undefined) return
    let live = true
    setDocsPhase('loading')
    documents(chosen, page).then((answer) => {
      if (!live) return
      setDocs(answer)
      setDocsPhase('ready')
    }, () => {
      if (live) setDocsPhase('failed')
    })
    return () => { live = false }
  }, [documents, chosen, page])

  // Escape closes the drawer, which is the gesture a drawer over a list is
  // expected to answer; the listener lives only while one is open.
  useEffect(() => {
    if (opened === undefined) return
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpened(undefined)
    }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close) }
  }, [opened])

  const open = (knowledgeRef: string): void => {
    setChosen(knowledgeRef)
    setPage(1)
    setDocs(undefined)
    setOpened(undefined)
  }

  const back = (): void => {
    setChosen(undefined)
    setDocs(undefined)
    setOpened(undefined)
  }

  const rows = docs?.documents ?? []
  const chosenName = entries.find(entry => entry.knowledgeRef === chosen)?.displayName ?? ''

  return (
    <section className={css.panel} aria-label={t('bases.title')}>
      <nav className={css.crumbs} aria-label={t('crumbs.label')}>
        <IconDataOutline16 size={16} />
        {chosen === undefined
          ? <h1 className={css.title}>{t('bases.title')}</h1>
          : (
            <>
              <button type="button" className={css.crumbLink} onClick={back}>{t('bases.title')}</button>
              <span className={css.crumbMark} aria-hidden="true">/</span>
              <h1 className={css.title}>{chosenName}</h1>
            </>
          )}
      </nav>
      <p className={css.subtitle}>{chosen === undefined ? t('bases.subtitle') : t('docs.subtitle')}</p>

      <div className={css.body}>
        {chosen === undefined && (
          <>
            {phase === 'loading' && <p className={css.notice}>{t('bases.loading')}</p>}
            {phase === 'failed' && (
              <p className={css.notice}>
                <span className={css.failed}>{t('bases.failed')}</span>
                <Button variant="outline" onClick={() => { setAttempt(attempt + 1) }}>{t('bases.retry')}</Button>
              </p>
            )}
            {phase === 'ready' && entries.length === 0 && <p className={css.notice}>{t('bases.empty')}</p>}
            {phase === 'ready' && entries.length > 0 && (
              <ul className={css.grid}>
                {entries.map(entry => (
                  <li key={entry.knowledgeRef} className={clsx(css.card, css.cardFlush)}>
                    <button type="button" className={css.cardSelect} onClick={() => { open(entry.knowledgeRef) }}>
                      <span className={css.cardHead}>
                        <span className={css.cardName}>{entry.displayName}</span>
                        <span className={clsx(css.cardText, entry.description === '' && css.cardMeta)}>
                          {entry.description === '' ? t('bases.description.empty') : entry.description}
                        </span>
                      </span>
                      {/* What the Control Plane recorded about the knowledge
                          base itself. A deployment that reports neither leaves
                          the footer out rather than showing a zero. */}
                      {(entry.documentCount !== undefined || entry.createdAt !== undefined) && (
                        <span className={css.cardFoot}>
                          {entry.documentCount !== undefined && (
                            <span className={css.cardTag}>{t('bases.documents', { count: entry.documentCount })}</span>
                          )}
                          {entry.createdAt !== undefined && (
                            <span className={css.cardTag}>{t('bases.created', { day: dayText(entry.createdAt) })}</span>
                          )}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {chosen !== undefined && (
          <>
            {docsPhase === 'loading' && <p className={css.notice}>{t('docs.loading')}</p>}
            {docsPhase === 'failed' && (
              <p className={css.notice}><span className={css.failed}>{t('docs.failed')}</span></p>
            )}
            {docsPhase === 'ready' && docs !== undefined && rows.length === 0 && (
              <p className={css.notice}>{t('docs.empty')}</p>
            )}
            {docsPhase === 'ready' && docs !== undefined && rows.length > 0 && (
              <>
                <ul className={css.grid}>
                  {rows.map(document => (
                    <li
                      key={document.docRef}
                      className={clsx(css.card, css.cardFlush, document.docRef === opened?.docRef && css.cardOn)}
                    >
                      <button
                        type="button"
                        className={css.cardSelect}
                        aria-pressed={document.docRef === opened?.docRef}
                        onClick={() => { setOpened(document) }}
                      >
                        <span className={css.cardHead}>
                          <span className={css.cardName}>{titleOf(document)}</span>
                        </span>
                        <DocumentFacts document={document} t={t} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {/* Outside the scrolling body, so the pager holds the panel's bottom
          right however long or short the page is. */}
      {chosen !== undefined && docsPhase === 'ready' && docs !== undefined && rows.length > 0 && (
        <Pager
          page={docs.page}
          pageSize={docs.pageSize}
          total={docs.total}
          shown={rows.length}
          go={setPage}
          t={t}
        />
      )}

      {opened !== undefined && (
        <>
          {/* The scrim repeats the drawer's own close control, so it stays out
              of the accessibility tree rather than offering it twice. */}
          <button
            type="button"
            className={css.scrim}
            data-testid="knowledge-drawer-scrim"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => { setOpened(undefined) }}
          />
          <aside className={css.drawer} role="dialog" aria-label={titleOf(opened)}>
            <header className={css.drawerHead}>
              <span className={css.cardName}>{titleOf(opened)}</span>
              <Button variant="outline" onClick={() => { setOpened(undefined) }}>{t('drawer.close')}</Button>
            </header>
            <div className={css.drawerBody}>
              <DocumentPreview docRef={opened.docRef} content={content} t={t} />
            </div>
          </aside>
        </>
      )}
    </section>
  )
}
