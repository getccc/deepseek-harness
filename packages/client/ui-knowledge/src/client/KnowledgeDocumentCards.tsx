/** The documents a conversation is narrowed to, drawn inside its composer the way attached files are. */

import { useState } from 'react'
import { fileExtension, FileTypeIcon, IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the composer context seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `knowledge` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-tool-knowledge/client'
import { documentsOf } from './scope.ts'
import css from './KnowledgeDocumentCards.module.css'

/** What these cards need from the plugin that registered them. */
export interface KnowledgeDocumentCardsInjected {
  /** Take one document off this conversation; taking off the last one turns knowledge off. */
  remove: (docRef: string) => Promise<void>
}

/** Full props: the composer context seat's runtime share, the plugin's face, and the locale seat. */
export type KnowledgeDocumentCardsProps =
  PropsRuntime<'conversation.input.context'>
  & InjectFace<KnowledgeDocumentCardsInjected>
  & PropsLocale<'knowledge'>

/**
 * Show the documents this conversation answers from, one card each, where a
 * draft's attached files show.
 *
 * Read from the `knowledge` projection, so a card is the recorded scope rather
 * than whatever a panel asked for: it is a document the model is told about
 * and may search. The cards borrow the attached-file card's shape — the file's
 * kind, its title, a second line — because a member reads them the same way,
 * as what the next message is about; the second line names the knowledge base,
 * which is what the log records beside the title. They render for any Session
 * kind, because the knowledge panels open a chat narrowed to a document, and
 * that is the one way a chat carries knowledge at all.
 * @param props - the composer context seat's runtime share, the plugin's face, and the locale seat.
 * @returns the cards, or null while the conversation is not narrowed to documents.
 */
export function KnowledgeDocumentCards({ useProjection, remove, t }: KnowledgeDocumentCardsProps) {
  const scope = useProjection('knowledge')
  const [failed, setFailed] = useState(false)
  const narrowed = scope === undefined ? undefined : documentsOf(scope)
  if (narrowed === undefined) return null

  return (
    <div className={css.rail} role="group" aria-label={t('dock.label', { name: narrowed.base.displayName })}>
      {narrowed.documents.map((document) => {
        const title = document.title === '' ? t('dock.untitled') : document.title
        const kind = fileExtension(document.title).toUpperCase().slice(0, 8)
        return (
          <div key={document.ref} className={css.card} title={title}>
            <span className={css.icon} aria-hidden><FileTypeIcon path={document.title} /></span>
            <span className={css.body}>
              <span className={css.name}>{title}</span>
              <span className={css.meta}>{[kind, narrowed.base.displayName].filter(part => part !== '').join(' · ')}</span>
            </span>
            <button
              type="button"
              className={css.remove}
              aria-label={t('dock.remove', { title })}
              onClick={() => {
                setFailed(false)
                void remove(document.ref).catch(() => { setFailed(true) })
              }}
            >
              <IconCloseFill14 size={12} />
            </button>
          </div>
        )
      })}
      {failed && <span className={css.failed}>{t('dock.failed')}</span>}
    </div>
  )
}
