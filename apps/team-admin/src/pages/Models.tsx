/** The company model catalog: what a Runner may invoke, and where each call really goes. */

import { useState, type ReactNode } from 'react'
import { Button, Form, Input, InputNumber, Typography, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api, type WireModel } from '../api.ts'
import { useLocale } from '../locale.tsx'
import { ConfirmModal, FormModal, StatusTag, useErrorReporter, useLoaded } from '../ui.tsx'

/** What the registration form collects. */
interface NewModel {
  modelRef: string
  displayName: string
  providerRef: string
  upstreamModel: string
  endpoint: string
  credentialRef: string
  maxOutputTokens: number
}

/**
 * The catalog table and the registration dialog.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @returns the models view.
 */
export function Models({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const models = useLoaded<WireModel[]>(api.models, report)
  const [adding, setAdding] = useState(false)
  const [changing, setChanging] = useState<WireModel | undefined>(undefined)

  const mayManage = held.has('model|model.catalog.manage')

  /** Run one write, put its answer on screen, and close the dialog. */
  const act = async (write: () => Promise<WireModel[]>): Promise<void> => {
    try {
      models.replace(await write())
      setAdding(false)
      setChanging(undefined)
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
      render: (_value, model) => (mayManage
        ? (
          <Button size="small" danger={model.status === 'active'} onClick={() => { setChanging(model) }}>
            {model.status === 'active' ? t('models.retire') : t('models.activate')}
          </Button>
        )
        : null),
    },
  ]

  return (
    <>
      <Typography.Title level={3}>{t('models.heading')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('models.description')}</Typography.Paragraph>
      {mayManage && (
        <Button type="primary" style={{ marginBottom: 16 }} onClick={() => { setAdding(true) }}>
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

      <FormModal<NewModel>
        title={t('models.addTitle')}
        open={adding}
        okText={t('action.create')}
        initialValues={{ maxOutputTokens: 8192 }}
        onCancel={() => { setAdding(false) }}
        onSubmit={values => act(() => api.addModel(values))}
      >
        <Typography.Paragraph type="secondary">{t('models.addHint')}</Typography.Paragraph>
        {([
          ['modelRef', 'models.modelRef', 'deepseek-chat'],
          ['displayName', 'models.displayName', 'DeepSeek Chat'],
          ['providerRef', 'models.providerRef', 'deepseek'],
          ['upstreamModel', 'models.upstreamModel', 'deepseek-chat'],
          ['endpoint', 'models.endpoint', 'https://api.deepseek.com'],
          ['credentialRef', 'models.credentialRef', 'COMPANY_DEEPSEEK_KEY'],
        ] as const).map(([field, label, placeholder]) => (
          <Form.Item
            key={field}
            name={field}
            label={t(label)}
            rules={[{ required: true, message: t('login.required') }]}
          >
            <Input placeholder={placeholder} />
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
        title={changing === undefined
          ? ''
          : t(
            changing.status === 'active' ? 'models.retireTitle' : 'models.activateTitle',
            { name: changing.displayName },
          )}
        body={changing === undefined
          ? ''
          : t(changing.status === 'active' ? 'models.retireBody' : 'models.activateBody')}
        open={changing !== undefined}
        danger={changing?.status === 'active'}
        onCancel={() => { setChanging(undefined) }}
        onConfirm={() => act(() => api.setModelStatus(
          changing?.modelRef ?? '',
          changing?.status === 'active' ? 'retired' : 'active',
        ))}
      />
    </>
  )
}
