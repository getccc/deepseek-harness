/**
 * The overview: what this deployment holds, how much is in service, and, for a
 * member who may read usage, how many tokens the organization is spending.
 */

import { useMemo, type ReactNode } from 'react'
import { Card, Col, Empty, Progress, Row, Skeleton, Statistic, Typography, theme } from 'antd'
import { api, type WireOverview } from '../api.ts'
import { useLocale } from '../locale.tsx'
import { useErrorReporter, useLoaded } from '../ui.tsx'
import type { CopyKey } from '../locales.ts'
import { HOUR_MS, UsageChart, addDays, daysSpan, memberName, useReport } from '../usage.tsx'

/** The permission that lets a member read token usage. */
const USAGE_READ = 'usage|usage.organization.read'

/** How many users the ranking lists. */
const TOP_USERS = 5

/**
 * The organization's token spending: today against yesterday, the last seven
 * days, who spent the most, and when.
 *
 * Two reads feed it, the last seven local days and today alone, so the first
 * gives the daily trend and the ranking and the second the hour-by-hour view.
 * @returns the token section of the overview.
 */
function TokenOverview(): ReactNode {
  const { t } = useLocale()
  const { token } = theme.useToken()
  const week = useMemo(() => daysSpan(7, Date.now()), [])
  const today = useMemo(() => daysSpan(1, Date.now()), [])
  const weekly = useReport(week, undefined, 0)
  const daily = useReport(today, undefined, 0)

  const deleted = (id: string): string => t('usage.deletedMember', { id })
  const yesterday = weekly.data?.series.find(bucket => Math.abs(bucket.start - addDays(today.from, -1)) < HOUR_MS / 2)
  const todayTokens = daily.data?.totals.chargedTokens ?? 0
  const change = yesterday === undefined || yesterday.chargedTokens === 0
    ? undefined
    : (todayTokens - yesterday.chargedTokens) / yesterday.chargedTokens
  const vsYesterday = change === undefined
    ? (todayTokens > 0 ? t('overview.usage.noYesterday') : '')
    : t('overview.usage.vsYesterday', {
      change: `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`,
    })

  const cards: readonly (readonly [CopyKey, number, string])[] = weekly.data === undefined || daily.data === undefined
    ? []
    : [
      ['overview.usage.today', todayTokens, vsYesterday],
      ['overview.usage.week', weekly.data.totals.chargedTokens, t('overview.usage.weekNote', { n: weekly.data.totals.calls.toLocaleString() })],
      [
        'overview.usage.todayCalls',
        daily.data.totals.calls,
        daily.data.totals.calls === 0
          ? ''
          : t('usage.avgPerCall', { n: Math.round(todayTokens / daily.data.totals.calls).toLocaleString() }),
      ],
      [
        'overview.usage.todayActive',
        daily.data.totals.activeMembers,
        t('overview.usage.todayActiveNote', { n: weekly.data.totals.activeMembers }),
      ],
    ]

  const ranking = (weekly.data?.members ?? []).filter(row => row.chargedTokens > 0).slice(0, TOP_USERS)
  const weekTotal = weekly.data?.totals.chargedTokens ?? 0
  const peak = ranking[0]?.chargedTokens ?? 1

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 32 }}>{t('overview.usage.heading')}</Typography.Title>
      <Row gutter={[16, 16]}>
        {cards.map(([label, value, note]) => (
          <Col key={label} xs={12} lg={6}>
            <Card style={{ height: '100%' }}>
              <Statistic title={t(label)} value={value} />
              <Typography.Text type="secondary" style={{ display: 'block', minHeight: 20, fontSize: 12 }}>
                {note}
              </Typography.Text>
            </Card>
          </Col>
        ))}
        {cards.length === 0 && [0, 1, 2, 3].map(index => (
          <Col key={index} xs={12} lg={6}><Card><Skeleton active paragraph={{ rows: 1 }} /></Card></Col>
        ))}
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card title={t('overview.usage.weekTrend')} style={{ height: '100%' }} loading={weekly.data === undefined}>
            {weekly.data !== undefined && <UsageChart report={weekly.data} height={240} />}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card
            title={t('overview.usage.top', { n: TOP_USERS })}
            style={{ height: '100%' }}
            loading={weekly.data === undefined}
          >
            {ranking.length === 0
              ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('usage.chartEmpty')} />
              : ranking.map((row, index) => (
                <div key={row.memberId} className="rank-row">
                  <span
                    className="rank-index"
                    style={index < 3
                      ? { background: token.colorPrimary, color: token.colorTextLightSolid }
                      : { background: token.colorFillSecondary, color: token.colorTextSecondary }}
                  >
                    {index + 1}
                  </span>
                  <div className="rank-body">
                    <div className="rank-line">
                      <span>{memberName(row, deleted)}</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {row.chargedTokens.toLocaleString()} · {t('overview.usage.share', { pct: Math.round((row.chargedTokens / weekTotal) * 100) })}
                      </Typography.Text>
                    </div>
                    <Progress
                      percent={Math.round((row.chargedTokens / peak) * 100)}
                      showInfo={false}
                      size="small"
                      status="normal"
                      strokeColor={token.colorPrimary}
                    />
                  </div>
                </div>
              ))}
          </Card>
        </Col>
      </Row>
      <Card title={t('overview.usage.todayTrend')} style={{ marginTop: 16 }} loading={daily.data === undefined}>
        {daily.data !== undefined && <UsageChart report={daily.data} height={200} />}
      </Card>
    </>
  )
}

/**
 * Render the counts, and the token section for a member who may read usage.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @returns the overview view.
 */
export function Overview({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const { data, loading } = useLoaded<WireOverview>(api.overview, report)

  const cards: readonly (readonly [CopyKey, number, CopyKey, number])[] = data === undefined ? [] : [
    ['overview.members', data.members, 'overview.membersNote', data.activeMembers],
    ['overview.roles', data.roles, 'overview.rolesNote', 0],
    ['overview.devices', data.devices, 'overview.devicesNote', data.activeDevices],
    ['overview.models', data.models, 'overview.modelsNote', data.activeModels],
  ]

  return (
    <>
      <Typography.Title level={3}>{t('overview.heading')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('overview.description')}</Typography.Paragraph>
      <Skeleton loading={loading} active>
        <Row gutter={[16, 16]}>
          {cards.map(([label, value, note, noteValue]) => (
            <Col key={label} xs={12} lg={6}>
              <Card style={{ height: '100%' }}>
                <Statistic title={t(label)} value={value} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {note === 'overview.rolesNote' ? t(note) : t(note, { n: noteValue })}
                </Typography.Text>
              </Card>
            </Col>
          ))}
        </Row>
      </Skeleton>
      {held.has(USAGE_READ) && <TokenOverview />}
    </>
  )
}
