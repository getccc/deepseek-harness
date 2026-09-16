/** The main panel listing the knowledge bases this member may search, and the documents in one. */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button, IconDataOutline16, fileSizeText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { KnowledgeChoice, KnowledgeDocumentsView } from '@deepseek-ai/dsh-api-knowledge-controller/types'
// Type-only: pulls the layout SlotMap merge (the keyed `main` panel seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import css from './panels.module.css'

/** What this panel needs from the plugin that registered it. */
export interface KnowledgeBasesInjected {
  /** The knowledge bases this member may search right now. */
  directory: () => Promise<readonly KnowledgeChoice[]>
  /** One page of one knowledge base's documents. */
  documents: (knowledgeRef: string, page: number) => Promise<KnowledgeDocumentsView>
  /** Open the retrieval panel with one knowledge base already chosen. */
  searchIn: (knowledgeRef: string) => void
}

/** Full panel props: the main slot's runtime share, the plugin's face, and the locale seat. */
export type KnowledgeBasesPanelProps =
  PropsRuntime<'main'>
  & InjectFace<KnowledgeBasesInjected>
  & PropsLocale<'knowledgePanels'>

/** What either column is showing right now. */
type Phase = 'loading' | 'ready' | 'failed'

/**
 * List the authorized knowledge bases, and the documents in the selected one.
 *
 * The directory is read on every mount rather than kept: a grant revoked since
 * the last look should narrow this list, and an empty answer is shown as
 * "nothing is authorized" while a refusal is shown as a failure — a member who
 * cannot be told apart from a member with no access learns the wrong thing.
 * The document list is read the same way, per knowledge base and per page.
 * @param props - the main slot's runtime share, the plugin's face, and the locale seat.
 * @returns the panel element tree.
 */
export function KnowledgeBasesPanel({ directory, documents, searchIn, t }: KnowledgeBasesPanelProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [entries, setEntries] = useState<readonly KnowledgeChoice[]>([])
  const [attempt, setAttempt] = useState(0)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [docsPhase, setDocsPhase] = useState<Phase>('loading')
  const [docs, setDocs] = useState<KnowledgeDocumentsView | undefined>(undefined)

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

  const select = (knowledgeRef: string): void => {
    setChosen(knowledgeRef)
    setPage(1)
    setDocs(undefined)
  }

  const rows = docs?.documents ?? []
  // The source reports a total only sometimes, so "there is more" is read from
  // the total when it says one, and from a full page when it does not.
  const more = docs === undefined
    ? false
    : docs.total === undefined
      ? rows.length === docs.pageSize
      : docs.page * docs.pageSize < docs.total

  return (
    <section className={css.panel} aria-label={t('bases.title')}>
      <header className={css.header}>
        <IconDataOutline16 size={16} />
        <h1 className={css.title}>{t('bases.title')}</h1>
      </header>
      {phase === 'loading' && <p className={css.notice}>{t('bases.loading')}</p>}
      {phase === 'failed' && (
        <p className={css.notice}>
          <span className={css.failed}>{t('bases.failed')}</span>
          <Button variant="outline" onClick={() => { setAttempt(attempt + 1) }}>{t('bases.retry')}</Button>
        </p>
      )}
      {phase === 'ready' && entries.length === 0 && <p className={css.notice}>{t('bases.empty')}</p>}
      {phase === 'ready' && entries.length > 0 && (
        <div className={css.columns}>
          <ul className={css.list}>
            {entries.map(entry => (
              <li key={entry.knowledgeRef} className={clsx(css.card, entry.knowledgeRef === chosen && css.cardOn)}>
                <button
                  type="button"
                  className={css.cardSelect}
                  aria-pressed={entry.knowledgeRef === chosen}
                  onClick={() => { select(entry.knowledgeRef) }}
                >
                  <span className={css.cardName}>{entry.displayName}</span>
                  {entry.description !== '' && <span className={css.cardText}>{entry.description}</span>}
                </button>
                <span className={css.cardActions}>
                  <Button variant="outline" onClick={() => { searchIn(entry.knowledgeRef) }}>
                    {t('bases.search')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>

          <div className={css.documents}>
            {chosen === undefined && <p className={css.notice}>{t('docs.select')}</p>}
            {chosen !== undefined && docsPhase === 'loading' && <p className={css.notice}>{t('docs.loading')}</p>}
            {chosen !== undefined && docsPhase === 'failed' && (
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
                <ul className={css.list}>
                  {rows.map(document => (
                    <li key={document.docRef} className={css.card}>
                      <span className={css.cardName}>
                        {document.title === '' ? document.fileName : document.title}
                        <span className={css.cardMeta}>{t(`docs.state.${document.state}`)}</span>
                      </span>
                      <span className={css.summary}>
                        {document.fileType !== '' && <span>{document.fileType}</span>}
                        {document.byteSize > 0 && <span>{fileSizeText(document.byteSize)}</span>}
                      </span>
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
          </div>
        </div>
      )}
    </section>
  )
}
