/** Roles and access: what a role admits, and the closed catalog it is composed from. */

import { useState, type ReactNode } from 'react'
import { Button, Form, Input, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api, type WireGrant, type WirePermission, type WireRole } from '../api.ts'
import { useLocale } from '../locale.tsx'
import { ConfirmModal, FormModal, useErrorReporter, useLoaded } from '../ui.tsx'

/** Which dialog is open, and what it is about. */
type Dialog =
  | { readonly kind: 'add' }
  | { readonly kind: 'grant'; readonly role: WireRole }
  | { readonly kind: 'revoke'; readonly grant: WireGrant }

/**
 * The roles table, each row expanding into the grants that compose it.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @returns the roles view.
 */
export function Roles({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const roles = useLoaded<WireRole[]>(api.roles, report)
  const permissions = useLoaded<WirePermission[]>(api.permissions, report)
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)

  const mayCreate = held.has('role|role.create')
  const mayManageGrants = held.has('role|role.grant.manage')

  /** Run one write, put its answer on screen, and close the dialog. */
  const act = async (write: () => Promise<WireRole[]>): Promise<void> => {
    try {
      roles.replace(await write())
      setDialog(undefined)
    } catch (error) {
      report(error)
    }
  }

  const columns: ColumnsType<WireRole> = [
    {
      title: t('roles.name'),
      key: 'name',
      render: (_value, role) => (
        <>
          <div>{role.name}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {role.description === '' ? t('roles.noDescription') : role.description}
          </Typography.Text>
        </>
      ),
    },
    { title: t('roles.kind'), key: 'kind', render: (_value, role) => <Tag>{role.kind}</Tag> },
    { title: t('roles.grants'), key: 'count', render: (_value, role) => role.grants.length },
    {
      title: t('action.actions'),
      key: 'actions',
      render: (_value, role) => (mayManageGrants
        ? (
          <Button size="small" onClick={() => { setDialog({ kind: 'grant', role }) }}>
            {t('roles.addGrant')}
          </Button>
        )
        : null),
    },
  ]

  /** The grants of one role, as the expanded row. */
  const grantsOf = (role: WireRole): ReactNode => (role.grants.length === 0
    ? <Typography.Text type="secondary">{t('roles.noGrants')}</Typography.Text>
    : (
      <Space orientation="vertical" style={{ width: '100%' }}>
        {role.grants.map(grant => (
          <Space key={grant.id} style={{ justifyContent: 'space-between', width: '100%' }}>
            <span>
              <Typography.Text code>{grant.action}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12, marginInlineStart: 8 }}>
                {grant.scope === 'type'
                  ? t('roles.allOfType', { type: grant.resourceType })
                  : `${grant.resourceType} · ${grant.resourceDisplayName ?? ''}`}
              </Typography.Text>
            </span>
            {mayManageGrants && (
              <Button size="small" danger onClick={() => { setDialog({ kind: 'revoke', grant }) }}>
                {t('action.remove')}
              </Button>
            )}
          </Space>
        ))}
      </Space>
    ))

  return (
    <>
      <Typography.Title level={3}>{t('roles.heading')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('roles.description')}</Typography.Paragraph>
      {mayCreate && (
        <Button type="primary" style={{ marginBottom: 16 }} onClick={() => { setDialog({ kind: 'add' }) }}>
          {t('roles.add')}
        </Button>
      )}
      <Table<WireRole>
        rowKey="id"
        columns={columns}
        dataSource={roles.data ?? []}
        loading={roles.loading}
        pagination={false}
        expandable={{ expandedRowRender: grantsOf }}
      />

      <FormModal<{ name: string; description?: string }>
        title={t('roles.addTitle')}
        open={dialog?.kind === 'add'}
        okText={t('action.create')}
        onCancel={() => { setDialog(undefined) }}
        onSubmit={values => act(() => api.addRole({
          name: values.name,
          ...(values.description === undefined ? {} : { description: values.description }),
        }))}
      >
        <Form.Item
          name="name"
          label={t('roles.name')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="description" label={t('roles.roleDescription')}>
          <Input />
        </Form.Item>
      </FormModal>

      <FormModal<{ permission: string }>
        title={t('roles.addGrantTitle', { name: dialog?.kind === 'grant' ? dialog.role.name : '' })}
        open={dialog?.kind === 'grant'}
        okText={t('action.save')}
        onCancel={() => { setDialog(undefined) }}
        onSubmit={(values) => {
          // The select carries the pair the catalog names; splitting it here
          // keeps the console from inventing either half.
          const separator = values.permission.indexOf('|')
          return act(() => api.addGrant(
            dialog?.kind === 'grant' ? dialog.role.id : '',
            values.permission.slice(0, separator),
            values.permission.slice(separator + 1),
          ))
        }}
      >
        <Typography.Paragraph type="secondary">{t('roles.catalogHint')}</Typography.Paragraph>
        <Form.Item
          name="permission"
          label={t('roles.permission')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          <Select
            showSearch
            options={(permissions.data ?? []).map(permission => ({
              value: `${permission.resourceType}|${permission.action}`,
              label: `${permission.resourceType} · ${permission.action}`,
            }))}
          />
        </Form.Item>
      </FormModal>

      <ConfirmModal
        title={dialog?.kind === 'revoke' ? t('roles.revokeTitle', { action: dialog.grant.action }) : ''}
        body={t('roles.revokeBody')}
        open={dialog?.kind === 'revoke'}
        onCancel={() => { setDialog(undefined) }}
        onConfirm={() => act(() => api.revokeGrant(dialog?.kind === 'revoke' ? dialog.grant.id : ''))}
      />
    </>
  )
}
