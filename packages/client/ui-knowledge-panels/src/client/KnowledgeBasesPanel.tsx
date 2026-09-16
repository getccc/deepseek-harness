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
 * The day a document last changed, as the calendar reads it here.
 *
 * Written out from the local parts rather than through `Intl`, so the same
 * timestamp reads the same in both dictionaries and a test can name the day it
 * expects.
 * @param at - epoch milliseconds the source reported.
 * @returns the day as `YYYY-MM-DD`.
 */
function dayText(at: number): string {
  const when = new Date(at)
  const month = String(when.getMonth() + 1).padStart(2, '0')
  const day = String(when.getDate()).padStart(2, '0')
  return `${String(when.getFullYear())}-${month}-${day}`
}

/** What a document card shows beside its name. */
function titleOf(document: KnowledgeDocumentView): string {
  return document.title === '' ? document.fileName : document.title
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
  // The source reports a total only sometimes, so "there is more" is read from
  // the total when it says one, and from a full page when it does not.
  const more = docs === undefined
    ? false
    : docs.total === undefined
      ? rows.length === docs.pageSize
      : docs.page * docs.pageSize < docs.total
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
              <span className={css.crumbMark} aria-hidden="true">/</span>
              <span className={css.crumbTail}>{t('docs.crumb')}</span>
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
                <p className={css.summary}>
                  {docs.total !== undefined && <span>{t('docs.count', { total: docs.total })}</span>}
                  <span>{t('docs.page', { page: docs.page })}</span>
                </p>
                <ul className={css.grid}>
                  {rows.map(document => (
                    <li
                      key={document.docRef}
                      className={clsx(css.card, document.docRef === opened?.docRef && css.cardOn)}
                    >
                      <button
                        type="button"
                        className={css.cardSelect}
                        aria-pressed={document.docRef === opened?.docRef}
                        onClick={() => { setOpened(document) }}
                      >
                        <span className={css.cardName}>{titleOf(document)}</span>
                        <span className={css.summary}>
                          <span>{t(`docs.state.${document.state}`)}</span>
                          {document.fileType !== '' && <span>{document.fileType}</span>}
                          {document.byteSize > 0 && <span>{fileSizeText(document.byteSize)}</span>}
                          {document.updatedAt !== undefined && <span>{dayText(document.updatedAt)}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <span className={css.cardActions}>
                  <Button variant="outline" disabled={docs.page <= 1} onClick={() => { setPage(docs.page - 1) }}>
                    {t('docs.prev')}
                  </Button>
                  <Button variant="outline" disabled={!more} onClick={() => { setPage(docs.page + 1) }}>
                    {t('docs.next')}
                  </Button>
                </span>
              </>
            )}
          </>
        )}
      </div>

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
