/** The document list's pager: the total, the previous and next controls, and the pages between them. */

import clsx from 'clsx'
import { IconChevronLeftOutline14, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from './locales.ts'
import { pageCount, pageItems, type PageItem } from './paging.ts'
import css from './panels.module.css'

/** What the pager needs from one listing answer. */
export interface PagerProps {
  /** The page the listing answered, counting from one. */
  readonly page: number
  /** How many documents one page holds, as the listing answered it. */
  readonly pageSize: number
  /** How many documents the listing holds, when the source reports it. */
  readonly total: number | undefined
  /** How many documents this page actually carries. */
  readonly shown: number
  /** Ask for another page. */
  readonly go: (page: number) => void
  /** The panel's bound translate. */
  readonly t: Translate
}

/**
 * Draw the pager for one listing answer.
 *
 * With a total it names every page it can fit and stops at the last one;
 * without one it names only the current page and offers the next while the
 * page is full, because that is all the answer says about how far the list
 * goes.
 * @param props - the listing facts, the navigation callback, and the locale seat.
 * @returns the pager element tree.
 */
export function Pager({ page, pageSize, total, shown, go, t }: PagerProps) {
  const count = total === undefined ? undefined : pageCount(total, pageSize)
  const items: readonly PageItem[] = count === undefined ? [{ kind: 'page', page }] : pageItems(page, count)
  const more = count === undefined ? shown === pageSize : page < count

  return (
    <nav className={css.pager} aria-label={t('docs.pager')}>
      {total !== undefined && <span className={css.pagerTotal}>{t('docs.count', { total })}</span>}
      <button
        type="button"
        className={css.pagerStep}
        aria-label={t('docs.prev')}
        disabled={page <= 1}
        onClick={() => { go(page - 1) }}
      >
        <IconChevronLeftOutline14 size={14} />
      </button>
      {items.map(item => item.kind === 'gap'
        ? <span key={item.key} className={css.pagerGap} aria-hidden="true">…</span>
        : (
          <button
            key={item.page}
            type="button"
            className={clsx(css.pagerPage, item.page === page && css.pagerPageOn)}
            aria-label={t('docs.page', { page: item.page })}
            aria-current={item.page === page ? 'page' : undefined}
            onClick={() => { if (item.page !== page) go(item.page) }}
          >
            {item.page}
          </button>
        ))}
      <button
        type="button"
        className={css.pagerStep}
        aria-label={t('docs.next')}
        disabled={!more}
        onClick={() => { go(page + 1) }}
      >
        <IconChevronRightOutline14 size={14} />
      </button>
    </nav>
  )
}
