/** Word document presentation: docx-preview lays the pages out inside a renderer-owned container. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { renderAsync } from 'docx-preview'
import { bytesOf, type OfficeBodyProps, type RenderState } from './body.ts'
import { Failed, Loading, Unsupported } from './Status.tsx'
import css from './DocxBody.module.css'

/**
 * Present a Word document as paginated HTML.
 * @param props - complete bytes and the framework's tab and locale seats.
 * @returns the rendered pages, or a status line while loading or after a failure.
 */
export function DocxBody(props: OfficeBodyProps): ReactNode {
  const { tab } = props.useTabInfo()
  const data = bytesOf(props)
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<RenderState>()
  const [attempt, setAttempt] = useState(0)
  const { t } = props

  useEffect(() => {
    const container = host.current
    if (data === undefined || container === null || tab.signal.aborted) return
    const lifetime = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, tab.signal])
    setState({ kind: 'loading', data })
    container.replaceChildren()
    // Images and fonts travel as base64 data URLs: nothing to revoke when the
    // tab closes, and no object URL outlives the container.
    void renderAsync(data, container, undefined, {
      inWrapper: true, ignoreWidth: false, ignoreHeight: false, breakPages: true,
      renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
      useBase64URL: true,
    }).then(
      () => { if (!signal.aborted) setState({ kind: 'ready', data }) },
      () => { if (!signal.aborted) setState({ kind: 'failed', data }) },
    )
    return () => {
      lifetime.abort()
      container.replaceChildren()
    }
  }, [data, tab.signal, attempt])

  if (data === undefined) return <Unsupported t={t} />
  const current = state?.data === data ? state : undefined
  return <section className={css.body} data-office-preview="docx">
    {current === undefined || current.kind === 'loading' ? <Loading t={t} /> : null}
    {current?.kind === 'failed' ? <Failed t={t} onRetry={() => { setAttempt(value => value + 1) }} /> : null}
    <div ref={host} className={css.pages} hidden={current?.kind !== 'ready'} />
  </section>
}
