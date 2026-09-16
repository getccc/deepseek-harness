/**
 * Which page controls a document list offers, as pure arithmetic over one
 * listing answer.
 *
 * A listing reports its total only sometimes, so there are two readings. With
 * a total the pager can name every page and how far the list goes; without one
 * it can name only the page it is on, and "there is another" is read from a
 * full page — the one case where "there may be more" is the honest answer.
 * @module @deepseek-ai/dsh-client-ui-knowledge-panels/paging
 */

/** One slot in the pager: a page to go to, or a run of pages left out. */
export type PageItem =
  | { readonly kind: 'page'; readonly page: number }
  | { readonly kind: 'gap'; readonly key: 'before' | 'after' }

/**
 * How many pages a total spans.
 * @param total - how many documents the listing holds.
 * @param pageSize - how many one page holds; the listing's own answer, at least one.
 * @returns the page count, at least one so an empty list still has the page it is on.
 */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

/**
 * The pages to name, with the runs between them folded.
 *
 * Seven slots at most, so the pager keeps one width while a member moves
 * through it: the first and last page always, the current one with its
 * neighbours, and a gap for whatever lies between. Near either end the window
 * slides to that end instead of opening a gap one page wide.
 * @param current - the page the listing answered, counting from one.
 * @param count - how many pages there are.
 * @returns the slots, in the order they are drawn.
 */
export function pageItems(current: number, count: number): readonly PageItem[] {
  const pages = (from: number, to: number): PageItem[] =>
    Array.from({ length: to - from + 1 }, (_, index) => ({ kind: 'page', page: from + index }))
  if (count <= 7) return pages(1, count)
  if (current <= 4) return [...pages(1, 5), { kind: 'gap', key: 'after' }, ...pages(count, count)]
  if (current >= count - 3) return [...pages(1, 1), { kind: 'gap', key: 'before' }, ...pages(count - 4, count)]
  return [
    ...pages(1, 1),
    { kind: 'gap', key: 'before' },
    ...pages(current - 1, current + 1),
    { kind: 'gap', key: 'after' },
    ...pages(count, count),
  ]
}
