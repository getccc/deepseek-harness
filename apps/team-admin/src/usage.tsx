/**
 * What the Token monitoring page and the home overview share: time-range
 * arithmetic in the reader's local calendar, the report fetch, and the trend
 * chart.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Empty, theme } from 'antd'
import { api, type UsageRange, type WireUsageReport } from './api.ts'
import { useLocale } from './locale.tsx'
import { useErrorReporter } from './ui.tsx'

/** A time range in epoch milliseconds, `to` excluded. */
export interface Span {
  readonly from: number
  readonly to: number
}

export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS

/** Local midnight at the start of the day containing a moment. */
export function startOfDay(at: number): number {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/** The local midnight a whole number of days from a local midnight, across clock changes. */
export function addDays(midnight: number, days: number): number {
  const day = new Date(midnight)
  day.setDate(day.getDate() + days)
  return day.getTime()
}

/**
 * The range of whole local days ending with the one containing a moment.
 * @param days - how many days, counting the one containing `now`.
 * @param now - the moment, in epoch milliseconds.
 * @returns the range, from the first day's midnight to the midnight after `now`'s day.
 */
export function daysSpan(days: number, now: number): Span {
  const today = startOfDay(now)
  return { from: addDays(today, 1 - days), to: addDays(today, 1) }
}

/** The reader's offset from UTC in minutes, which the Control Plane buckets time by. */
export function localOffsetMinutes(): number {
  return -new Date().getTimezoneOffset()
}

export const pad = (value: number): string => String(value).padStart(2, '0')

/** A bucket's start as a local date, with the hour when buckets are shorter than a day. */
function bucketStart(start: number, bucketMs: number): string {
  const day = new Date(start)
  const date = `${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
  return bucketMs < DAY_MS ? `${date} ${pad(day.getHours())}:00` : date
}

/** The name a member row or call shows, whether or not the account still exists. */
export function memberName(
  member: { readonly memberId: string; readonly displayName?: string },
  deleted: (id: string) => string,
): string {
  return member.displayName ?? deleted(member.memberId.slice(0, 8))
}

/** The query a read carries: the range, the reader's clock, and the member if one is chosen. */
export function rangeOf(span: Span, member: string | undefined): UsageRange {
  return { ...span, utcOffsetMinutes: localOffsetMinutes(), ...(member === undefined ? {} : { member }) }
}

/**
 * Fetch the report for a range and member whenever either changes.
 * @param span - the range to report on.
 * @param member - the account the series is narrowed to, if any.
 * @param refresh - a counter an administrator bumps to ask again.
 * @returns the latest report, kept on screen while the next loads, and whether one is loading.
 */
export function useReport(
  span: Span,
  member: string | undefined,
  refresh: number,
): { readonly data: WireUsageReport | undefined; readonly loading: boolean } {
  const report = useErrorReporter()
  const [data, setData] = useState<WireUsageReport | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let current = true
    setLoading(true)
    api.usage(rangeOf(span, member)).then(
      (value) => {
        if (!current) return
        setData(value)
        setLoading(false)
      },
      (error: unknown) => {
        if (!current) return
        setLoading(false)
        report(error)
      },
    )
    return () => { current = false }
    // The reporter is rebuilt with the language; what a read depends on is the
    // range, the member, and the refresh counter.
  }, [span.from, span.to, member, refresh])
  return { data, loading }
}

/** Height of the chart's plotting area in pixels. */
const PLOT_HEIGHT = 320

/** Width reserved for the value axis in pixels. */
const Y_AXIS_WIDTH = 56

/** How many intervals the value axis is cut into. */
const Y_INTERVALS = 4

/** Room, in pixels, a time-axis name needs: `MM-DD` and `HH:00` at the axis font. */
const AXIS_LABEL_WIDTH = 38

/** The narrowest bar pitch, in pixels, at which each bar can carry its own value. */
const VALUE_LABEL_PITCH = 42

/**
 * The step between value-axis ticks: 1, 2, or 5 times a power of ten, and at
 * least 1 so every tick is a whole number of tokens.
 * @param peak - the largest bar, in tokens.
 * @returns the tick step.
 */
function tickStep(peak: number): number {
  const raw = peak / Y_INTERVALS
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / power
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10
  return Math.max(1, nice * power)
}

/**
 * The width of one element, kept current as it is resized.
 * @returns a ref for the element and its content width in pixels.
 */
function useElementWidth(): readonly [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return undefined
    setWidth(element.clientWidth)
    const observer = new ResizeObserver((entries) => { setWidth(entries[0]?.contentRect.width ?? 0) })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])
  return [ref, width]
}

/**
 * The spending of one range as bars, one per bucket, with empty buckets drawn.
 *
 * The value axis is cut into whole-number ticks with grid lines, every bar is
 * named on the time axis (thinned only when the bars are too narrow for their
 * names), bars wide enough carry their own value, and hovering a bar opens its
 * full breakdown at once.
 * @param props.report - the report whose series is drawn.
 * @param props.height - the height of the plotting area in pixels.
 * @returns the chart, or the sentence that says there is nothing to draw.
 */
export function UsageChart({ report, height = PLOT_HEIGHT }: {
  readonly report: WireUsageReport
  /** Height of the plotting area in pixels. */
  readonly height?: number
}): ReactNode {
  const { t, locale } = useLocale()
  const { token } = theme.useToken()
  const [ref, width] = useElementWidth()
  const [hovered, setHovered] = useState<number | undefined>(undefined)
  const compact = useMemo(() => new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    notation: 'compact', maximumFractionDigits: 1,
  }), [locale])

  const hourly = report.bucketMs < DAY_MS
  const offsetMs = localOffsetMinutes() * 60_000
  const first = Math.floor((report.from + offsetMs) / report.bucketMs) * report.bucketMs - offsetMs
  const starts: number[] = []
  for (let at = first; at < report.to; at += report.bucketMs) starts.push(at)
  const byStart = new Map(report.series.map(bucket => [bucket.start, bucket] as const))
  const peak = Math.max(1, ...report.series.map(bucket => bucket.chargedTokens))
  const step = tickStep(peak)
  const top = step * Math.ceil(peak / step)
  const ticks = Array.from({ length: top / step + 1 }, (_unused, index) => index * step)

  const pitch = Math.max(width - Y_AXIS_WIDTH, 0) / starts.length
  const labelEvery = pitch === 0 ? 1 : Math.max(1, Math.ceil(AXIS_LABEL_WIDTH / pitch))
  const showValues = pitch >= VALUE_LABEL_PITCH

  /** The text under a bar: the hour, with the date where a day starts; or the date. */
  const axisLabel = (start: number, index: number): ReactNode => {
    const day = new Date(start)
    const date = `${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
    if (!hourly) return date
    return (
      <>
        <span>{`${pad(day.getHours())}:00`}</span>
        {(day.getHours() === 0 || index === 0) && <span className="usage-xdate">{date}</span>}
      </>
    )
  }

  /** The tooltip's heading: the day, or the hour with its end. */
  const heading = (start: number): string => {
    const end = new Date(start + report.bucketMs)
    return hourly
      ? `${bucketStart(start, report.bucketMs)} – ${pad(end.getHours())}:00`
      : bucketStart(start, report.bucketMs)
  }

  const open = hovered === undefined ? undefined : starts[hovered]
  const openBucket = open === undefined ? undefined : byStart.get(open)

  return (
    <div ref={ref} className="usage-chart">
      {report.series.length === 0
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('usage.chartEmpty')} />
        : (
          <>
            <div className="usage-chart-body">
              <div className="usage-yaxis" style={{ width: Y_AXIS_WIDTH, height, color: token.colorTextSecondary }}>
                {ticks.map(tick => (
                  <span key={tick} style={{ bottom: `${String((tick / top) * 100)}%` }}>{compact.format(tick)}</span>
                ))}
              </div>
              <div className="usage-plot" style={{ height }}>
                {ticks.map(tick => (
                  <div
                    key={tick}
                    className="usage-grid"
                    style={{ bottom: `${String((tick / top) * 100)}%`, borderColor: token.colorBorderSecondary }}
                  />
                ))}
                <div className="usage-bars">
                  {starts.map((start, index) => {
                    const bucket = byStart.get(start)
                    const percent = bucket === undefined ? 0 : Math.max((bucket.chargedTokens / top) * 100, 0.6)
                    return (
                      <div
                        key={start}
                        className="usage-col"
                        style={hovered === index ? { background: token.colorFillTertiary } : undefined}
                        onMouseEnter={() => { setHovered(index) }}
                        onMouseLeave={() => { setHovered(undefined) }}
                      >
                        {showValues && bucket !== undefined && (
                          <span className="usage-bar-value" style={{ bottom: `calc(${String(percent)}% + 3px)`, color: token.colorTextSecondary }}>
                            {compact.format(bucket.chargedTokens)}
                          </span>
                        )}
                        <div
                          className="usage-bar-fill"
                          style={{
                            height: `${String(percent)}%`,
                            background: hovered === index ? token.colorPrimaryActive : token.colorPrimary,
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
                {hovered !== undefined && open !== undefined && (
                  <div
                    className="usage-tooltip"
                    style={{
                      left: `${String(((hovered + 0.5) / starts.length) * 100)}%`,
                      transform: hovered > starts.length / 2 ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)',
                      background: token.colorBgElevated,
                      boxShadow: token.boxShadowSecondary,
                      color: token.colorText,
                    }}
                  >
                    <strong>{heading(open)}</strong>
                    {openBucket === undefined
                      ? <div style={{ color: token.colorTextSecondary }}>{t('usage.noCall')}</div>
                      : (
                        <>
                          <div>{t('usage.total')}: <strong>{openBucket.chargedTokens.toLocaleString()}</strong></div>
                          <div>{t('usage.input')}: {openBucket.inputTokens.toLocaleString()}</div>
                          <div>{t('usage.output')}: {openBucket.outputTokens.toLocaleString()}</div>
                          <div>{t('usage.calls')}: {openBucket.calls.toLocaleString()}</div>
                        </>
                      )}
                  </div>
                )}
              </div>
            </div>
            <div className="usage-xaxis" style={{ marginLeft: Y_AXIS_WIDTH, color: token.colorTextSecondary }}>
              {starts.map((start, index) => (
                <div key={start} className="usage-xlabel">
                  {index % labelEvery === 0 && axisLabel(start, index)}
                </div>
              ))}
            </div>
          </>
        )}
    </div>
  )
}
