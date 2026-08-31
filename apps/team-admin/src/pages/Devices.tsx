/** The devices table: computers bound to member accounts, and the one act that unbinds them. */

import { useState, type ReactNode } from 'react'
import { Button, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api, type WireDevice } from '../api.ts'
import { useLocale } from '../locale.tsx'
import { ConfirmModal, Moment, PageNote, StatusTag, useErrorReporter, useLoaded } from '../ui.tsx'

/**
 * The computers this organization has bound.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @returns the devices view.
 */
export function Devices({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const devices = useLoaded<WireDevice[]>(api.devices, report)
  const [revoking, setRevoking] = useState<WireDevice | undefined>(undefined)

  const mayRevoke = held.has('device|device.revoke')

  const columns: ColumnsType<WireDevice> = [
    {
      title: t('devices.device'),
      key: 'device',
      render: (_value, device) => (
        <>
          <div>{device.platform}</div>
          <Typography.Text type="secondary" code style={{ fontSize: 12 }}>
            {device.publicKeyDigest.slice(0, 16)}…
          </Typography.Text>
        </>
      ),
    },
    {
      title: t('devices.runner'),
      key: 'runnerVersion',
      render: (_value, device) => <Tag>{device.runnerVersion}</Tag>,
    },
    {
      title: t('members.status'),
      key: 'status',
      render: (_value, device) => <StatusTag value={device.status} />,
    },
    {
      title: t('devices.lastSeen'),
      key: 'lastSeenAt',
      render: (_value, device) => <Moment value={device.lastSeenAt} />,
    },
    {
      title: t('action.actions'),
      key: 'actions',
      // A revoked credential cannot be revoked again, so the row that would
      // offer it shows nothing rather than a button that does nothing.
      render: (_value, device) => (mayRevoke && device.status !== 'revoked'
        ? (
          <Button size="small" danger onClick={() => { setRevoking(device) }}>
            {t('devices.revoke')}
          </Button>
        )
        : null),
    },
  ]

  const revoke = async (): Promise<void> => {
    try {
      devices.replace(await api.revokeDevice(revoking?.id ?? ''))
      setRevoking(undefined)
    } catch (error) {
      report(error)
    }
  }

  return (
    <>
      <PageNote text={t('devices.description')} />
      <Table<WireDevice>
        rowKey="id"
        columns={columns}
        dataSource={devices.data ?? []}
        loading={devices.loading}
        pagination={false}
        locale={{ emptyText: t('devices.empty') }}
      />
      <ConfirmModal
        title={revoking === undefined ? '' : t('devices.revokeTitle', { platform: revoking.platform })}
        body={t('devices.revokeBody')}
        open={revoking !== undefined}
        onCancel={() => { setRevoking(undefined) }}
        onConfirm={revoke}
      />
    </>
  )
}
