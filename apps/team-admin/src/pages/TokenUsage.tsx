/**
 * Token monitoring: what each member spent on company models, and when.
 *
 * Everything here is read from the settlement ledger for one time range. The
 * range, and the member the administrator narrowed it to, are the only state;
 * the report and the call list are fetched again whenever either changes.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  App, Button, Card, Col, DatePicker, Input, Progress, Row, Segmented, Statistic, Table, Tag, Tooltip, Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { api, type WireMemberUsage, type WireUsageRecord, type WireUsageRecords } from '../api.ts'
import { useLocale } from '../locale.tsx'
import { PageNote, Toolbar, downloadCsv, useErrorReporter } from '../ui.tsx'
import {
  DAY_MS, UsageChart, addDays, daysSpan, memberName, pad, rangeOf, startOfDay, useReport, type Span,
} from '../usage.tsx'

/** The ranges the toolbar offers without a calendar. */
type Preset = 'today' | 'week' | 'month' | 'custom'

/** The longest custom range, in days; the Control Plane refuses more than 366. */
const MAX_CUSTOM_DAYS = 365

/** How many calls one page of the call list holds. */
const RECORDS_PAGE_SIZE = 20

/** The range a preset stands for at a moment: whole local days ending with today. */
function presetSpan(preset: Exclude<Preset, 'custom'>, now: number): Span {
  return daysSpan({ today: 1, week: 7, month: 30 }[preset], now)
}

/** A moment as local `YYYY-MM-DD HH:mm:ss`. */
function formatMoment(at: number): string {
  const day = new Date(at)
  return `${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())} `
    + `${pad(day.getHours())}:${pad(day.getMinutes())}:${pad(day.getSeconds())}`
}

/**
 * The settled calls of one range, newest first, a page at a time.
 *
 * Keyed by the range and member at its call site, so changing either starts
 * again from the first page.
 * @param props.span - the range to list.
 * @param props.member - the account to narrow to, if any.
 * @param props.refresh - a counter an administrator bumps to ask again.
 * @returns the table.
 */
function UsageRecords({ span, member, refresh }: {
  readonly span: Span
  readonly member: string | undefined
  readonly refresh: number
}): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const [page, setPage] = useState(1)
  const [data, setData] = useState<WireUsageRecords | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let current = true
    setLoading(true)
    api.usageRecords(rangeOf(span, member), RECORDS_PAGE_SIZE, (page - 1) * RECORDS_PAGE_SIZE).then(
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
    // As for the report: the reporter changes with the language, a read does not.
  }, [span.from, span.to, member, page, refresh])

  const deleted = (id: string): string => t('usage.deletedMember', { id })
  const columns: ColumnsType<WireUsageRecord> = [
    {
      title: t('usage.time'),
      key: 'startedAt',
      render: (_value, record) => <span className="moment">{formatMoment(record.startedAt)}</span>,
    },
    { title: t('usage.member'), key: 'member', render: (_value, record) => memberName(record, deleted) },
    {
      title: t('usage.model'),
      key: 'model',
      render: (_value, record) => <Typography.Text code style={{ fontSize: 12 }}>{record.modelRef}</Typography.Text>,
    },
    {
      title: t('usage.input'),
      key: 'input',
      align: 'right',
      render: (_value, record) => record.inputTokens.toLocaleString(),
    },
    {
      title: t('usage.output'),
      key: 'output',
      align: 'right',
      render: (_value, record) => record.outputTokens.toLocaleString(),
    },
    {
      title: t('usage.charged'),
      key: 'charged',
      align: 'right',
      render: (_value, record) => <strong>{record.chargedTokens.toLocaleString()}</strong>,
    },
    {
      title: t('usage.kind'),
      key: 'kind',
      render: (_value, record) => {
        if (record.reconciled) {
          return (
            <Tooltip title={t('usage.kind.reconciledTip')}>
              <Tag color="orange">{t('usage.kind.reconciled')}</Tag>
            </Tooltip>
          )
        }
        if (record.kind === 'estimated') {
          return (
            <Tooltip title={t('usage.kind.estimatedTip')}>
              <Tag color="gold">{t('usage.kind.estimated')}</Tag>
            </Tooltip>
          )
        }
        return t('usage.kind.reported')
      },
    },
  ]

  return (
    <Table<WireUsageRecord>
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={data?.records ?? []}
      loading={loading}
      scroll={{ x: 'max-content' }}
      pagination={{
        current: page,
        pageSize: RECORDS_PAGE_SIZE,
        total: data?.total ?? 0,
        showSizeChanger: false,
        onChange: setPage,
      }}
    />
  )
}

/**
 * The token monitoring page.
 * @returns the monitoring view.
 */
export function TokenUsage(): ReactNode {
  const { t } = useLocale()
  const { message } = App.useApp()
  const [preset, setPreset] = useState<Preset>('week')
  const [span, setSpan] = useState<Span>(() => presetSpan('week', Date.now()))
  const [member, setMember] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [refresh, setRefresh] = useState(0)
  const { data, loading } = useReport(span, member, refresh)

  const deleted = (id: string): string => t('usage.deletedMember', { id })
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (data?.members ?? []).filter(row => needle === ''
      || (row.displayName ?? '').toLowerCase().includes(needle)
      || (row.loginName ?? '').toLowerCase().includes(needle))
  }, [data, query])
  const selected = data?.members.find(row => row.memberId === member)
  const totalCharged = data?.totals.chargedTokens ?? 0

  /** Switch to a preset, or open the calendar for a custom range. */
  const choose = (next: Preset): void => {
    setPreset(next)
    if (next !== 'custom') setSpan(presetSpan(next, Date.now()))
  }

  const columns: ColumnsType<WireMemberUsage> = [
    {
      title: t('usage.member'),
      key: 'member',
      render: (_value, row) => (
        <>
          <div>{memberName(row, deleted)}</div>
          {row.loginName !== undefined && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.loginName}</Typography.Text>
          )}
        </>
      ),
    },
    { title: t('usage.department'), key: 'department', render: (_value, row) => row.departmentName ?? t('common.none') },
    {
      title: t('usage.calls'),
      key: 'calls',
      align: 'right',
      sorter: (a, b) => a.calls - b.calls,
      render: (_value, row) => row.calls.toLocaleString(),
    },
    {
      title: t('usage.input'),
      key: 'input',
      align: 'right',
      sorter: (a, b) => a.inputTokens - b.inputTokens,
      render: (_value, row) => row.inputTokens.toLocaleString(),
    },
    {
      title: t('usage.output'),
      key: 'output',
      align: 'right',
      sorter: (a, b) => a.outputTokens - b.outputTokens,
      render: (_value, row) => row.outputTokens.toLocaleString(),
    },
    {
      title: t('usage.charged'),
      key: 'charged',
      align: 'right',
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.chargedTokens - b.chargedTokens,
      render: (_value, row) => <strong>{row.chargedTokens.toLocaleString()}</strong>,
    },
    {
      title: t('usage.share'),
      key: 'share',
      width: 140,
      render: (_value, row) => (
        <Progress
          percent={totalCharged === 0 ? 0 : Math.round((row.chargedTokens / totalCharged) * 100)}
          size="small"
        />
      ),
    },
    {
      title: t('usage.lastCall'),
      key: 'lastCall',
      sorter: (a, b) => (a.lastCallAt ?? 0) - (b.lastCallAt ?? 0),
      render: (_value, row) => row.lastCallAt === undefined
        ? <Typography.Text type="secondary">{t('usage.noCall')}</Typography.Text>
        : <span className="moment">{formatMoment(row.lastCallAt)}</span>,
    },
    {
      title: t('action.actions'),
      key: 'actions',
      render: (_value, row) => (
        <Button
          type="link"
          size="small"
          disabled={row.calls === 0}
          onClick={() => { setMember(row.memberId === member ? undefined : row.memberId) }}
        >
          {t('usage.viewRecords')}
        </Button>
      ),
    },
  ]

  const stats: readonly (readonly [string, number, string])[] = data === undefined ? [] : [
    [t('usage.total'), data.totals.chargedTokens, t('usage.totalNote')],
    [t('usage.input'), data.totals.inputTokens, ''],
    [t('usage.output'), data.totals.outputTokens, ''],
    [
      t('usage.calls'),
      data.totals.calls,
      data.totals.calls === 0
        ? ''
        : t('usage.avgPerCall', { n: Math.round(data.totals.chargedTokens / data.totals.calls).toLocaleString() }),
    ],
    [
      t('usage.activeMembers'),
      data.totals.activeMembers,
      t('usage.activeMembersNote', { n: data.members.filter(row => row.loginName !== undefined).length }),
    ],
  ]

  return (
    <>
      <PageNote text={t('usage.description')} />
      <Toolbar
        filters={(
          <>
            <Segmented<Preset>
              value={preset}
              options={(['today', 'week', 'month', 'custom'] as const).map(value => ({
                value, label: t(`usage.range.${value}`),
              }))}
              onChange={choose}
            />
            {preset === 'custom' && (
              <DatePicker.RangePicker
                allowClear={false}
                // The picker holds whole local days; `to` is the midnight after the last one.
                value={[dayjs(span.from), dayjs(span.to - 1)]}
                onChange={(values) => {
                  if (values?.[0] == null || values[1] == null) return
                  const from = startOfDay(values[0].valueOf())
                  const to = addDays(startOfDay(values[1].valueOf()), 1)
                  if (Math.round((to - from) / DAY_MS) > MAX_CUSTOM_DAYS) {
                    void message.warning(t('usage.rangeTooLong'))
                    return
                  }
                  setSpan({ from, to })
                }}
              />
            )}
          </>
        )}
        actions={(
          <>
            <Button onClick={() => { setRefresh(value => value + 1) }}>{t('usage.refresh')}</Button>
            <Button
              disabled={data === undefined}
              onClick={() => {
                if (data === undefined) return
                downloadCsv(
                  t('usage.exportName'),
                  [
                    t('usage.member'), t('usage.department'), t('usage.calls'), t('usage.input'),
                    t('usage.output'), t('usage.charged'), t('usage.lastCall'),
                  ],
                  data.members.map(row => [
                    memberName(row, deleted), row.departmentName ?? '', String(row.calls), String(row.inputTokens),
                    String(row.outputTokens), String(row.chargedTokens),
                    row.lastCallAt === undefined ? '' : formatMoment(row.lastCallAt),
                  ]),
                )
              }}
            >
              {t('usage.exportMembers')}
            </Button>
          </>
        )}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {stats.map(([title, value, note]) => (
          <Col key={title} xs={12} lg={{ flex: '1 1 0' }}>
            <Card style={{ height: '100%' }}>
              <Statistic title={title} value={value} />
              {/* Every card keeps a note line, empty or not, so the five stay one height. */}
              <Typography.Text type="secondary" style={{ display: 'block', minHeight: 20, fontSize: 12 }}>
                {note}
              </Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        style={{ marginBottom: 16 }}
        title={selected === undefined ? t('usage.trend') : t('usage.trendOf', { name: memberName(selected, deleted) })}
        loading={loading && data === undefined}
      >
        {data !== undefined && <UsageChart report={data} />}
      </Card>

      <Card
        style={{ marginBottom: 16 }}
        title={t('usage.members')}
        extra={(
          <Input.Search
            allowClear
            placeholder={t('usage.searchMember')}
            style={{ width: 240 }}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        )}
      >
        <Table<WireMemberUsage>
          rowKey="memberId"
          size="small"
          columns={columns}
          dataSource={shown}
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
          scroll={{ x: 'max-content' }}
          rowClassName={row => (row.memberId === member ? 'usage-row-selected' : '')}
        />
      </Card>

      <Card
        title={t('usage.records')}
        extra={selected !== undefined && (
          <Tag closable onClose={() => { setMember(undefined) }}>
            {t('usage.onlyMember', { name: memberName(selected, deleted) })}
          </Tag>
        )}
      >
        <UsageRecords
          key={`${String(span.from)}-${String(span.to)}-${member ?? ''}`}
          span={span}
          member={member}
          refresh={refresh}
        />
      </Card>
    </>
  )
}
