// @vitest-environment jsdom
/** Workbook parsing, worksheet tabs, display limits, and failure states. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { read, utils, write } from 'xlsx'
import { SheetBody, SHEET_DISPLAY_LIMITS, sheetGrid } from '../src/client/office/SheetBody.tsx'
import { en } from '../src/client/locales.ts'
import { bodyProps, workbookBytes } from './support.client.ts'

afterEach(cleanup)


describe('SheetBody', () => {
  it('renders the first worksheet as a table and switches sheets through the tab list', () => {
    const data = workbookBytes({ Totals: [['Name', 'Total'], ['Ada', 42]], Notes: [['Remark'], ['second sheet']] })
    render(<SheetBody {...bodyProps('report.xlsx', data)} />)
    expect(screen.getByRole('table', { name: 'Totals' }).textContent).toContain('Ada')
    expect(screen.getByRole('table', { name: 'Totals' }).textContent).toContain('42')
    const tabs = screen.getByRole('tablist', { name: en['sheet.tabs'] })
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    expect(tabs.querySelector('[aria-selected="true"]')?.textContent).toBe('Notes')
    expect(screen.getByRole('table', { name: 'Notes' }).textContent).toContain('second sheet')
  })

  it('shows one sheet without a tab list and names an empty sheet', () => {
    render(<SheetBody {...bodyProps('one.xlsx', workbookBytes({ Only: [['x']] }))} />)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByRole('table', { name: 'Only' }).textContent).toBe('x')
    cleanup()
    render(<SheetBody {...bodyProps('empty.xlsx', workbookBytes({ Blank: [] }))} />)
    expect(screen.getByText(en['sheet.empty'])).toBeTruthy()
  })

  it('bounds the grid and says so', () => {
    const rows = Array.from({ length: SHEET_DISPLAY_LIMITS.rows + 1 }, (_, index) => [index])
    const workbook = read(workbookBytes({ Big: rows }), { type: 'array' })
    const grid = sheetGrid(workbook, 'Big')
    expect(grid.rows).toHaveLength(SHEET_DISPLAY_LIMITS.rows)
    expect(grid.truncated).toBe(true)
    expect(sheetGrid(workbook, 'Missing')).toEqual({ rows: [], truncated: false })
    render(<SheetBody {...bodyProps('big.xlsx', workbookBytes({ Big: rows }))} />)
    expect(screen.getByRole('status').textContent)
      .toBe(`Showing the first ${SHEET_DISPLAY_LIMITS.rows} rows and ${SHEET_DISPLAY_LIMITS.columns} columns.`)
  })

  it('renders dates as ISO text', () => {
    const workbook = utils.book_new()
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([[new Date(Date.UTC(2026, 8, 11))]]), 'Dates')
    const bytes = new Uint8Array(write(workbook, { type: 'array', bookType: 'xlsx', cellDates: true }) as ArrayBuffer)
    const grid = sheetGrid(read(bytes, { type: 'array', cellDates: true }), 'Dates')
    // Excel serial dates round-trip to the millisecond, not exactly.
    expect(grid.rows[0]?.[0]).toMatch(/^2026-09-1[01]T\d{2}:\d{2}:\d{2}/)
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
