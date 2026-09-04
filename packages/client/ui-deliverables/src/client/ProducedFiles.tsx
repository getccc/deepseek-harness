import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { basename, documentKind, extensionOf, type DocumentKind } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

/** At most six chips compete for the one-line summary; every other path stays counted. */
const SHOWN_LIMIT = 6

/**
 * Select the largest prefix whose measured chips and exact remainder fit.
 * @param available - usable width of the one-line file lane.
 * @param gap - computed flex gap between adjacent visible items.
 * @param chipWidths - measured widths for the candidate file chips.
 * @param moreWidthsByShown - exact localized remainder width for each shown count.
 * @returns Number of leading chips to render.
 */
export function fitProducedFiles(
  available: number,
  gap: number,
  chipWidths: readonly number[],
  moreWidthsByShown: readonly (number | undefined)[],
): number {
  if (available <= 0) return chipWidths.length
  const prefix = [0]
  let prefixWidth = 0
  for (const width of chipWidths) {
    prefixWidth += width
    prefix.push(prefixWidth)
  }
  let largestFit = 0
  for (const [shown, width] of prefix.entries()) {
    const more = moreWidthsByShown[shown]
    const items = shown + (more === undefined ? 0 : 1)
    const needed = width + (more ?? 0) + Math.max(0, items - 1) * gap
    if (needed <= available) largestFit = shown
  }
  return largestFit
}

/** Registration-side Host capability facts. */
export interface ProducedFilesInjected {
  /** Whether the browser itself is connected over loopback. */
  isLoopback: boolean
  /** Load the opener capability when this row first reaches the page. */
  ensureWorkspacePathOpen(): void
  hooks: {
    /** Current generation's Session workspace opener capability. */
    workspacePathOpen: HostObservable<boolean | undefined>
  }
}

/** Matched paths plus the opener, locale, and injected Host capability. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: readonly string[]
} & PropsLocale<typeof NS> & InjectFace<ProducedFilesInjected>

function moreLabel(t: ProducedFilesProps['t'], count: number): string {
  return count === 1 ? t('produced.moreOne') : t('produced.more', { count: String(count) })
}

/** The card tile class for each document family. */
const TILE_CLASS: Record<DocumentKind, string | undefined> = {
  text: css.tileText,
  word: css.tileWord,
  sheet: css.tileSheet,
  slides: css.tileSlides,
  pdf: css.tilePdf,
}

/**
 * Render one turn's produced files: a card per document the turn handed
 * back, then the remaining files as measured chips.
 * @param props - selector-matched paths, the chat view's file opener, and the locale seat.
 * @returns The produced-files row.
 */
export function ProducedFiles({
  matched, openFile, isLoopback, ensureWorkspacePathOpen, useWorkspacePathOpen, t,
}: ProducedFilesProps) {
  const documents = matched.filter(path => documentKind(path) !== undefined)
  const paths = matched.filter(path => documentKind(path) === undefined)
  // The opener capability is asked for only once chips are on screen: the
  // folder action belongs to the lane, and a cards-only row never shows it.
  useEffect(() => { if (paths.length > 0) ensureWorkspacePathOpen() }, [ensureWorkspacePathOpen, paths.length])
  const hostCanOpenPath = useWorkspacePathOpen(available => available === true)
  return (
    <div className={css.root}>
      {documents.length > 0 && (
        <div className={css.cards} data-produced-documents>
          {documents.map(path => (
            <button
              key={path}
              type="button"
              className={css.card}
              title={path}
              aria-label={t('produced.open', { name: path })}
              onClick={() => { openFile(path) }}
            >
              <span className={`${css.tile} ${TILE_CLASS[documentKind(path) as DocumentKind]}`} aria-hidden="true">
                {extensionOf(path).toUpperCase()}
              </span>
              <span className={css.cardText}>
                <span className={css.cardName}>{basename(path)}</span>
                <span className={css.cardPath}>{path}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {paths.length > 0 && (
        <ProducedChips paths={paths} openFile={openFile} canOpenPath={isLoopback && hostCanOpenPath} t={t} />
      )}
    </div>
  )
}

/** The measured one-line chip lane for the turn's non-document files. */
function ProducedChips({ paths, openFile, canOpenPath, t }: {
  paths: readonly string[]
  openFile: ProducedFilesProps['openFile']
  canOpenPath: boolean
  t: ProducedFilesProps['t']
}) {
  const limit = Math.min(paths.length, SHOWN_LIMIT)
  const [shownCount, setShownCount] = useState(limit)
  const rowRef = useRef<HTMLDivElement>(null)
  const chipProbes = useRef<Array<HTMLButtonElement | null>>([])
  const moreProbe = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const row = rowRef.current
    const remainderProbe = moreProbe.current
    /* v8 ignore next -- React attaches both refs before the layout effect runs. */
    if (row === null || remainderProbe === null) return
    const measure = (): void => {
      const styles = getComputedStyle(row)
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0
      // React attaches every still-mounted callback ref before layout effects run.
      const activeChipProbes = chipProbes.current.slice(0, limit) as HTMLButtonElement[]
      const chips = activeChipProbes.map(probe => probe.getBoundingClientRect().width)
      const more = Array.from({ length: limit + 1 }, (_, candidate) => {
        if (paths.length === candidate) return undefined
        remainderProbe.textContent = moreLabel(t, paths.length - candidate)
        return remainderProbe.getBoundingClientRect().width
      })
      setShownCount(fitProducedFiles(row.clientWidth, gap, chips, more))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    for (const probe of [...chipProbes.current, moreProbe.current]) {
      if (probe !== null) observer.observe(probe)
    }
    return () => { observer.disconnect() }
  }, [limit, paths, t])

  const visibleCount = Math.min(shownCount, limit)
  const shown = paths.slice(0, visibleCount)
  const hidden = paths.length - shown.length
  return (
    <div className={css.lane}>
      <span className={css.label}>{t('produced.label')}</span>
      <div ref={rowRef} className={css.row} data-produced-files-row>
        {shown.map(path => (
          <button
            key={path}
            type="button"
            className={css.file}
            // The full path is the disambiguator when two turns produce files
            // that share a basename; the chip itself stays short.
            title={path}
            aria-label={t('produced.open', { name: path })}
            onClick={() => { openFile(path) }}
          >
            {basename(path)}
          </button>
        ))}
        {hidden > 0 && <span className={css.more}>{moreLabel(t, hidden)}</span>}
      </div>
      {hidden > 0 && canOpenPath && (
        <button type="button" className={css.showFolder} onClick={() => { openFile('.') }}>
          {t('produced.showInFolder')}
        </button>
      )}
      <div className={css.measure} aria-hidden="true">
        {paths.slice(0, limit).map((path, index) => (
          <button
            key={path}
            ref={(node) => { chipProbes.current[index] = node }}
            type="button"
            tabIndex={-1}
            className={`${css.file} ${css.probe}`}
          >
            {basename(path)}
          </button>
        ))}
        <span ref={moreProbe} className={`${css.more} ${css.probe}`} />
      </div>
    </div>
  )
}
