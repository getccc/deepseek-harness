/** The documents a conversation is narrowed to, shown above its composer the way attached files are. */

import { useState } from 'react'
import { IconCloseOutline16, IconDocumentOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the composer dock seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `knowledge` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-tool-knowledge/client'
import { documentsOf } from './scope.ts'
import css from './KnowledgeDocumentsDock.module.css'

/** What this dock needs from the plugin that registered it. */
export interface KnowledgeDocumentsDockInjected {
  /** Take one document off this conversation; taking off the last one turns knowledge off. */
  remove: (docRef: string) => Promise<void>
}

/** Full dock props: the composer dock's runtime share, the plugin's face, and the locale seat. */
export type KnowledgeDocumentsDockProps =
  PropsRuntime<'conversation.input.dock'>
  & InjectFace<KnowledgeDocumentsDockInjected>
  & PropsLocale<'knowledge'>

/**
 * Show the documents this conversation answers from, one chip each.
 *
 * Read from the `knowledge` projection, so it is the recorded scope rather
 * than whatever a panel asked for: a chip here is a document the model is
 * told about and may search. It renders for any Session kind, because the
 * knowledge panels open a chat narrowed to a document, and that is the one
 * place a chat carries knowledge at all.
 * @param props - the composer dock's runtime share, the plugin's face, and the locale seat.
 * @returns the chips, or null while the conversation is not narrowed to documents.
 */
export function KnowledgeDocumentsDock({ useProjection, remove, t }: KnowledgeDocumentsDockProps) {
  const scope = useProjection('knowledge')
  const [failed, setFailed] = useState(false)
  const narrowed = scope === undefined ? undefined : documentsOf(scope)
  if (narrowed === undefined) return null

  return (
    <div className={css.dock} role="group" aria-label={t('dock.label', { name: narrowed.base.displayName })}>
      {narrowed.documents.map((document) => {
        const title = document.title === '' ? t('dock.untitled') : document.title
        return (
          <span key={document.ref} className={css.file}>
            <span className={css.icon} aria-hidden><IconDocumentOutline16 size={14} /></span>
            <span className={css.name} title={title}>{title}</span>
            <button
              type="button"
              className={css.remove}
              aria-label={t('dock.remove', { title })}
              onClick={() => {
                setFailed(false)
                void remove(document.ref).catch(() => { setFailed(true) })
              }}
            >
              <IconCloseOutline16 size={12} />
            </button>
          </span>
        )
      })}
      {failed && <span className={css.failed}>{t('dock.failed')}</span>}
    </div>
  )
}
