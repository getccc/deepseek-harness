/** Excel workbook presentation: SheetJS reads the workbook and Univer's sheets preset draws it as a spreadsheet. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LocaleType, type Univer } from '@univerjs/core'
import { createUniver, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import sheetsEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import sheetsZhCN from '@univerjs/preset-sheets-core/locales/zh-CN'
import { read } from 'xlsx'
import { bytesOf, type OfficeBodyProps, type RenderState } from './body.ts'
import { Failed, Loading, Unsupported } from './Status.tsx'
import { workbookSnapshot } from './xlsx-to-univer.ts'
import css from './SheetBody.module.css'

/**
 * The locale Univer renders in, from the document's language: the locale
 * runtime keeps `<html lang>` at the active locale.
 * @param lang - the document element's `lang`.
 * @returns Chinese for a Chinese document, else English.
 */
export function univerLocale(lang: string): LocaleType {
  return lang.toLowerCase().startsWith('zh') ? LocaleType.ZH_CN : LocaleType.EN_US
}

/**
 * Present an Excel workbook as a Univer spreadsheet: sheet tabs, gridlines,
 * column widths, merges, number formats, and formulas as the file recorded them.
 * @param props - complete bytes and the framework's tab and locale seats.
 * @returns the spreadsheet host, with a status line over it while loading or after a failure.
 */
export function SheetBody(props: OfficeBodyProps): ReactNode {
  const { tab } = props.useTabInfo()
  const data = bytesOf(props)
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<RenderState>()
  const [attempt, setAttempt] = useState(0)
  const { t } = props

  useEffect(() => {
    if (data === undefined || tab.signal.aborted) return
    // Univer owns a React root inside the element it is given and unmounts it
    // after dispose returns; a mount element of this body's own is removed
    // whole, so that later unmount finds its nodes where it left them.
    const mount = document.createElement('div')
    // The class map is generated from the stylesheet beside this file, which declares `.mount`.
    mount.className = css.mount as string
    ;(host.current as HTMLDivElement).append(mount)
    let univer: Univer | undefined
    setState({ kind: 'loading', data })
    try {
      const locale = univerLocale(document.documentElement.lang)
      // cellStyles carries the column widths, row heights, and hidden rows and columns the sheet draws.
      const snapshot = workbookSnapshot(read(data, { type: 'array', cellStyles: true }), locale)
      const created = createUniver({
        locale,
        locales: { [locale]: mergeLocales(locale === LocaleType.ZH_CN ? sheetsZhCN : sheetsEnUS) },
        presets: [UniverSheetsCorePreset({ container: mount })],
      })
      univer = created.univer
      created.univerAPI.createWorkbook(snapshot)
      setState({ kind: 'ready', data })
    } catch {
      // Bytes that are not a workbook, or a workbook the preset refuses: the
      // half-built instance goes with the failure, and retry starts clean.
      univer?.dispose()
      univer = undefined
      mount.remove()
      setState({ kind: 'failed', data })
    }
    return () => {
      univer?.dispose()
      mount.remove()
    }
  }, [data, tab.signal, attempt])

  if (data === undefined) return <Unsupported t={t} />
  const current = state?.data === data ? state : undefined
  return <section className={css.body} data-office-preview="xlsx">
    <div ref={host} className={css.host} />
    {current?.kind !== 'ready' && (
      <div className={css.overlay}>
        {current?.kind === 'failed'
          ? <Failed t={t} onRetry={() => { setAttempt(value => value + 1) }} />
          : <Loading t={t} />}
      </div>
    )}
  </section>
}
