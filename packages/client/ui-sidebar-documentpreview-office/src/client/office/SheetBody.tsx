/** Excel workbook presentation: SheetJS reads the workbook, and one worksheet at a time renders as a spreadsheet grid. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { read, utils, type CellObject, type ColInfo, type WorkBook, type WorkSheet } from 'xlsx'
import { bytesOf, type OfficeBodyProps } from './body.ts'
import { Failed, Loading, Unsupported } from './Status.tsx'
import css from './SheetBody.module.css'

/** Rows and columns one grid shows; a larger sheet says so instead of stalling the pane. */
export const SHEET_DISPLAY_LIMITS = { rows: 2000, columns: 200 } as const

/** Width, in CSS px, of a column the workbook leaves at Excel's default. */
export const DEFAULT_COLUMN_WIDTH = 64

/** Excel's "Max Digit Width" unit at the default font, plus its cell padding. */
const CHARACTER_WIDTH = 7
const CELL_PADDING = 5

type ParseState =
  | { readonly kind: 'ready'; readonly data: Uint8Array<ArrayBuffer>; readonly workbook: WorkBook }
  | { readonly kind: 'failed'; readonly data: Uint8Array<ArrayBuffer> }

/** One displayed column: its Excel letter and width. */
export interface SheetColumn {
  readonly label: string
  readonly width: number
}

/** One cell the grid draws; a merge's anchor spans the cells it covers. */
export interface SheetCell {
  readonly text: string
  readonly numeric: boolean
  readonly rowSpan: number
  readonly colSpan: number
}

/** One displayed row: its Excel number and cells, `null` where a merge above or left covers the position. */
export interface SheetRow {
  readonly number: number
  readonly cells: readonly (SheetCell | null)[]
}

/** One worksheet folded to the grid the table shows. */
export interface SheetGrid {
  readonly columns: readonly SheetColumn[]
  readonly rows: readonly SheetRow[]
  readonly truncated: boolean
}

/** @param info - the workbook's column record, if any. @returns the column's width in CSS px. */
export function columnWidth(info: ColInfo | undefined): number {
  if (info?.wpx !== undefined) return info.wpx
  if (info?.wch !== undefined) return Math.round(info.wch * CHARACTER_WIDTH + CELL_PADDING)
  return DEFAULT_COLUMN_WIDTH
}

/** The text Excel shows for a cell: its formatted text, else its value in the application's plain form. */
function cellText(cell: CellObject): string {
  if (cell.w !== undefined) return cell.w
  if (cell.v instanceof Date) return cell.v.toISOString()
  if (typeof cell.v === 'boolean') return cell.v ? 'TRUE' : 'FALSE'
  return cell.v === undefined ? '' : String(cell.v)
}

/** Merge spans by anchor position and the positions other anchors cover, within the display bounds. */
function mergeMap(sheet: WorkSheet, rows: number, columns: number): {
  readonly anchors: ReadonlyMap<string, { readonly rowSpan: number; readonly colSpan: number }>
  readonly covered: ReadonlySet<string>
} {
  const anchors = new Map<string, { rowSpan: number; colSpan: number }>()
  const covered = new Set<string>()
  for (const range of sheet['!merges'] ?? []) {
    const last = { r: Math.min(range.e.r, rows - 1), c: Math.min(range.e.c, columns - 1) }
    anchors.set(`${range.s.r},${range.s.c}`, { rowSpan: last.r - range.s.r + 1, colSpan: last.c - range.s.c + 1 })
    for (let r = range.s.r; r <= last.r; r += 1) {
      for (let c = range.s.c; c <= last.c; c += 1) if (r !== range.s.r || c !== range.s.c) covered.add(`${r},${c}`)
    }
  }
  return { anchors, covered }
}

/**
 * Fold a worksheet into the grid within the display limits: every column of
 * the used range that is not hidden, and every row through the last one
 * holding a cell.
 * @param workbook - parsed workbook.
 * @param name - worksheet name.
 * @returns the grid, with no rows when the sheet holds no cells.
 */
export function sheetGrid(workbook: WorkBook, name: string): SheetGrid {
  const sheet = workbook.Sheets[name]
  const ref = sheet?.['!ref']
  if (sheet === undefined || ref === undefined) return { columns: [], rows: [], truncated: false }
  const range = utils.decode_range(ref)
  const truncated = range.e.r >= SHEET_DISPLAY_LIMITS.rows || range.e.c >= SHEET_DISPLAY_LIMITS.columns
  const rowCount = Math.min(range.e.r + 1, SHEET_DISPLAY_LIMITS.rows)
  const columnCount = Math.min(range.e.c + 1, SHEET_DISPLAY_LIMITS.columns)
  const infos = sheet['!cols'] ?? []
  const visible = Array.from({ length: columnCount }, (_, c) => c).filter(c => infos[c]?.hidden !== true)
  const columns = visible.map(c => ({ label: utils.encode_col(c), width: columnWidth(infos[c]) }))
  const { anchors, covered } = mergeMap(sheet, rowCount, columnCount)
  const rows: SheetRow[] = []
  let lastFilled = -1
  for (let r = 0; r < rowCount; r += 1) {
    const cells = visible.map((c): SheetCell | null => {
      const position = `${r},${c}`
      if (covered.has(position)) return null
      const cell = sheet[utils.encode_cell({ r, c })] as CellObject | undefined
      if (cell !== undefined) lastFilled = r
      const span = anchors.get(position) ?? { rowSpan: 1, colSpan: 1 }
      return { text: cell === undefined ? '' : cellText(cell), numeric: cell?.t === 'n' || cell?.t === 'd', ...span }
    })
    rows.push({ number: r + 1, cells })
  }
  return { columns, rows: rows.slice(0, lastFilled + 1), truncated }
}

/**
 * Present an Excel workbook one worksheet at a time, as a grid with Excel's
 * column letters, row numbers, column widths, and merged cells.
 * @param props - complete bytes and the framework's tab and locale seats.
 * @returns worksheet tabs and the selected sheet's grid, or a status line.
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
      // cellStyles carries the column widths and hidden columns the grid draws.
      setState({ kind: 'ready', data, workbook: read(data, { type: 'array', cellStyles: true }) })
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
          <colgroup>
            <col className={css.rowHeaderColumn} />
            {grid.columns.map(column => <col key={column.label} style={{ width: column.width }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className={clsx(css.header, css.corner)} aria-hidden="true" />
              {grid.columns.map(column => <th key={column.label} scope="col" className={clsx(css.header, css.columnHeader)}>{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map(row => (
              <tr key={row.number}>
                <th scope="row" className={clsx(css.header, css.rowHeader)}>{row.number}</th>
                {row.cells.map((cell, index) => cell === null
                  ? null
                  : (
                    <td key={index} rowSpan={cell.rowSpan} colSpan={cell.colSpan} className={clsx(css.cell, cell.numeric && css.numeric)}>
                      {cell.text}
                    </td>
                  ))}
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
