/** Fold a SheetJS workbook into the snapshot Univer's sheets preset opens. */
import {
  BooleanNumber, CellValueType, type ICellData, type IColumnData, type IRowData, type IWorkbookData, type IWorksheetData,
  type LocaleType,
} from '@univerjs/core'
import { utils, type CellObject, type ColInfo, type RowInfo, type WorkBook, type WorkSheet } from 'xlsx'

/** Rows and columns a worksheet shows at least, so the canvas has room to paint. */
export const SHEET_FLOOR = { rows: 20, columns: 10 } as const

/** Column and row sizes for cells the workbook leaves unsized, in Univer's canvas px. */
const DEFAULTS = { columnWidth: 96, rowHeight: 22, rowHeaderWidth: 46, columnHeaderHeight: 20 } as const

/** Excel's "Max Digit Width" unit at the default font, in px. */
const CHARACTER_WIDTH = 7

/**
 * The snapshot for one workbook.
 * @param workbook - parsed workbook.
 * @param locale - the locale Univer renders in.
 * @returns a workbook snapshot with one worksheet per SheetJS sheet, or one empty sheet for a workbook without any.
 */
export function workbookSnapshot(workbook: WorkBook, locale: LocaleType): IWorkbookData {
  const sheetOrder: string[] = []
  const sheets: Record<string, Partial<IWorksheetData>> = {}
  workbook.SheetNames.forEach((name, index) => {
    const id = `sheet-${index}`
    sheetOrder.push(id)
    sheets[id] = worksheetSnapshot(workbook.Sheets[name] ?? {}, name, id)
  })
  if (sheetOrder.length === 0) {
    sheetOrder.push('sheet-0')
    sheets['sheet-0'] = { id: 'sheet-0', name: 'Sheet1', rowCount: SHEET_FLOOR.rows, columnCount: SHEET_FLOOR.columns }
  }
  return { id: 'workbook', name: workbook.Props?.Title ?? 'Workbook', appVersion: '', locale, styles: {}, sheetOrder, sheets }
}

/** One worksheet's cells, merges, sizes, and hidden rows and columns. */
function worksheetSnapshot(sheet: WorkSheet, name: string, id: string): Partial<IWorksheetData> {
  const cellData: Record<number, Record<number, ICellData>> = {}
  for (const [address, value] of Object.entries(sheet)) {
    if (address.startsWith('!')) continue
    const { r, c } = utils.decode_cell(address)
    ;(cellData[r] ??= {})[c] = cellSnapshot(value as CellObject)
  }
  const mergeData = (sheet['!merges'] ?? []).map(range => ({
    startRow: range.s.r, endRow: range.e.r, startColumn: range.s.c, endColumn: range.e.c,
  }))
  return {
    id,
    name,
    tabColor: '',
    hidden: BooleanNumber.FALSE,
    freeze: { startRow: -1, startColumn: -1, xSplit: 0, ySplit: 0 },
    ...dimensions(sheet, cellData),
    defaultColumnWidth: DEFAULTS.columnWidth,
    defaultRowHeight: DEFAULTS.rowHeight,
    mergeData,
    cellData,
    rowData: rowSnapshots(sheet['!rows']),
    columnData: columnSnapshots(sheet['!cols']),
    rowHeader: { width: DEFAULTS.rowHeaderWidth },
    columnHeader: { height: DEFAULTS.columnHeaderHeight },
    showGridlines: BooleanNumber.TRUE,
    rightToLeft: BooleanNumber.FALSE,
  }
}

/**
 * A cell's typed value and formula; text keeps the formatted form Excel showed.
 * @param cell - one SheetJS cell.
 * @returns the cell's Univer value type and value, plus its formula when it has one.
 */
export function cellSnapshot(cell: CellObject): ICellData {
  const out: ICellData = {}
  switch (cell.t) {
    case 'b':
      out.t = CellValueType.BOOLEAN
      out.v = cell.v === true
      break
    case 'n':
      out.t = CellValueType.NUMBER
      out.v = Number(cell.v)
      break
    case 'e':
      out.t = CellValueType.FORCE_STRING
      out.v = String(cell.w ?? cell.v ?? '')
      break
    default:
      out.t = CellValueType.STRING
      out.v = cell.w ?? (cell.v === undefined ? '' : String(cell.v))
  }
  if (cell.f !== undefined && cell.f !== '') out.f = cell.f
  return out
}

/**
 * Column widths and hidden columns, sparse by index; a width comes from px when the file gives them, else from characters.
 * @param columns - the sheet's `!cols` entries, when it has any.
 * @returns column data keyed by column index.
 */
export function columnSnapshots(columns: readonly ColInfo[] | undefined): Record<number, Partial<IColumnData>> {
  const out: Record<number, Partial<IColumnData>> = {}
  columns?.forEach((info, index) => {
    const width = info.wpx ?? (info.width === undefined ? undefined : Math.round(info.width * CHARACTER_WIDTH))
    out[index] = { ...width === undefined ? {} : { w: width }, ...info.hidden === true ? { hd: BooleanNumber.TRUE } : {} }
  })
  return out
}

/**
 * Row heights and hidden rows, sparse by index.
 * @param rows - the sheet's `!rows` entries, when it has any.
 * @returns row data keyed by row index.
 */
export function rowSnapshots(rows: readonly RowInfo[] | undefined): Record<number, Partial<IRowData>> {
  const out: Record<number, Partial<IRowData>> = {}
  rows?.forEach((info, index) => {
    const height = info.hpx ?? info.hpt
    out[index] = { ...height === undefined ? {} : { h: Math.round(height) }, ...info.hidden === true ? { hd: BooleanNumber.TRUE } : {} }
  })
  return out
}

/** The sheet's extent: its recorded range when it has one, else the cells written, never under the floor. */
function dimensions(sheet: WorkSheet, cellData: Record<number, Record<number, ICellData>>): { rowCount: number; columnCount: number } {
  const ref = sheet['!ref']
  if (ref !== undefined) {
    const range = utils.decode_range(ref)
    return { rowCount: Math.max(range.e.r + 1, SHEET_FLOOR.rows), columnCount: Math.max(range.e.c + 1, SHEET_FLOOR.columns) }
  }
  let rows = 0
  let columns = 0
  for (const [r, row] of Object.entries(cellData)) {
    rows = Math.max(rows, Number(r) + 1)
    for (const c of Object.keys(row)) columns = Math.max(columns, Number(c) + 1)
  }
  return { rowCount: Math.max(rows, SHEET_FLOOR.rows), columnCount: Math.max(columns, SHEET_FLOOR.columns) }
}
