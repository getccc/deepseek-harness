/** The users table: identities, sign-in status, and role bindings. */

import { useState, type ReactNode } from 'react'
import { Button, Form, Input, Select, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api, type WireMember, type WireRole } from '../api.ts'
import { useLocale } from '../locale.tsx'
import { ConfirmModal, FormModal, Moment, StatusTag, useErrorReporter, useLoaded } from '../ui.tsx'

/** Which dialog is open, and what it is about. */
type Dialog =
  | { readonly kind: 'add' }
  | { readonly kind: 'bind'; readonly member: WireMember }
  | { readonly kind: 'unbind'; readonly member: WireMember; readonly roleId: string; readonly roleName: string }
  | { readonly kind: 'status'; readonly member: WireMember }

/** What the create form collects. */
interface NewMember {
  loginName: string
  displayName: string
  email?: string
}

/**
 * The member directory and everything an administrator does to it.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @returns the users view.
 */
export function Members({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const members = useLoaded<WireMember[]>(api.members, report)
  const roles = useLoaded<WireRole[]>(api.roles, report)
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)

  const mayCreate = held.has('member|member.create')
  const mayBind = held.has('member|member.role.bind')
  const mayDisable = held.has('member|member.disable')
  const mayEnable = held.has('member|member.enable')

  /** Run one write, put its answer on screen, and close the dialog. */
  const act = async (write: () => Promise<WireMember[]>): Promise<void> => {
    try {
      members.replace(await write())
      setDialog(undefined)
    } catch (error) {
      report(error)
    }
  }

  const columns: ColumnsType<WireMember> = [
    {
      title: t('members.displayName'),
      key: 'identity',
      render: (_value, member) => (
        <>
          <div>{member.displayName}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            @{member.loginName}{member.email === undefined ? '' : ` · ${member.email}`}
          </Typography.Text>
        </>
      ),
    },
    {
      title: t('members.status'),
      key: 'status',
      render: (_value, member) => <StatusTag value={member.status} />,
    },
    {
      title: t('members.roles'),
      key: 'roles',
      render: (_value, member) => (member.roles.length === 0
        ? <Typography.Text type="secondary">{t('members.noRoles')}</Typography.Text>
        : (
          <Space size={[4, 4]} wrap>
            {member.roles.map(role => (
              <Tag
                key={role.id}
                closable={mayBind}
                onClose={(event) => {
                  event.preventDefault()
                  setDialog({ kind: 'unbind', member, roleId: role.id, roleName: role.name })
                }}
              >
                {role.name}
              </Tag>
            ))}
          </Space>
        )),
    },
    {
      title: t('members.lastLogin'),
      key: 'lastLoginAt',
      render: (_value, member) => <Moment value={member.lastLoginAt} />,
    },
    {
      title: t('action.actions'),
      key: 'actions',
      render: (_value, member) => (
        <Space>
          {mayBind && (
            <Button size="small" onClick={() => { setDialog({ kind: 'bind', member }) }}>
              {t('members.bindRole')}
            </Button>
          )}
          {(member.status === 'active' ? mayDisable : mayEnable) && (
            <Button
              size="small"
              danger={member.status === 'active'}
              onClick={() => { setDialog({ kind: 'status', member }) }}
            >
              {member.status === 'active' ? t('members.suspend') : t('members.reactivate')}
            </Button>
          )}
        </Space>
      ),
    },
  ]

  const bindable = dialog?.kind === 'bind'
    ? (roles.data ?? []).filter(role => !dialog.member.roles.some(held2 => held2.id === role.id))
    : []

  return (
    <>
      <Typography.Title level={3}>{t('members.heading')}</Typography.Title>
      <Typography.Paragraph type="secondary">{t('members.description')}</Typography.Paragraph>
      {mayCreate && (
        <Button type="primary" style={{ marginBottom: 16 }} onClick={() => { setDialog({ kind: 'add' }) }}>
          {t('members.add')}
        </Button>
      )}
      <Table<WireMember>
        rowKey="id"
        columns={columns}
        dataSource={members.data ?? []}
        loading={members.loading}
        pagination={false}
      />

      <FormModal<NewMember>
        title={t('members.addTitle')}
        open={dialog?.kind === 'add'}
        okText={t('action.create')}
        onCancel={() => { setDialog(undefined) }}
        onSubmit={values => act(() => api.addMember({
          loginName: values.loginName,
          displayName: values.displayName,
          ...(values.email === undefined || values.email === '' ? {} : { email: values.email }),
        }))}
      >
        <Typography.Paragraph type="secondary">{t('members.addHint')}</Typography.Paragraph>
        <Form.Item
          name="loginName"
          label={t('members.loginName')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="displayName"
          label={t('members.displayName')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="email" label={`${t('members.email')} (${t('members.optional')})`}>
          <Input type="email" />
        </Form.Item>
      </FormModal>

      <FormModal<{ roleId: string }>
        title={t('members.bindTitle', { name: dialog?.kind === 'bind' ? dialog.member.displayName : '' })}
        open={dialog?.kind === 'bind'}
        okText={t('action.save')}
        onCancel={() => { setDialog(undefined) }}
        onSubmit={values => act(() => api.bindRole(
          dialog?.kind === 'bind' ? dialog.member.id : '',
          values.roleId,
        ))}
      >
        <Form.Item
          name="roleId"
          label={t('members.roles')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          <Select options={bindable.map(role => ({ value: role.id, label: role.name }))} />
        </Form.Item>
      </FormModal>

      <ConfirmModal
        title={dialog?.kind === 'unbind'
          ? t('members.unbindTitle', { role: dialog.roleName, name: dialog.member.displayName })
          : ''}
        body={t('members.unbindBody')}
        open={dialog?.kind === 'unbind'}
        onCancel={() => { setDialog(undefined) }}
        onConfirm={() => act(() => api.unbindRole(
          dialog?.kind === 'unbind' ? dialog.member.id : '',
          dialog?.kind === 'unbind' ? dialog.roleId : '',
        ))}
      />

      <ConfirmModal
        title={dialog?.kind === 'status'
          ? t(
            dialog.member.status === 'active' ? 'members.suspendTitle' : 'members.reactivateTitle',
            { name: dialog.member.displayName },
          )
          : ''}
        body={dialog?.kind === 'status'
          ? t(dialog.member.status === 'active' ? 'members.suspendBody' : 'members.reactivateBody')
          : ''}
        open={dialog?.kind === 'status'}
        danger={dialog?.kind === 'status' && dialog.member.status === 'active'}
        onCancel={() => { setDialog(undefined) }}
        onConfirm={() => act(() => api.setMemberStatus(
          dialog?.kind === 'status' ? dialog.member.id : '',
          dialog?.kind === 'status' && dialog.member.status === 'active' ? 'suspended' : 'active',
        ))}
      />
    </>
  )
}
