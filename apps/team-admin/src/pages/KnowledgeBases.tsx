/** The governed knowledge catalog: what a member may search, and whether the source still lists it. */

import { useState, type ReactNode } from 'react'
import { Alert, Button, Space, Tag, Typography, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api, type WireKnowledgeBase, type WireKnowledgeCatalog } from '../api.ts'
import { useLocale } from '../locale.tsx'
import type { CopyKey } from '../locales.ts'
import { ConfirmModal, PageNote, RowActions, useErrorReporter, useLoaded } from '../ui.tsx'

/** Which dialog is open, and what it is about. */
type Dialog = { readonly kind: 'toggle'; readonly base: WireKnowledgeBase }

/**
 * The copy key for one source health word.
 *
 * Written out rather than interpolated, because the console's copy keys are a
 * closed set: a health word this build does not have a sentence for should
 * read as unknown rather than render a missing key. `healthy` is here for the
 * same reason, though the banner it belongs to only appears when the source is
 * not healthy.
 * @param health - the health word the Control Plane reported.
 * @returns the key to read.
 */
function healthKey(health: string): CopyKey {
  switch (health) {
    case 'healthy':
      return 'knowledge.health.healthy'
    case 'failing':
      return 'knowledge.health.failing'
    default:
      return 'knowledge.health.never-synced'
  }
}

/**
 * The copy key for one failure word.
 * @param failure - the closed failure word the Control Plane reported.
 * @returns the key to read.
 */
function failureKey(failure: string): CopyKey {
  return failure === 'upstream-unavailable'
    ? 'knowledge.failure.upstream-unavailable'
    : 'knowledge.failure.upstream-invalid'
}

/**
 * The knowledge catalog and everything an administrator does to it.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @returns the knowledge bases view.
 */
export function KnowledgeBases({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const catalog = useLoaded<WireKnowledgeCatalog>(api.knowledgeBases, report)
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)
  const [syncing, setSyncing] = useState(false)

  const mayManage = held.has('knowledge_scope|knowledge.catalog.manage')

  /** Run one write, put its answer on screen, and close the dialog. */
  const act = async (write: () => Promise<WireKnowledgeCatalog>): Promise<void> => {
    try {
      catalog.replace(await write())
      setDialog(undefined)
    } catch (error) {
      report(error)
    }
  }

  const columns: ColumnsType<WireKnowledgeBase> = [
    {
      title: t('knowledge.name'),
      key: 'name',
      render: (_value, base) => (
        <>
          <div>{base.displayName}</div>
          <Typography.Text type="secondary" code style={{ fontSize: 12 }}>{base.knowledgeRef}</Typography.Text>
        </>
      ),
    },
    {
      title: t('knowledge.contents'),
      key: 'contents',
      // No chunk count: the source's listing does not maintain one, so it
      // reads as zero on a knowledge base whose passages a member can search.
      render: (_value, base) => (
        <>
          <div>{t('knowledge.documentCount', { count: base.documentCount.toLocaleString() })}</div>
          {base.processingCount > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('knowledge.processingCount', { count: base.processingCount.toLocaleString() })}
            </Typography.Text>
          )}
        </>
      ),
    },
    {
      title: t('knowledge.embeddingModel'),
      key: 'embeddingModel',
      render: (_value, base) => (
        <Typography.Text type="secondary" code style={{ fontSize: 12 }}>
          {base.embeddingModelId === '' ? t('knowledge.embeddingUnknown') : base.embeddingModelId}
        </Typography.Text>
      ),
    },
    {
      title: t('members.status'),
      key: 'status',
      render: (_value, base) => (
        <Space orientation="vertical" size={2}>
          <Tag color={base.effectiveEnabled ? 'green' : 'default'}>
            {t(base.effectiveEnabled ? 'knowledge.searchable' : 'knowledge.notSearchable')}
          </Tag>
          {!base.remotePresent && <Tag color="warning">{t('knowledge.missingUpstream')}</Tag>}
          {base.remotePresent && !base.adminEnabled && <Tag>{t('knowledge.switchedOff')}</Tag>}
        </Space>
      ),
    },
    {
      title: t('action.actions'),
      key: 'actions',
      render: (_value, base) => (
        <RowActions
          actions={[
            {
              key: 'toggle',
              label: t(base.adminEnabled ? 'knowledge.disable' : 'knowledge.enable'),
              danger: base.adminEnabled,
              // A knowledge base the source no longer lists cannot be made
              // searchable by switching it on, so the control stays out of reach
              // rather than promising something it cannot do.
              disabled: !mayManage || (!base.remotePresent && !base.adminEnabled),
              onClick: () => { setDialog({ kind: 'toggle', base }) },
            },
          ]}
        />
      ),
    },
  ]

  const source = catalog.data?.source

  return (
    <>
      <PageNote text={t('knowledge.description')} />
      {/* Only when something is wrong with the source: a healthy one repeats
          what every row's state already says, and takes the top of the page
          to do it. */}
      {source !== undefined && source.health !== 'healthy' && (
        <Alert
          style={{ marginBottom: 16 }}
          type={source.health === 'failing' ? 'error' : 'info'}
          showIcon
          title={t('knowledge.sourceHealth', {
            source: source.sourceCode,
            state: t(healthKey(source.health)),
          })}
          description={
            <Space orientation="vertical" size={2}>
              <span>
                {t('knowledge.lastSuccess', {
                  at: source.lastSuccessAt === undefined
                    ? t('knowledge.never')
                    : new Date(source.lastSuccessAt).toLocaleString(),
                })}
              </span>
              {source.lastFailure !== undefined && (
                <span>{t('knowledge.lastFailure', { reason: t(failureKey(source.lastFailure)) })}</span>
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
            void act(api.syncKnowledgeBases).finally(() => { setSyncing(false) })
          }}
        >
          {t('knowledge.refresh')}
        </Button>
      )}
      <Table<WireKnowledgeBase>
        rowKey="knowledgeRef"
        loading={catalog.loading}
        dataSource={[...catalog.data?.knowledgeBases ?? []]}
        columns={columns}
        pagination={false}
      />
      {dialog !== undefined && (
        <ConfirmModal
          open
          title={t(dialog.base.adminEnabled ? 'knowledge.disable' : 'knowledge.enable')}
          body={t(dialog.base.adminEnabled ? 'knowledge.disableBody' : 'knowledge.enableBody', {
            name: dialog.base.displayName,
          })}
          danger={dialog.base.adminEnabled}
          onCancel={() => { setDialog(undefined) }}
          onConfirm={() => act(() =>
            api.setKnowledgeBaseEnabled(dialog.base.knowledgeRef, !dialog.base.adminEnabled))}
        />
      )}
    </>
  )
}
