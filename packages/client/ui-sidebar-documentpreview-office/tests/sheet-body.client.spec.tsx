// @vitest-environment jsdom
/** Workbook parsing, the spreadsheet grid, worksheet tabs, display limits, and failure states. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { read, utils, write, type WorkBook, type WorkSheet } from 'xlsx'
import { DEFAULT_COLUMN_WIDTH, SheetBody, SHEET_DISPLAY_LIMITS, columnWidth, sheetGrid } from '../src/client/office/SheetBody.tsx'
import { en } from '../src/client/locales.ts'
import { bodyProps, workbookBytes } from './support.client.ts'

afterEach(cleanup)

/** A workbook holding one prepared worksheet. */
function workbookOf(name: string, sheet: WorkSheet): WorkBook {
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, sheet, name)
  return workbook
}

/** A sheet with a merged title row, a column at each width form, a hidden column, and typed cells. */
function styledSheet(): WorkSheet {
  const sheet = utils.aoa_to_sheet([
    ['Title', '', 'hidden'],
    [1234.5, 'b', 'hidden'],
    [true, new Date(Date.UTC(2026, 8, 11, 12)), 'hidden'],
  ])
  sheet['!cols'] = [{ wpx: 120 }, { wch: 20 }, { hidden: true }]
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
  return sheet
}

describe('sheetGrid', () => {
  it('draws Excel\'s letters, widths, merges, and typed cells, and drops hidden columns', () => {
    const grid = sheetGrid(workbookOf('Grid', styledSheet()), 'Grid')
    expect(grid.columns).toEqual([{ label: 'A', width: 120 }, { label: 'B', width: 145 }])
    expect(grid.truncated).toBe(false)
    expect(grid.rows.map(row => row.number)).toEqual([1, 2, 3])
    expect(grid.rows[0]?.cells).toEqual([{ text: 'Title', numeric: false, rowSpan: 1, colSpan: 2 }, null])
    expect(grid.rows[1]?.cells).toEqual([
      { text: '1234.5', numeric: true, rowSpan: 1, colSpan: 1 },
      { text: 'b', numeric: false, rowSpan: 1, colSpan: 1 },
    ])
    expect(grid.rows[2]?.cells[0]).toEqual({ text: 'TRUE', numeric: false, rowSpan: 1, colSpan: 1 })
    expect(grid.rows[2]?.cells[1]).toMatchObject({ text: '9/11/26', numeric: true })
  })

  it('prefers the formatted text, falls back to the value, and reads unset widths as the default', () => {
    const sheet: WorkSheet = {
      '!ref': 'A1:C2',
      A1: { t: 'n', v: 1234.5, w: '1,234.50' },
      B1: { t: 'd', v: new Date(Date.UTC(2026, 8, 11)) },
      C1: { t: 'b', v: false },
      A2: { t: 's', v: 'last' },
      B2: { t: 'z' },
    }
    const grid = sheetGrid(workbookOf('Text', sheet), 'Text')
    expect(grid.columns.map(column => column.width)).toEqual([DEFAULT_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH])
    expect(grid.rows[0]?.cells.map(cell => cell?.text)).toEqual(['1,234.50', '2026-09-11T00:00:00.000Z', 'FALSE'])
    expect(grid.rows[0]?.cells.map(cell => cell?.numeric)).toEqual([true, true, false])
    expect(grid.rows[1]?.cells.map(cell => cell?.text)).toEqual(['last', '', ''])
    expect(columnWidth(undefined)).toBe(DEFAULT_COLUMN_WIDTH)
    expect(columnWidth({ wpx: 30, wch: 10 })).toBe(30)
    expect(columnWidth({ wch: 10 })).toBe(75)
  })

  it('has no rows for a sheet without cells, a sheet without a range, or a missing sheet', () => {
    const workbook = workbookOf('Blank', { '!ref': 'A1:B2' })
    workbook.Sheets['Empty'] = {}
    workbook.SheetNames.push('Empty')
    expect(sheetGrid(workbook, 'Blank')).toEqual({ columns: [{ label: 'A', width: DEFAULT_COLUMN_WIDTH }, { label: 'B', width: DEFAULT_COLUMN_WIDTH }], rows: [], truncated: false })
    expect(sheetGrid(workbook, 'Empty')).toEqual({ columns: [], rows: [], truncated: false })
    expect(sheetGrid(workbook, 'Missing')).toEqual({ columns: [], rows: [], truncated: false })
  })

  it('bounds the grid, clips merges at the bound, and says so', () => {
    const rows = Array.from({ length: SHEET_DISPLAY_LIMITS.rows + 1 }, (_, index) => [index])
    const sheet = utils.aoa_to_sheet(rows)
    sheet['!merges'] = [{ s: { r: SHEET_DISPLAY_LIMITS.rows - 1, c: 0 }, e: { r: SHEET_DISPLAY_LIMITS.rows, c: 0 } }]
    const workbook = workbookOf('Big', sheet)
    const grid = sheetGrid(workbook, 'Big')
    expect(grid.rows).toHaveLength(SHEET_DISPLAY_LIMITS.rows)
    expect(grid.rows.at(-1)?.cells[0]).toMatchObject({ rowSpan: 1, colSpan: 1 })
    expect(grid.truncated).toBe(true)
    render(<SheetBody {...bodyProps('big.xlsx', workbookBytes({ Big: rows }))} />)
    expect(screen.getByRole('status').textContent)
      .toBe(`Showing the first ${SHEET_DISPLAY_LIMITS.rows} rows and ${SHEET_DISPLAY_LIMITS.columns} columns.`)
  })
})

describe('SheetBody', () => {
  it('renders the first worksheet as a grid and switches sheets through the tab list', () => {
    const data = workbookBytes({ Totals: [['Name', 'Total'], ['Ada', 42]], Notes: [['Remark'], ['second sheet']] })
    render(<SheetBody {...bodyProps('report.xlsx', data)} />)
    const totals = screen.getByRole('table', { name: 'Totals' })
    expect(totals.querySelectorAll('[scope="col"]')).toHaveLength(2)
    expect(screen.getByRole('columnheader', { name: 'B' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: '2' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Ada' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '42' }).className).toContain('numeric')
    expect(screen.getByRole('cell', { name: 'Ada' }).className).not.toContain('numeric')
    const tabs = screen.getByRole('tablist', { name: en['sheet.tabs'] })
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    expect(tabs.querySelector('[aria-selected="true"]')?.textContent).toBe('Notes')
    expect(screen.getByRole('table', { name: 'Notes' }).textContent).toContain('second sheet')
  })

  it('carries column widths, hidden columns, and merges through the file', () => {
    const bytes = new Uint8Array(write(workbookOf('Grid', styledSheet()), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    expect(read(bytes, { type: 'array', cellStyles: true }).Sheets['Grid']?.['!cols']?.[2]?.hidden).toBe(true)
    const view = render(<SheetBody {...bodyProps('grid.xlsx', bytes)} />)
    expect(screen.queryByRole('columnheader', { name: 'C' })).toBeNull()
    expect(screen.getByRole('cell', { name: 'Title' }).getAttribute('colspan')).toBe('2')
    const widths = [...view.container.querySelectorAll('colgroup col')].slice(1).map(col => (col as HTMLElement).style.width)
    expect(widths[0]).toBe('120px')
    expect(widths[1]).not.toBe('')
  })

  it('shows one sheet without a tab list and names an empty sheet', () => {
    render(<SheetBody {...bodyProps('one.xlsx', workbookBytes({ Only: [['x']] }))} />)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('table', { name: 'Only' }).querySelectorAll('td')).toHaveLength(1)
    expect(screen.getByRole('cell', { name: 'x' })).toBeTruthy()
    cleanup()
    render(<SheetBody {...bodyProps('empty.xlsx', workbookBytes({ Blank: [] }))} />)
    expect(screen.getByText(en['sheet.empty'])).toBeTruthy()
  })

  it('fails with a retry action on bytes that are not a workbook, and refuses text pages', () => {
    const view = render(<SheetBody {...bodyProps('broken.xlsx', new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9]))} />)
    expect(screen.getByRole('alert').textContent).toContain(en.failed)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(screen.getByRole('alert').textContent).toContain(en.failed)
    view.unmount()
    render(<SheetBody {...bodyProps('pages.xlsx', undefined)} />)
    expect(screen.getByRole('alert').textContent).toBe(en.unsupported)
  })
})
