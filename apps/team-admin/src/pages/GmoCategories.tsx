/** The governed GMO category catalog: what a member may analyze, and whether the source still lists it. */

import { useState, type ReactNode } from 'react'
import { Alert, Button, Space, Tag, Typography, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api, type WireGmoCatalog, type WireGmoCategory } from '../api.ts'
import { useLocale } from '../locale.tsx'
import type { CopyKey } from '../locales.ts'
import { ConfirmModal, PageNote, RowActions, useErrorReporter, useLoaded } from '../ui.tsx'

/** Which dialog is open, and what it is about. */
type Dialog = { readonly kind: 'toggle'; readonly category: WireGmoCategory }

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
      return 'gmo.health.healthy'
    case 'failing':
      return 'gmo.health.failing'
    default:
      return 'gmo.health.never-synced'
  }
}

/**
 * The copy key for one failure word.
 * @param failure - the closed failure word the Control Plane reported.
 * @returns the key to read.
 */
function failureKey(failure: string): CopyKey {
  return failure === 'upstream-unavailable'
    ? 'gmo.failure.upstream-unavailable'
    : 'gmo.failure.upstream-invalid'
}

/**
 * The GMO category catalog and everything an administrator does to it.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @returns the GMO categories view.
 */
export function GmoCategories({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const mayManage = held.has('gmo_category|gmo.catalog.manage')
  // Opening the page synchronizes, so what an administrator reads is what the
  // source says right now rather than what it said the last time somebody
  // pressed the button. A member who may only read the catalog reads it.
  const catalog = useLoaded<WireGmoCatalog>(
    mayManage ? api.syncGmoCategories : api.gmoCategories,
    report,
  )
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)
  const [syncing, setSyncing] = useState(false)

  /** Run one write, put its answer on screen, and close the dialog. */
  const act = async (write: () => Promise<WireGmoCatalog>): Promise<void> => {
    try {
      catalog.replace(await write())
      setDialog(undefined)
    } catch (error) {
      report(error)
    }
  }

  const columns: ColumnsType<WireGmoCategory> = [
    {
      title: t('gmo.name'),
      key: 'name',
      render: (_value, category) => (
        <>
          <div>{category.displayName}</div>
          <div>
            <Typography.Text type="secondary" code style={{ fontSize: 12 }}>{category.categoryRef}</Typography.Text>
          </div>
        </>
      ),
    },
    {
      title: t('gmo.resultCount'),
      key: 'resultCount',
      render: (_value, category) => (
        <Typography.Text type="secondary">
          {category.resultCount === undefined ? t('gmo.resultCountUnknown') : category.resultCount}
        </Typography.Text>
      ),
    },
    {
      title: t('members.status'),
      key: 'status',
      render: (_value, category) => (
        <Space orientation="vertical" size={2}>
          <Tag color={category.effectiveEnabled ? 'green' : 'default'}>
            {t(category.effectiveEnabled ? 'gmo.analyzable' : 'gmo.notAnalyzable')}
          </Tag>
          {!category.adminEnabled && <Tag>{t('gmo.switchedOff')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('action.actions'),
      key: 'actions',
      render: (_value, category) => (
        <RowActions
          actions={[
            {
              key: 'toggle',
              label: t(category.adminEnabled ? 'gmo.disable' : 'gmo.enable'),
              danger: category.adminEnabled,
              disabled: !mayManage,
              onClick: () => { setDialog({ kind: 'toggle', category }) },
            },
          ]}
        />
      ),
    },
  ]

  const source = catalog.data?.source

  return (
    <>
      <PageNote text={t('gmo.description')} />
      {/* Only when something is wrong with the source: a healthy one repeats
          what every row's state already says, and takes the top of the page
          to do it. */}
      {source !== undefined && source.health !== 'healthy' && (
        <Alert
          style={{ marginBottom: 16 }}
          type={source.health === 'failing' ? 'error' : 'info'}
          showIcon
          title={t('gmo.sourceHealth', {
            source: source.sourceCode,
            state: t(healthKey(source.health)),
          })}
          description={
            <Space orientation="vertical" size={2}>
              <span>
                {t('gmo.lastSuccess', {
                  at: source.lastSuccessAt === undefined
                    ? t('gmo.never')
                    : new Date(source.lastSuccessAt).toLocaleString(),
                })}
              </span>
              {source.lastFailure !== undefined && (
                <span>{t('gmo.lastFailure', { reason: t(failureKey(source.lastFailure)) })}</span>
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
            void act(api.syncGmoCategories).finally(() => { setSyncing(false) })
          }}
        >
          {t('gmo.refresh')}
        </Button>
      )}
      <Table<WireGmoCategory>
        rowKey="categoryRef"
        loading={catalog.loading}
        dataSource={[...catalog.data?.categories ?? []]}
        columns={columns}
        pagination={false}
      />
      {dialog !== undefined && (
        <ConfirmModal
          open
          title={t(dialog.category.adminEnabled ? 'gmo.disable' : 'gmo.enable')}
          body={t(dialog.category.adminEnabled ? 'gmo.disableBody' : 'gmo.enableBody', {
            name: dialog.category.displayName,
          })}
          danger={dialog.category.adminEnabled}
          onCancel={() => { setDialog(undefined) }}
          onConfirm={() => act(() =>
            api.setGmoCategoryEnabled(dialog.category.categoryRef, !dialog.category.adminEnabled))}
        />
      )}
    </>
  )
}
