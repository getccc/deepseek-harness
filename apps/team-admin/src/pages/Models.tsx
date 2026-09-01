/** The company model catalog: what a Runner may invoke, and where each call really goes. */

import { useState, type ReactNode } from 'react'
import { Button, Form, Input, InputNumber, Typography, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api, type ModelInput, type WireModel } from '../api.ts'
import { useLocale } from '../locale.tsx'
import {
  ConfirmModal, FormModal, PageNote, RowActions, StatusTag, useErrorReporter, useLoaded,
} from '../ui.tsx'

/** Which dialog is open, and what it is about. */
type Dialog =
  | { readonly kind: 'add' }
  | { readonly kind: 'edit'; readonly model: WireModel }
  | { readonly kind: 'status'; readonly model: WireModel }
  | { readonly kind: 'delete'; readonly model: WireModel }

/** The route fields the register and edit forms collect. */
const ROUTE_FIELDS = [
  ['modelRef', 'models.modelRef', 'deepseek-chat'],
  ['displayName', 'models.displayName', 'DeepSeek Chat'],
  ['providerRef', 'models.providerRef', 'deepseek'],
  ['upstreamModel', 'models.upstreamModel', 'deepseek-chat'],
  ['endpoint', 'models.endpoint', 'https://api.deepseek.com'],
  ['credentialRef', 'models.credentialRef', 'COMPANY_DEEPSEEK_KEY'],
] as const

/**
 * The catalog table and everything an administrator does to it.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @returns the models view.
 */
export function Models({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const models = useLoaded<WireModel[]>(api.models, report)
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)

  const mayManage = held.has('model|model.catalog.manage')

  /** Run one write, put its answer on screen, and close the dialog. */
  const act = async (write: () => Promise<WireModel[]>): Promise<void> => {
    try {
      models.replace(await write())
      setDialog(undefined)
    } catch (error) {
      report(error)
    }
  }

  const columns: ColumnsType<WireModel> = [
    {
      title: t('models.modelRef'),
      key: 'model',
      render: (_value, model) => (
        <>
          <div>{model.displayName}</div>
          <Typography.Text type="secondary" code style={{ fontSize: 12 }}>{model.modelRef}</Typography.Text>
        </>
      ),
    },
    {
      title: t('models.providerRef'),
      key: 'provider',
      render: (_value, model) => (
        <>
          <div>{model.providerRef}</div>
          <Typography.Text type="secondary" code style={{ fontSize: 12 }}>{model.upstreamModel}</Typography.Text>
        </>
      ),
    },
    {
      title: t('models.route'),
      key: 'route',
      render: (_value, model) => (
        <>
          <Typography.Text code style={{ fontSize: 12 }}>{model.endpoint}</Typography.Text>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('models.credentialRef')}: {model.credentialRef}
            </Typography.Text>
          </div>
        </>
      ),
    },
    {
      title: t('models.maxOutputTokens'),
      key: 'maxOutputTokens',
      render: (_value, model) => model.maxOutputTokens.toLocaleString(),
    },
    {
      title: t('members.status'),
      key: 'status',
      render: (_value, model) => <StatusTag value={model.status} />,
    },
    {
      title: t('action.actions'),
      key: 'actions',
      render: (_value, model) => (
        <RowActions
          actions={[
            {
              key: 'edit',
              label: t('action.edit'),
              disabled: !mayManage,
              onClick: () => { setDialog({ kind: 'edit', model }) },
            },
            {
              key: 'status',
              label: t(model.status === 'active' ? 'models.retire' : 'models.activate'),
              danger: model.status === 'active',
              disabled: !mayManage,
              onClick: () => { setDialog({ kind: 'status', model }) },
            },
            {
              key: 'delete',
              label: t('action.delete'),
              danger: true,
              disabled: !mayManage,
              onClick: () => { setDialog({ kind: 'delete', model }) },
            },
          ]}
        />
      ),
    },
  ]

  const editing = dialog?.kind === 'edit' ? dialog.model : undefined

  return (
    <>
      <PageNote text={t('models.description')} />
      {mayManage && (
        <Button type="primary" style={{ marginBottom: 16 }} onClick={() => { setDialog({ kind: 'add' }) }}>
          {t('models.add')}
        </Button>
      )}
      <Table<WireModel>
        rowKey="modelRef"
        columns={columns}
        dataSource={models.data ?? []}
        loading={models.loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('models.empty') }}
      />

      <FormModal<ModelInput>
        title={t(editing === undefined ? 'models.addTitle' : 'models.editTitle')}
        open={dialog?.kind === 'add' || dialog?.kind === 'edit'}
        okText={t(editing === undefined ? 'action.create' : 'action.save')}
        initialValues={editing === undefined
          ? { maxOutputTokens: 8192 }
          : {
            modelRef: editing.modelRef,
            displayName: editing.displayName,
            providerRef: editing.providerRef,
            upstreamModel: editing.upstreamModel,
            endpoint: editing.endpoint,
            credentialRef: editing.credentialRef,
            maxOutputTokens: editing.maxOutputTokens,
          }}
        onCancel={() => { setDialog(undefined) }}
        // An edit is the same write as a registration: the stable ref is the
        // identity, so a POST naming a stored one replaces its route and leaves
        // the status and the grants written against that ref alone.
        onSubmit={values => act(() => api.addModel(values))}
      >
        <Typography.Paragraph type="secondary">
          {t(editing === undefined ? 'models.addHint' : 'models.refFixed')}
        </Typography.Paragraph>
        {ROUTE_FIELDS.map(([field, label, placeholder]) => (
          <Form.Item
            key={field}
            name={field}
            label={t(label)}
            rules={[{ required: true, message: t('login.required') }]}
          >
            <Input placeholder={placeholder} disabled={field === 'modelRef' && editing !== undefined} />
          </Form.Item>
        ))}
        <Form.Item
          name="maxOutputTokens"
          label={t('models.maxOutputTokens')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          <InputNumber min={1} step={1} style={{ width: '100%' }} />
        </Form.Item>
      </FormModal>

      <ConfirmModal
        title={dialog?.kind === 'status'
          ? t(
            dialog.model.status === 'active' ? 'models.retireTitle' : 'models.activateTitle',
            { name: dialog.model.displayName },
          )
          : ''}
        body={dialog?.kind === 'status'
          ? t(dialog.model.status === 'active' ? 'models.retireBody' : 'models.activateBody')
          : ''}
        open={dialog?.kind === 'status'}
        danger={dialog?.kind === 'status' && dialog.model.status === 'active'}
        onCancel={() => { setDialog(undefined) }}
        onConfirm={() => act(() => api.setModelStatus(
          dialog?.kind === 'status' ? dialog.model.modelRef : '',
          dialog?.kind === 'status' && dialog.model.status === 'active' ? 'retired' : 'active',
        ))}
      />

      <ConfirmModal
        title={dialog?.kind === 'delete'
          ? t('models.deleteTitle', { name: dialog.model.displayName })
          : ''}
        body={t('models.deleteBody')}
        open={dialog?.kind === 'delete'}
        onCancel={() => { setDialog(undefined) }}
        onConfirm={() => act(() => api.removeModel(dialog?.kind === 'delete' ? dialog.model.modelRef : ''))}
      />
    </>
  )
}
