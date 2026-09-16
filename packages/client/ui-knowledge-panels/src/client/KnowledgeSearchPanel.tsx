/** The main panel a member retrieves from private knowledge with. */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button, IconSearchOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { KnowledgeChoice, KnowledgeSearchView } from '@deepseek-ai/dsh-api-knowledge-controller/types'
// Type-only: pulls the layout SlotMap merge (the keyed `main` panel seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { formatScore, groupByDocument, type DocumentGroup } from './results.ts'
import css from './panels.module.css'

/** What this panel needs from the plugin that registered it. */
export interface KnowledgeSearchInjected {
  /** The knowledge bases this member may search right now. */
  directory: () => Promise<readonly KnowledgeChoice[]>
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

/** What the result area is showing right now. */
type Phase = 'idle' | 'running' | 'ready' | 'failed'

/**
 * Retrieve from private knowledge without a model.
 *
 * The scope is a selection the member makes here and nothing else reads: no
 * Session records it, because no model sees it. What a result row offers is
 * the one thing that does reach a model — a conversation scoped to the
 * document's knowledge base, with the passage quoted in its composer.
 * @param props - the main slot's runtime share, the plugin's face, and the locale seat.
 * @returns the panel element tree.
 */
export function KnowledgeSearchPanel({ directory, search, discuss, t }: KnowledgeSearchPanelProps) {
  const [entries, setEntries] = useState<readonly KnowledgeChoice[]>([])
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [query, setQuery] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [view, setView] = useState<KnowledgeSearchView | undefined>(undefined)
  const [discussFailed, setDiscussFailed] = useState(false)

  useEffect(() => {
    let live = true
    directory().then((rows) => {
      if (!live) return
      setEntries(rows)
    }, () => {
      if (live) setEntries([])
    })
    return () => { live = false }
  }, [directory])

  const toggle = (knowledgeRef: string): void => {
    setChosen(chosen.includes(knowledgeRef)
      ? chosen.filter(ref => ref !== knowledgeRef)
      : [...chosen, knowledgeRef])
  }

  const run = (): void => {
    if (query.trim() === '') return
    setPhase('running')
    setDiscussFailed(false)
    search(query, chosen).then((answer) => {
      setView(answer)
      setPhase('ready')
    }, () => {
      setView(undefined)
      setPhase('failed')
    })
  }

  const open = (group: DocumentGroup): void => {
    setDiscussFailed(false)
    discuss({
      knowledgeRef: group.knowledgeRef,
      ...(group.docRef === undefined ? {} : { docRef: group.docRef }),
      title: group.title,
    }).catch(() => { setDiscussFailed(true) })
  }

  const groups = view === undefined ? [] : groupByDocument(view)

  return (
    <section className={css.panel} aria-label={t('search.title')}>
      <header className={css.header}>
        <IconSearchOutline16 size={16} />
        <h1 className={css.title}>{t('search.title')}</h1>
      </header>

      <div className={css.scope} role="group" aria-label={t('search.scope')}>
        <button
          type="button"
          className={clsx(css.chip, chosen.length === 0 && css.chipOn)}
          aria-pressed={chosen.length === 0}
          onClick={() => { setChosen([]) }}
        >
          {t('search.scope.all')}
        </button>
        {entries.map(entry => (
          <button
            key={entry.knowledgeRef}
            type="button"
            className={clsx(css.chip, chosen.includes(entry.knowledgeRef) && css.chipOn)}
            aria-pressed={chosen.includes(entry.knowledgeRef)}
            onClick={() => { toggle(entry.knowledgeRef) }}
          >
            {entry.displayName}
          </button>
        ))}
      </div>

      <div className={css.query}>
        <Input
          className={clsx(css.queryInput)}
          value={query}
          placeholder={t('search.placeholder')}
          aria-label={t('search.title')}
          onChange={(event) => { setQuery(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Enter') run() }}
        />
        <Button variant="primary" disabled={phase === 'running' || query.trim() === ''} onClick={run}>
          {phase === 'running' ? t('search.running') : t('search.run')}
        </Button>
      </div>

      {/* The scope and the query stay put; only the answer scrolls. */}
      <div className={css.body}>
        {phase === 'failed' && <p className={css.notice}><span className={css.failed}>{t('search.failed')}</span></p>}
        {discussFailed && (
          <p className={css.notice}><span className={css.failed}>{t('search.discuss.failed')}</span></p>
        )}
        {phase === 'ready' && groups.length === 0 && <p className={css.notice}>{t('search.empty')}</p>}
        {phase === 'ready' && view !== undefined && groups.length > 0 && (
          <>
            <p className={css.summary}>
              {t('search.summary', { passages: view.passages.length, documents: groups.length })}
              {view.truncated && <span className={css.truncated}>{t('search.truncated')}</span>}
            </p>
            <ul className={css.list}>
              {groups.map(group => (
                <li key={group.key} className={css.card}>
                  <span className={css.cardName}>
                    {group.title}
                    <span className={css.cardMeta}>{group.knowledgeName}</span>
                    <span className={css.cardMeta}>{t('search.score', { score: formatScore(group.best) })}</span>
                  </span>
                  {group.passages.map(passage => (
                    <span key={`${passage.title}${String(passage.score)}${passage.text}`} className={css.cardText}>
                      {passage.text}
                      {passage.truncated && <span className={css.cardMeta}>{t('search.passage.truncated')}</span>}
                    </span>
                  ))}
                  <span className={css.cardActions}>
                    <Button variant="outline" onClick={() => { open(group) }}>
                      {t('search.discuss')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
