/** The overview: what this deployment holds, and how much is in service. */

import type { ReactNode } from 'react'
import { Card, Col, Row, Skeleton, Statistic, Typography } from 'antd'
import { api, type WireOverview } from '../api.ts'
import { useLocale } from '../locale.tsx'
import { useErrorReporter, useLoaded } from '../ui.tsx'
import type { CopyKey } from '../locales.ts'

/**
 * Render the four counts.
 * @returns the overview view.
 */
export function Overview(): ReactNode {
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
              <Card>
                <Statistic title={t(label)} value={value} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {note === 'overview.rolesNote' ? t(note) : t(note, { n: noteValue })}
                </Typography.Text>
              </Card>
            </Col>
          ))}
        </Row>
      </Skeleton>
    </>
  )
}
