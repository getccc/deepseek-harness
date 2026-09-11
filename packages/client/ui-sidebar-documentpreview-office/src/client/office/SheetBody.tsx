/** Excel workbook presentation: SheetJS reads the workbook, and one worksheet at a time renders as a table. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { read, utils, type WorkBook } from 'xlsx'
import { bytesOf, type OfficeBodyProps } from './body.ts'
import { Failed, Loading, Unsupported } from './Status.tsx'
import css from './SheetBody.module.css'

/** Rows and columns one table shows; a larger sheet says so instead of stalling the pane. */
export const SHEET_DISPLAY_LIMITS = { rows: 2000, columns: 200 } as const

type ParseState =
  | { readonly kind: 'ready'; readonly data: Uint8Array<ArrayBuffer>; readonly workbook: WorkBook }
  | { readonly kind: 'failed'; readonly data: Uint8Array<ArrayBuffer> }

/** One worksheet folded to the text grid the table shows. */
export interface SheetGrid {
  readonly rows: readonly (readonly string[])[]
  readonly truncated: boolean
}

/**
 * Fold a worksheet into display rows within the display limits.
 * @param workbook - parsed workbook.
 * @param name - worksheet name.
 * @returns the grid, empty when the sheet holds no cells.
 */
export function sheetGrid(workbook: WorkBook, name: string): SheetGrid {
  const sheet = workbook.Sheets[name]
  if (sheet === undefined) return { rows: [], truncated: false }
  const source = utils.sheet_to_json<readonly unknown[]>(sheet, { header: 1, blankrows: false, defval: '' })
  const width = Math.max(0, ...source.map(row => row.length))
  const truncated = source.length > SHEET_DISPLAY_LIMITS.rows || width > SHEET_DISPLAY_LIMITS.columns
  const rows = source.slice(0, SHEET_DISPLAY_LIMITS.rows).map(row =>
    row.slice(0, SHEET_DISPLAY_LIMITS.columns).map(cell => cell instanceof Date ? cell.toISOString() : String(cell)),
  )
  return { rows, truncated }
}

/**
 * Present an Excel workbook one worksheet at a time.
 * @param props - complete bytes and the framework's tab and locale seats.
 * @returns worksheet tabs and the selected sheet's table, or a status line.
 */
export function SheetBody(props: OfficeBodyProps): ReactNode {
  const { tab } = props.useTabInfo()
  const data = bytesOf(props)
  const [state, setState] = useState<ParseState>()
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState(0)
  const { t } = props

  useEffect(() => {
    if (data === undefined || tab.signal.aborted) return
    setSelected(0)
    try {
      setState({ kind: 'ready', data, workbook: read(data, { type: 'array' }) })
    } catch {
      setState({ kind: 'failed', data })
    }
  }, [data, tab.signal, attempt])

  const current = state?.data === data ? state : undefined
  const names = current?.kind === 'ready' ? current.workbook.SheetNames : []
  const name = names[selected] ?? names[0]
  const grid = useMemo(
    () => current?.kind === 'ready' && name !== undefined ? sheetGrid(current.workbook, name) : undefined,
    [current, name],
  )

  if (data === undefined) return <Unsupported t={t} />
  if (current === undefined) return <Loading t={t} />
  if (current.kind === 'failed') return <Failed t={t} onRetry={() => { setAttempt(value => value + 1) }} />
  return <section className={css.body} data-office-preview="xlsx">
    {names.length > 1 && (
      <div className={css.tabs} role="tablist" aria-label={t('sheet.tabs')}>
        {names.map((sheetName, index) => (
          <button
            key={sheetName}
            type="button"
            role="tab"
            className={clsx(css.tab, sheetName === name && css.active)}
            aria-selected={sheetName === name}
            onClick={() => { setSelected(index) }}
          >
            {sheetName}
          </button>
        ))}
      </div>
    )}
    {grid === undefined || grid.rows.length === 0
      ? <p className={css.empty}>{t('sheet.empty')}</p>
      : <div className={css.scroll}>
        <table className={css.table} aria-label={name}>
          <tbody>
            {grid.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    {grid?.truncated === true && (
      <p className={css.notice} role="status">
        {t('sheet.truncated', { rows: SHEET_DISPLAY_LIMITS.rows, columns: SHEET_DISPLAY_LIMITS.columns })}
      </p>
    )}
  </section>
}
