/** The workbook snapshot Univer opens: sheets, cells, merges, sizes, hidden rows and columns, and the extent floor. */
import { describe, expect, it } from 'vitest'
import { BooleanNumber, CellValueType, LocaleType } from '@univerjs/core'
import { utils, type WorkSheet } from 'xlsx'
import { SHEET_FLOOR, cellSnapshot, columnSnapshots, rowSnapshots, workbookSnapshot } from '../src/client/office/xlsx-to-univer.ts'

describe('workbookSnapshot', () => {
  it('folds every sheet in order with its cells, merges, and sizes', () => {
    const workbook = utils.book_new()
    const first = utils.aoa_to_sheet([['Title', ''], [1.5, true]])
    first['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
    first['!cols'] = [{ wpx: 120 }, { width: 10 }, {}]
    first['!rows'] = [{ hpx: 30 }, { hpt: 14.6, hidden: true }]
    utils.book_append_sheet(workbook, first, 'First')
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([['second']]), 'Second')
    workbook.Props = { Title: 'Report' }
    const snapshot = workbookSnapshot(workbook, LocaleType.ZH_CN)
    expect(snapshot).toMatchObject({ id: 'workbook', name: 'Report', locale: LocaleType.ZH_CN, sheetOrder: ['sheet-0', 'sheet-1'] })
    const sheet = snapshot.sheets['sheet-0']
    expect(sheet).toMatchObject({
      id: 'sheet-0', name: 'First', hidden: BooleanNumber.FALSE, showGridlines: BooleanNumber.TRUE,
      rowCount: SHEET_FLOOR.rows, columnCount: SHEET_FLOOR.columns,
      mergeData: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }],
      columnData: { 0: { w: 120 }, 1: { w: 70 }, 2: {} },
      rowData: { 0: { h: 30 }, 1: { h: 15, hd: BooleanNumber.TRUE } },
    })
    expect(sheet?.cellData?.[0]?.[0]).toEqual({ t: CellValueType.STRING, v: 'Title' })
    expect(sheet?.cellData?.[1]?.[0]).toEqual({ t: CellValueType.NUMBER, v: 1.5 })
    expect(sheet?.cellData?.[1]?.[1]).toEqual({ t: CellValueType.BOOLEAN, v: true })
    expect(snapshot.sheets['sheet-1']).toMatchObject({ name: 'Second', cellData: { 0: { 0: { t: CellValueType.STRING, v: 'second' } } } })
  })

  it('opens one empty sheet for a workbook without any, and an unnamed workbook', () => {
    const snapshot = workbookSnapshot(utils.book_new(), LocaleType.EN_US)
    expect(snapshot.name).toBe('Workbook')
    expect(snapshot.sheetOrder).toEqual(['sheet-0'])
    expect(snapshot.sheets['sheet-0']).toEqual({ id: 'sheet-0', name: 'Sheet1', rowCount: SHEET_FLOOR.rows, columnCount: SHEET_FLOOR.columns })
  })

  it('sizes a sheet by its recorded range, else by the cells it holds, never under the floor', () => {
    const workbook = utils.book_new()
    const ranged = utils.aoa_to_sheet([[1]])
    ranged['!ref'] = 'A1:Z30'
    utils.book_append_sheet(workbook, ranged, 'Ranged')
    const unranged: WorkSheet = { B25: { t: 's', v: 'x' }, AA2: { t: 's', v: 'y' } }
    utils.book_append_sheet(workbook, unranged, 'Unranged')
    delete unranged['!ref']
    workbook.SheetNames.push('Missing')
    const { sheets } = workbookSnapshot(workbook, LocaleType.EN_US)
    expect(sheets['sheet-0']).toMatchObject({ rowCount: 30, columnCount: 26 })
    expect(sheets['sheet-1']).toMatchObject({ rowCount: 25, columnCount: 27 })
    expect(sheets['sheet-2']).toMatchObject({ name: 'Missing', rowCount: SHEET_FLOOR.rows, columnCount: SHEET_FLOOR.columns, cellData: {} })
  })
})

describe('cellSnapshot', () => {
  it('types each SheetJS cell and keeps formatted text and formulas', () => {
    expect(cellSnapshot({ t: 'b', v: false })).toEqual({ t: CellValueType.BOOLEAN, v: false })
    expect(cellSnapshot({ t: 'n', v: 2, f: 'A1*2' })).toEqual({ t: CellValueType.NUMBER, v: 2, f: 'A1*2' })
    expect(cellSnapshot({ t: 'n', v: 3, f: '' })).toEqual({ t: CellValueType.NUMBER, v: 3 })
    expect(cellSnapshot({ t: 'e', v: 7, w: '#DIV/0!' })).toEqual({ t: CellValueType.FORCE_STRING, v: '#DIV/0!' })
    expect(cellSnapshot({ t: 'e', v: 7 })).toEqual({ t: CellValueType.FORCE_STRING, v: '7' })
    expect(cellSnapshot({ t: 'e' })).toEqual({ t: CellValueType.FORCE_STRING, v: '' })
    expect(cellSnapshot({ t: 's', v: 'plain', w: 'shown' })).toEqual({ t: CellValueType.STRING, v: 'shown' })
    const date = cellSnapshot({ t: 'd', v: new Date(0) })
    expect(date.t).toBe(CellValueType.STRING)
    expect(String(date.v)).toContain('1970')
    expect(cellSnapshot({ t: 'z' })).toEqual({ t: CellValueType.STRING, v: '' })
  })
})

describe('column and row snapshots', () => {
  it('reads widths in px before characters, heights in px before points, and hidden flags', () => {
    expect(columnSnapshots(undefined)).toEqual({})
    expect(columnSnapshots([{ wpx: 40, width: 100 }, { width: 8 }, { hidden: true }]))
      .toEqual({ 0: { w: 40 }, 1: { w: 56 }, 2: { hd: BooleanNumber.TRUE } })
    expect(rowSnapshots(undefined)).toEqual({})
    expect(rowSnapshots([{ hpx: 18.4, hpt: 40 }, { hpt: 12.75 }, { hidden: true }, {}]))
      .toEqual({ 0: { h: 18 }, 1: { h: 13 }, 2: { hd: BooleanNumber.TRUE }, 3: {} })
  })
})
