/**
 * The pager's arithmetic: how many pages a total spans, and which of them a
 * seven-slot pager names as a member moves from one end to the other.
 */
import { describe, expect, it } from 'vitest'
import { pageCount, pageItems, type PageItem } from '../src/client/paging.ts'

/** The slots as a reader sees them: numbers, and an ellipsis for a gap. */
function drawn(items: readonly PageItem[]): string {
  return items.map(item => item.kind === 'page' ? String(item.page) : '…').join(' ')
}

describe('how many pages a total spans', () => {
  it.each([
    [46, 20, 3],
    [40, 20, 2],
    [1, 20, 1],
    // An empty list still has the page it is on.
    [0, 20, 1],
  ])('%i documents at %i a page make %i pages', (total, size, pages) => {
    expect(pageCount(total, size)).toBe(pages)
  })
})

describe('which pages the pager names', () => {
  it('names every page when seven or fewer fit', () => {
    expect(drawn(pageItems(1, 3))).toBe('1 2 3')
    expect(drawn(pageItems(4, 7))).toBe('1 2 3 4 5 6 7')
  })

  it.each([
    // Near the start the window reaches the first page instead of a one-page gap.
    [1, '1 2 3 4 5 … 20'],
    [4, '1 2 3 4 5 … 20'],
    // In the middle it keeps the current page with its neighbours.
    [5, '1 … 4 5 6 … 20'],
    [16, '1 … 15 16 17 … 20'],
    // Near the end it slides to the last page.
    [17, '1 … 16 17 18 19 20'],
    [20, '1 … 16 17 18 19 20'],
  ])('on page %i of twenty draws %s', (current, expected) => {
    expect(drawn(pageItems(current, 20))).toBe(expected)
  })

  it('keeps the two gaps apart, so each can be keyed on its own', () => {
    const gaps = pageItems(10, 20).filter(item => item.kind === 'gap')
    expect(gaps).toEqual([{ kind: 'gap', key: 'before' }, { kind: 'gap', key: 'after' }])
  })
})
