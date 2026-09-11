/** PowerPoint presentation: pptx-renderer draws the slides as HTML and SVG inside a renderer-owned container. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer'
import { bufferOf, bytesOf, type OfficeBodyProps, type RenderState } from './body.ts'
import { Failed, Loading, Unsupported } from './Status.tsx'
import css from './PptxBody.module.css'

/**
 * Present a PowerPoint deck as a vertical list of slides.
 * @param props - complete bytes and the framework's tab and locale seats.
 * @returns the rendered slides, or a status line while loading or after a failure.
 */
export function PptxBody(props: OfficeBodyProps): ReactNode {
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
    let viewer: PptxViewer | undefined
    setState({ kind: 'loading', data })
    container.replaceChildren()
    // The zip limits bound what one deck may unpack; windowed rendering draws
    // the slides near the viewport first.
    void PptxViewer.open(bufferOf(data), container, {
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      listOptions: { windowed: true },
    }).then(
      (opened) => {
        if (signal.aborted) { opened.destroy(); return }
        viewer = opened
        setState({ kind: 'ready', data })
      },
      () => { if (!signal.aborted) setState({ kind: 'failed', data }) },
    )
    return () => {
      lifetime.abort()
      viewer?.destroy()
      viewer = undefined
      container.replaceChildren()
    }
  }, [data, tab.signal, attempt])

  if (data === undefined) return <Unsupported t={t} />
  const current = state?.data === data ? state : undefined
  return <section className={css.body} data-office-preview="pptx">
    {current === undefined || current.kind === 'loading' ? <Loading t={t} /> : null}
    {current?.kind === 'failed' ? <Failed t={t} onRetry={() => { setAttempt(value => value + 1) }} /> : null}
    <div ref={host} className={css.slides} hidden={current?.kind !== 'ready'} />
  </section>
}
