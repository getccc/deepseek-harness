/**
 * The Session rename dialog shared by the Workspace browser and the Recent
 * list. Owned by the browser rather than the row so it outlives row unmounts
 * during collapse or archive. Sessions have no client-side name-conflict
 * rule (the host normalizes), and an unchanged title is deliberately
 * accepted: confirming the current automatic title is the gesture that pins
 * it. Mount it keyed by the target so a fresh target seeds a fresh draft.
 */
import { useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import css from './SessionRenameDialog.module.css'

/** The row being renamed: identity plus the title the draft seeds from. */
export interface SessionRenameTarget {
  sessionId: SessionId
  currentTitle: string
}

/**
 * Render the rename dialog for one target; closed while the target is null.
 * @param props.target - the row being renamed, or null while closed.
 * @param props.onClose - dismiss request (cancel, close control, or acceptance).
 * @param props.renameSession - the injected rename hop; rejection keeps the dialog open with the message.
 * @param props.t - the browser root's locale seat.
 * @returns the dialog element.
 */
export function SessionRenameDialog({ target, onClose, renameSession, t }: {
  target: SessionRenameTarget | null
  onClose: () => void
  renameSession: (sessionId: SessionId, title: string) => Promise<void>
  t: WorkspaceBrowserProps['t']
}) {
  const [draft, setDraft] = useState(target?.currentTitle ?? '')
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const composingRef = useRef(false)
  const trimmed = draft.trim()
  const blocked = renaming || trimmed === '' || target === null
  const close = () => {
    if (renaming) return
    onClose()
  }
  const confirm = () => {
    if (blocked) return
    setRenaming(true)
    setError(null)
    renameSession(target.sessionId, trimmed).then(() => {
      setRenaming(false)
      onClose()
    }).catch((reason: unknown) => {
      setRenaming(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open={target !== null}
      onClose={close}
      closeLabel={t('close')}
      title={t('rename.session.title')}
      footer={(
        <>
          <Button variant="outline" disabled={renaming} onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" disabled={blocked} onClick={confirm}>{t('rename')}</Button>
        </>
      )}
    >
      <input
        className={css.input}
        value={draft}
        aria-label={t('field.sessionName')}
        autoFocus
        disabled={renaming}
        onFocus={(e) => { e.target.select() }}
        onChange={(e) => { setDraft(e.target.value); setError(null) }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !composingRef.current) {
            e.preventDefault()
            confirm()
          }
        }}
      />
      {error !== null && <div className={css.error} role="alert">{error}</div>}
    </Modal>
  )
}
