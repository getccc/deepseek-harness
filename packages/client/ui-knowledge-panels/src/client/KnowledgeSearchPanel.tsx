/** The retrieval panel: a query over the chosen knowledge, the documents in it before a search, and the ranked answer after. */

import { Fragment, useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  FileTypeIcon, IconChevronDownOutline14, IconSendOutline14, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  KnowledgeChoice, KnowledgeDocumentsView, KnowledgeSearchView,
} from '@deepseek-ai/dsh-api-knowledge-controller/types'
// Type-only: pulls the layout SlotMap merge (the keyed `main` panel seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { dayText, feedOf, titleOf, type FeedDocument } from './documents.ts'
import { formatScore, groupByDocument, highlight, type DocumentGroup } from './results.ts'
import css from './panels.module.css'

/** What this panel needs from the plugin that registered it. */
export interface KnowledgeSearchInjected {
  /** The knowledge bases this member may search right now. */
  directory: () => Promise<readonly KnowledgeChoice[]>
  /** One page of one knowledge base's documents, which is what the feed is read from. */
  documents: (knowledgeRef: string, page: number) => Promise<KnowledgeDocumentsView>
  /** Run one retrieval; an empty selection searches every authorized knowledge base. */
  search: (query: string, knowledgeRefs: readonly string[]) => Promise<KnowledgeSearchView>
  /** Open a conversation scoped to one document, or to its knowledge base when it named none. */
  discuss: (target: DiscussTarget) => Promise<void>
}

/** Full panel props: the main slot's runtime share, the plugin's face, and the locale seat. */
export type KnowledgeSearchPanelProps =
  PropsRuntime<'main'>
  & InjectFace<KnowledgeSearchInjected>
  & PropsLocale<'knowledgePanels'>

/** What a discussion is opened about: one document, or the knowledge base holding it. */
export interface DiscussTarget {
  /** The knowledge base, which is the widest a discussion narrows to. */
  readonly knowledgeRef: string
  /** The document, when the result named one. */
  readonly docRef?: string
  /** The title the member chose the document by; the conversation records it. */
  readonly title: string
}

/** What the answer area is showing right now: the feed, a retrieval in flight, or its answer. */
type Phase = 'idle' | 'running' | 'ready' | 'failed'

/** What the feed is showing right now. */
type FeedPhase = 'loading' | 'ready' | 'failed'

/**
 * The scope menu's whole-set row.
 *
 * A `:` keeps it out of the reference space, the way the composer picker's
 * row does, so no knowledge base can collide with it.
 */
const ALL = 'all:'

/** The medal a rank wears: the first three are set apart, the rest are numbered. */
function medalOf(rank: number): string | undefined {
  if (rank === 1) return css.medalGold
  if (rank === 2) return css.medalSilver
  if (rank === 3) return css.medalBronze
  return undefined
}

/**
 * Retrieve from private knowledge without a model.
 *
 * Before a search it shows the documents in the chosen scope, newest first, so
 * a member arriving without a question can still find a document to talk
 * about. A search replaces them with the ranked answer, one card per document
 * under its best passage's rank, with the query's terms marked in the text;
 * emptying the query brings the documents back. The scope is a selection made
 * here that no Session records, because no model sees it. Selecting any card
 * — a document before a search, a result after — is the one thing that
 * reaches a model: a conversation narrowed to that document.
 * @param props - the main slot's runtime share, the plugin's face, and the locale seat.
 * @returns the panel element tree.
 */
export function KnowledgeSearchPanel({ directory, documents, search, discuss, t }: KnowledgeSearchPanelProps) {
  const [entries, setEntries] = useState<readonly KnowledgeChoice[] | undefined>(undefined)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [view, setView] = useState<KnowledgeSearchView | undefined>(undefined)
  const [feedPhase, setFeedPhase] = useState<FeedPhase>('loading')
  const [feed, setFeed] = useState<readonly FeedDocument[]>([])
  const [discussFailed, setDiscussFailed] = useState(false)

  useEffect(() => {
    let live = true
    directory().then((rows) => {
      if (live) setEntries(rows)
    }, () => {
      if (live) setEntries([])
    })
    return () => { live = false }
  }, [directory])

  // The feed follows the scope. A knowledge base whose listing fails is left
  // out rather than failing the rest; only a scope where every listing failed
  // says so.
  useEffect(() => {
    if (entries === undefined) return
    const refs = chosen === undefined ? entries.map(entry => entry.knowledgeRef) : [chosen]
    let live = true
    setFeedPhase('loading')
    void Promise.allSettled(refs.map(ref => documents(ref, 1))).then((settled) => {
      if (!live) return
      const pages = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      setFeed(feedOf(pages, entries))
      setFeedPhase(refs.length > 0 && pages.length === 0 ? 'failed' : 'ready')
    })
    return () => { live = false }
  }, [documents, entries, chosen])

  const run = (scope: string | undefined): void => {
    const text = query.trim()
    if (text === '') return
    setPhase('running')
    setDiscussFailed(false)
    search(text, scope === undefined ? [] : [scope]).then((answer) => {
      setView(answer)
      setAsked(text)
      setPhase('ready')
    }, () => {
      setView(undefined)
      setPhase('failed')
    })
  }

  const pick = (id: string): void => {
    setMenuOpen(false)
    const next = id === ALL ? undefined : id
    setChosen(next)
    // A shown answer belongs to the scope it was asked in, so a new scope asks again.
    if (phase !== 'idle') run(next)
  }

  const open = (target: DiscussTarget): void => {
    setDiscussFailed(false)
    discuss(target).catch(() => { setDiscussFailed(true) })
  }

  const groups: readonly DocumentGroup[] = view === undefined ? [] : groupByDocument(view)
  const scopeName = entries?.find(entry => entry.knowledgeRef === chosen)?.displayName ?? t('search.scope.all')

  return (
    <section className={css.panel} aria-label={t('search.title')}>
      <div className={css.body}>
        <div className={css.searchHead}>
          <h1 className={css.hero}>{t('search.hero')}</h1>
          <div className={css.queryBox}>
            <textarea
              className={css.queryInput}
              rows={2}
              value={query}
              placeholder={t('search.placeholder')}
              aria-label={t('search.title')}
              onChange={(event) => {
                setQuery(event.target.value)
                // An emptied query is a member going back to browsing.
                if (event.target.value.trim() === '') {
                  setPhase('idle')
                  setView(undefined)
                }
              }}
              onKeyDown={(event) => {
                // Enter searches; Shift+Enter is a new line, and an IME still
                // composing a word owns its own Enter.
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                event.preventDefault()
                run(chosen)
              }}
            />
            <div className={css.queryBar}>
              <Menu
                open={menuOpen}
                portal
                items={[
                  { id: ALL, label: t('search.scope.all') },
                  ...(entries ?? []).map(entry => ({ id: entry.knowledgeRef, label: entry.displayName })),
                ]}
                selectedId={chosen ?? ALL}
                onSelect={pick}
                onClose={() => { setMenuOpen(false) }}
                anchor={
                  <button
                    type="button"
                    className={css.scopeTrigger}
                    aria-label={t('search.scope.aria', { scope: scopeName })}
                    aria-expanded={menuOpen}
                    onClick={() => { setMenuOpen(!menuOpen) }}
                  >
                    <span className={css.scopeName}>{scopeName}</span>
                    <IconChevronDownOutline14 />
                  </button>
                }
              />
              <button
                type="button"
                className={css.send}
                aria-label={t('search.run')}
                disabled={phase === 'running' || query.trim() === ''}
                onClick={() => { run(chosen) }}
              >
                <IconSendOutline14 />
              </button>
            </div>
          </div>
        </div>

        {discussFailed && (
          <p className={clsx(css.notice, css.column)}><span className={css.failed}>{t('search.discuss.failed')}</span></p>
        )}

        {phase === 'idle' && (
          <>
            {feedPhase === 'loading' && <p className={clsx(css.notice, css.column)}>{t('search.feed.loading')}</p>}
            {feedPhase === 'failed' && <p className={clsx(css.notice, css.column)}><span className={css.failed}>{t('search.feed.failed')}</span></p>}
            {feedPhase === 'ready' && feed.length === 0 && <p className={clsx(css.notice, css.column)}>{t('search.feed.empty')}</p>}
            {feedPhase === 'ready' && feed.length > 0 && (
              <ul className={css.feed}>
                {feed.map(({ document, knowledgeName }) => (
                  <li key={document.docRef}>
                    <button
                      type="button"
                      className={css.feedCard}
                      title={t('search.discuss')}
                      onClick={() => {
                        open({ knowledgeRef: document.knowledgeRef, docRef: document.docRef, title: titleOf(document) })
                      }}
                    >
                      <span className={css.feedThumb} aria-hidden>
                        <FileTypeIcon path={document.fileName === '' ? titleOf(document) : document.fileName} size={36} />
                      </span>
                      <span className={css.feedMain}>
                        <span className={css.feedTitle}>{titleOf(document)}</span>
                        {document.description !== '' && <span className={css.feedText}>{document.description}</span>}
                        <span className={css.summary}>
                          {knowledgeName !== '' && <span>{knowledgeName}</span>}
                          {document.updatedAt !== undefined && <span>{dayText(document.updatedAt)}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {phase === 'running' && <p className={clsx(css.notice, css.column)}>{t('search.running')}</p>}
        {phase === 'failed' && <p className={clsx(css.notice, css.column)}><span className={css.failed}>{t('search.failed')}</span></p>}
        {phase === 'ready' && groups.length === 0 && <p className={clsx(css.notice, css.column)}>{t('search.empty')}</p>}
        {phase === 'ready' && view !== undefined && groups.length > 0 && (
          <>
            <p className={clsx(css.summary, css.column)}>
              {t('search.summary', { passages: view.passages.length, documents: groups.length })}
              {view.truncated && <span className={css.truncated}>{t('search.truncated')}</span>}
            </p>
            <ol className={css.ranked}>
              {groups.map((group, index) => {
                const rank = index + 1
                return (
                  <li key={group.key}>
                    <button
                      type="button"
                      className={css.rankCard}
                      title={t('search.discuss')}
                      onClick={() => {
                        open({
                          knowledgeRef: group.knowledgeRef,
                          ...(group.docRef === undefined ? {} : { docRef: group.docRef }),
                          title: group.title,
                        })
                      }}
                    >
                      <span className={clsx(css.medal, medalOf(rank))} aria-hidden>{rank}</span>
                      <span className={css.rankMain}>
                        <span className={css.rankHead}>
                          <span className={css.rankTitle}>{group.title}</span>
                          <span className={clsx(css.rankBadge, medalOf(rank))}>{t('search.rank', { rank })}</span>
                        </span>
                        <span className={css.rankText}>
                          {group.passages.map((passage, at) => (
                            <Fragment key={`${String(at)}:${passage.text}`}>
                              {at > 0 && ' … '}
                              {highlight(passage.text, asked).map((segment, part) => segment.match
                                ? <mark key={part} className={css.hit}>{segment.text}</mark>
                                : <Fragment key={part}>{segment.text}</Fragment>)}
                              {passage.truncated && <span className={css.cardMeta}>{t('search.passage.truncated')}</span>}
                            </Fragment>
                          ))}
                        </span>
                        <span className={css.cardFoot}>
                          <span className={css.cardTag}>{t('search.score', { score: formatScore(group.best) })}</span>
                          {group.knowledgeName !== '' && <span className={css.cardTag}>{group.knowledgeName}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </div>
    </section>
  )
}
