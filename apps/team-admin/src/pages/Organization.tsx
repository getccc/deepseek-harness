/** The organization: its name, which an administrator may change, and its identity, which nobody may. */

import { useState, type ReactNode } from 'react'
import { Button, Card, Descriptions, Form, Input, Skeleton, Typography } from 'antd'
import { api, type WireOrganization } from '../api.ts'
import { useLocale } from '../locale.tsx'
import { FormModal, Moment, useErrorReporter, useLoaded } from '../ui.tsx'

/**
 * Show the organization and offer the one edit there is.
 * @param props.mayManage - whether this member holds `organization.settings.manage`.
 * @returns the organization view.
 */
export function Organization({ mayManage }: { readonly mayManage: boolean }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const { data, loading, replace } = useLoaded<WireOrganization>(api.organization, report)
  const [renaming, setRenaming] = useState(false)

  const rename = async (values: { name: string }): Promise<void> => {
    try {
      replace(await api.renameOrganization(values.name))
      setRenaming(false)
    } catch (error) {
      report(error)
    }
  }

  return (
    <>
      <Typography.Title level={3}>{t('organization.heading')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('organization.description')}</Typography.Paragraph>
      <Skeleton loading={loading} active>
        {data === undefined ? null : (
          <Card
            title={t('organization.profile')}
            extra={mayManage
              ? <Button type="primary" onClick={() => { setRenaming(true) }}>{t('organization.rename')}</Button>
              : null}
          >
            <Descriptions column={1} size="middle">
              <Descriptions.Item label={t('organization.displayName')}>{data.name}</Descriptions.Item>
              <Descriptions.Item label={t('organization.id')}>
                <Typography.Text code>{data.id}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('organization.policyRevision')}>
                {data.policyRevision}
              </Descriptions.Item>
              <Descriptions.Item label={t('organization.created')}>
                <Moment value={data.createdAt} />
              </Descriptions.Item>
            </Descriptions>
          </Card>
        )}
      </Skeleton>
      <FormModal<{ name: string }>
        title={t('organization.renameTitle')}
        open={renaming}
        okText={t('action.save')}
        initialValues={{ name: data?.name ?? '' }}
        onCancel={() => { setRenaming(false) }}
        onSubmit={rename}
      >
        <Form.Item
          name="name"
          label={t('organization.displayName')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          <Input />
        </Form.Item>
      </FormModal>
    </>
  )
}
