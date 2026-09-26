/** The desktop releases this deployment publishes: who each one is offered to, and the floor below which a client must update. */

import { useState, type ReactNode } from 'react'
import { Button, Input, Modal, Radio, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api, type WireRelease, type WireReleaseCatalog } from '../api.ts'
import { useLocale } from '../locale.tsx'
import { ConfirmModal, PageNote, RowActions, useErrorReporter, useLoaded } from '../ui.tsx'

/** Which dialog is open, and what it is about. */
type Dialog =
  | { readonly kind: 'publish' }
  | { readonly kind: 'promote'; readonly release: WireRelease }
  | { readonly kind: 'withdraw'; readonly release: WireRelease }

/** The version and signature a pasted manifest document carries, when it carries them. */
function readDocument(text: string): { version: string; manifest: string; signature: string } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // A paste that is not JSON at all; the form says so rather than sending it.
    return undefined
  }
  const document = parsed as { manifest?: { version?: unknown }; signature?: unknown }
  const version = document.manifest?.version
  if (typeof version !== 'string' || typeof document.signature !== 'string') return undefined
  return { version, manifest: text, signature: document.signature }
}

/**
 * The published releases and everything an administrator does to them.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @returns the releases view.
 */
export function Releases({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const mayManage = held.has('release|release.manage')
  const catalog = useLoaded<WireReleaseCatalog>(api.releases, report)
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)
  const [document, setDocument] = useState('')
  const [channel, setChannel] = useState<'staged' | 'general'>('staged')
  const [floor, setFloor] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  /** Run one write and put the reloaded catalog on screen. */
  const act = async (write: () => Promise<unknown>): Promise<void> => {
    try {
      await write()
      catalog.replace(await api.releases())
      setDialog(undefined)
    } catch (error) {
      report(error)
    }
  }

  const parsed = readDocument(document)
  const shownFloor = floor ?? catalog.data?.minimumVersion ?? ''

  const columns: ColumnsType<WireRelease> = [
    {
      title: t('release.version'),
      key: 'version',
      render: (_value, release) => <Typography.Text code>{release.version}</Typography.Text>,
    },
    {
      title: t('release.channel'),
      key: 'channel',
      render: (_value, release) => (
        <Tag color={release.channel === 'general' ? 'green' : 'blue'}>
          {t(release.channel === 'general' ? 'release.channel.general' : 'release.channel.staged')}
        </Tag>
      ),
    },
    {
      title: t('release.publishedAt'),
      key: 'publishedAt',
      render: (_value, release) => new Date(release.publishedAt).toLocaleString(),
    },
    {
      title: t('release.state'),
      key: 'state',
      render: (_value, release) => (
        <Tag color={release.withdrawnAt === null ? 'green' : 'default'}>
          {t(release.withdrawnAt === null ? 'release.state.offered' : 'release.state.withdrawn')}
        </Tag>
      ),
    },
    {
      title: t('action.actions'),
      key: 'actions',
      render: (_value, release) => (
        <RowActions
          actions={[
            {
              key: 'promote',
              label: t('release.promote'),
              disabled: !mayManage || release.channel === 'general' || release.withdrawnAt !== null,
              onClick: () => { setDialog({ kind: 'promote', release }) },
            },
            {
              key: 'withdraw',
              label: t('release.withdraw'),
              danger: true,
              disabled: !mayManage || release.withdrawnAt !== null,
              onClick: () => { setDialog({ kind: 'withdraw', release }) },
            },
          ]}
        />
      ),
    },
  ]

  return (
    <>
      <PageNote text={t('release.description')} />
      <Space style={{ marginBottom: 16 }} wrap>
        {mayManage && (
          <Button type="primary" onClick={() => { setDocument(''); setChannel('staged'); setDialog({ kind: 'publish' }) }}>
            {t('release.publish')}
          </Button>
        )}
        <Typography.Text type="secondary">{t('release.floor')}</Typography.Text>
        <Input
          style={{ width: 140 }}
          value={shownFloor}
          disabled={!mayManage}
          placeholder={t('release.floorCleared')}
          onChange={(event) => { setFloor(event.target.value) }}
        />
        <Button
          disabled={!mayManage}
          loading={saving}
          onClick={() => {
            setSaving(true)
            void act(() => api.setReleaseFloor(shownFloor.trim() === '' ? null : shownFloor.trim()))
              .finally(() => { setSaving(false); setFloor(undefined) })
          }}
        >
          {t('release.floorSave')}
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('release.floorHint')}</Typography.Text>
      </Space>
      <Table<WireRelease>
        rowKey="version"
        loading={catalog.loading}
        dataSource={[...catalog.data?.releases ?? []]}
        columns={columns}
        pagination={false}
        locale={{ emptyText: t('release.empty') }}
      />
      <Modal
        title={t('release.publish')}
        open={dialog?.kind === 'publish'}
        okText={t('action.confirm')}
        cancelText={t('action.cancel')}
        okButtonProps={{ disabled: parsed === undefined }}
        onCancel={() => { setDialog(undefined) }}
        onOk={() => {
          if (parsed === undefined) return
          void act(() => api.publishRelease({ ...parsed, channel }))
        }}
      >
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text type="secondary">{t('release.documentHint')}</Typography.Text>
          <Input.TextArea
            rows={8}
            value={document}
            placeholder={t('release.document')}
            onChange={(event) => { setDocument(event.target.value) }}
          />
          {document !== '' && parsed === undefined && (
            <Typography.Text type="danger">{t('release.documentInvalid')}</Typography.Text>
          )}
          {parsed !== undefined && (
            <Typography.Text>
              {t('release.version')}: <Typography.Text code>{parsed.version}</Typography.Text>
            </Typography.Text>
          )}
          <Radio.Group
            value={channel}
            onChange={(event) => { setChannel(event.target.value as 'staged' | 'general') }}
            options={[
              { value: 'staged', label: t('release.channel.staged') },
              { value: 'general', label: t('release.channel.general') },
            ]}
          />
        </Space>
      </Modal>
      {(dialog?.kind === 'promote' || dialog?.kind === 'withdraw') && (
        <ConfirmModal
          open
          title={t(dialog.kind === 'promote' ? 'release.promote' : 'release.withdraw')}
          body={t(dialog.kind === 'promote' ? 'release.promoteBody' : 'release.withdrawBody', {
            version: dialog.release.version,
          })}
          danger={dialog.kind === 'withdraw'}
          onCancel={() => { setDialog(undefined) }}
          onConfirm={() => act(() => (dialog.kind === 'promote'
            ? api.publishRelease({
              version: dialog.release.version,
              manifest: '',
              signature: '',
              channel: 'general',
            })
            : api.withdrawRelease(dialog.release.version)))}
        />
      )}
    </>
  )
}
