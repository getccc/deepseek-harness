/** The governed BI project catalog: what a member may analyze, and whether the source still lists it. */

import { useState, type ReactNode } from 'react'
import { Alert, Button, Space, Tag, Typography, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api, type WireBiCatalog, type WireBiProject } from '../api.ts'
import { useLocale } from '../locale.tsx'
import type { CopyKey } from '../locales.ts'
import { ConfirmModal, PageNote, RowActions, useErrorReporter, useLoaded } from '../ui.tsx'

/** Which dialog is open, and what it is about. */
type Dialog = { readonly kind: 'toggle'; readonly project: WireBiProject }

/**
 * The copy key for one source health word.
 *
 * Written out rather than interpolated, because the console's copy keys are a
 * closed set: a health word this build does not have a sentence for should
 * read as unknown rather than render a missing key.
 * @param health - the health word the Control Plane reported.
 * @returns the key to read.
 */
function healthKey(health: string): CopyKey {
  switch (health) {
    case 'healthy':
      return 'bi.health.healthy'
    case 'failing':
      return 'bi.health.failing'
    default:
      return 'bi.health.never-synced'
  }
}

/**
 * The copy key for one failure word.
 * @param failure - the closed failure word the Control Plane reported.
 * @returns the key to read.
 */
function failureKey(failure: string): CopyKey {
  return failure === 'upstream-unavailable'
    ? 'bi.failure.upstream-unavailable'
    : 'bi.failure.upstream-invalid'
}

/**
 * The BI project catalog and everything an administrator does to it.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @returns the BI projects view.
 */
export function BiProjects({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const mayManage = held.has('bi_project|bi.catalog.manage')
  // Opening the page synchronizes, so what an administrator reads is what the
  // source says right now rather than what it said the last time somebody
  // pressed the button. A member who may only read the catalog reads it.
  const catalog = useLoaded<WireBiCatalog>(
    mayManage ? api.syncBiProjects : api.biProjects,
    report,
  )
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)
  const [syncing, setSyncing] = useState(false)

  /** Run one write, put its answer on screen, and close the dialog. */
  const act = async (write: () => Promise<WireBiCatalog>): Promise<void> => {
    try {
      catalog.replace(await write())
      setDialog(undefined)
    } catch (error) {
      report(error)
    }
  }

  const columns: ColumnsType<WireBiProject> = [
    {
      title: t('bi.name'),
      key: 'name',
      render: (_value, project) => (
        <>
          <div>{project.displayName}</div>
          {project.description !== '' && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{project.description}</Typography.Text>
          )}
          <div>
            <Typography.Text type="secondary" code style={{ fontSize: 12 }}>{project.projectRef}</Typography.Text>
          </div>
        </>
      ),
    },
    {
      title: t('bi.warehouse'),
      key: 'warehouse',
      render: (_value, project) => (
        <Typography.Text type="secondary" code style={{ fontSize: 12 }}>
          {project.warehouseType === '' ? t('bi.warehouseUnknown') : project.warehouseType}
        </Typography.Text>
      ),
    },
    {
      title: t('members.status'),
      key: 'status',
      render: (_value, project) => (
        <Space orientation="vertical" size={2}>
          <Tag color={project.effectiveEnabled ? 'green' : 'default'}>
            {t(project.effectiveEnabled ? 'bi.analyzable' : 'bi.notAnalyzable')}
          </Tag>
          {!project.adminEnabled && <Tag>{t('bi.switchedOff')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('action.actions'),
      key: 'actions',
      render: (_value, project) => (
        <RowActions
          actions={[
            {
              key: 'toggle',
              label: t(project.adminEnabled ? 'bi.disable' : 'bi.enable'),
              danger: project.adminEnabled,
              disabled: !mayManage,
              onClick: () => { setDialog({ kind: 'toggle', project }) },
            },
          ]}
        />
      ),
    },
  ]

  const source = catalog.data?.source

  return (
    <>
      <PageNote text={t('bi.description')} />
      {/* Only when something is wrong with the source: a healthy one repeats
          what every row's state already says, and takes the top of the page
          to do it. */}
      {source !== undefined && source.health !== 'healthy' && (
        <Alert
          style={{ marginBottom: 16 }}
          type={source.health === 'failing' ? 'error' : 'info'}
          showIcon
          title={t('bi.sourceHealth', {
            source: source.sourceCode,
            state: t(healthKey(source.health)),
          })}
          description={
            <Space orientation="vertical" size={2}>
              <span>
                {t('bi.lastSuccess', {
                  at: source.lastSuccessAt === undefined
                    ? t('bi.never')
                    : new Date(source.lastSuccessAt).toLocaleString(),
                })}
              </span>
              {source.lastFailure !== undefined && (
                <span>{t('bi.lastFailure', { reason: t(failureKey(source.lastFailure)) })}</span>
              )}
            </Space>
          }
        />
      )}
      {mayManage && (
        <Button
          type="primary"
          loading={syncing}
          style={{ marginBottom: 16 }}
          onClick={() => {
            setSyncing(true)
            void act(api.syncBiProjects).finally(() => { setSyncing(false) })
          }}
        >
          {t('bi.refresh')}
        </Button>
      )}
      <Table<WireBiProject>
        rowKey="projectRef"
        loading={catalog.loading}
        dataSource={[...catalog.data?.projects ?? []]}
        columns={columns}
        pagination={false}
      />
      {dialog !== undefined && (
        <ConfirmModal
          open
          title={t(dialog.project.adminEnabled ? 'bi.disable' : 'bi.enable')}
          body={t(dialog.project.adminEnabled ? 'bi.disableBody' : 'bi.enableBody', {
            name: dialog.project.displayName,
          })}
          danger={dialog.project.adminEnabled}
          onCancel={() => { setDialog(undefined) }}
          onConfirm={() => act(() =>
            api.setBiProjectEnabled(dialog.project.projectRef, !dialog.project.adminEnabled))}
        />
      )}
    </>
  )
}
