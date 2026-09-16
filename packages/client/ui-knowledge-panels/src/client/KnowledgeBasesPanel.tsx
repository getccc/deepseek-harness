/** The main panel listing the knowledge bases this member may search. */

import { useEffect, useState } from 'react'
import { Button, IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { KnowledgeChoice } from '@deepseek-ai/dsh-api-knowledge-controller/types'
// Type-only: pulls the layout SlotMap merge (the keyed `main` panel seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import css from './panels.module.css'

/** What this panel needs from the plugin that registered it. */
export interface KnowledgeBasesInjected {
  /** The knowledge bases this member may search right now. */
  directory: () => Promise<readonly KnowledgeChoice[]>
  /** Open the retrieval panel with one knowledge base already chosen. */
  searchIn: (knowledgeRef: string) => void
}

/** Full panel props: the main slot's runtime share, the plugin's face, and the locale seat. */
export type KnowledgeBasesPanelProps =
  PropsRuntime<'main'>
  & InjectFace<KnowledgeBasesInjected>
  & PropsLocale<'knowledgePanels'>

/** What the panel is showing right now. */
type Phase = 'loading' | 'ready' | 'failed'

/**
 * List the authorized knowledge bases.
 *
 * The directory is read on every mount rather than kept: a grant revoked since
 * the last look should narrow this list, and an empty answer is shown as
 * "nothing is authorized" while a refusal is shown as a failure — a member who
 * cannot be told apart from a member with no access learns the wrong thing.
 * @param props - the main slot's runtime share, the plugin's face, and the locale seat.
 * @returns the panel element tree.
 */
export function KnowledgeBasesPanel({ directory, searchIn, t }: KnowledgeBasesPanelProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [entries, setEntries] = useState<readonly KnowledgeChoice[]>([])
  const [attempt, setAttempt] = useState(0)

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
        <ul className={css.list}>
          {entries.map(entry => (
            <li key={entry.knowledgeRef} className={css.card}>
              <span className={css.cardName}>{entry.displayName}</span>
              {entry.description !== '' && <span className={css.cardText}>{entry.description}</span>}
              <span className={css.cardActions}>
                <Button variant="outline" onClick={() => { searchIn(entry.knowledgeRef) }}>
                  {t('bases.search')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
