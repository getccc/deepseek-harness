/**
 * Roles: what each one admits, who holds it, and the two ways to compose it —
 * by navigation entry, or by naming a permission from the catalog directly.
 */

import { useState, type ReactNode } from 'react'
import { Button, Form, Input, Select, Space, Table, Tag, Tree, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api, type WireGrant, type WireMenu, type WirePermission, type WireRole } from '../api.ts'
import { useLocale } from '../locale.tsx'
import {
  ConfirmModal, FormModal, Moment, PageNote, People, RowActions, Toolbar,
  downloadCsv, useErrorReporter, useLoaded,
} from '../ui.tsx'
import { menuLabel } from '../menus.ts'

/** Which dialog is open, and what it is about. */
type Dialog =
  | { readonly kind: 'add' }
  | { readonly kind: 'edit'; readonly role: WireRole }
  | { readonly kind: 'menus'; readonly role: WireRole }
  | { readonly kind: 'grant'; readonly role: WireRole }
  | { readonly kind: 'revoke'; readonly grant: WireGrant }
  | { readonly kind: 'delete'; readonly role: WireRole }

/** What the create and edit forms collect. */
interface RoleForm {
  name: string
  code?: string
  description?: string
}

/**
 * How far a role's grants reach, read from the grants themselves.
 *
 * A grant over a resource type admits every resource of it; a grant over one
 * resource admits that one. There is no separate stored setting to disagree
 * with, so the column says what the grants actually do.
 * @param role - the role to describe.
 * @returns the copy key for its reach.
 */
function reachOf(role: WireRole): 'roles.dataScopeNone' | 'roles.dataScopeAll' | 'roles.dataScopeSelected' {
  if (role.grants.length === 0) return 'roles.dataScopeNone'
  return role.grants.some(grant => grant.scope === 'type')
    ? 'roles.dataScopeAll'
    : 'roles.dataScopeSelected'
}

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
  const menus = useLoaded<WireMenu[]>(api.menus, report)
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)
  const [term, setTerm] = useState('')
  const [draftTerm, setDraftTerm] = useState('')
  const [chosen, setChosen] = useState<readonly string[]>([])

  const mayCreate = held.has('role|role.create')
  const mayUpdate = held.has('role|role.update')
  const mayDelete = held.has('role|role.delete')
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

  const matching = (roles.data ?? []).filter((role) => {
    const needle = term.trim().toLowerCase()
    return needle === ''
      || role.name.toLowerCase().includes(needle)
      || role.code.toLowerCase().includes(needle)
  })

  /** Entries that declare a permission, which are the ones access can be given by. */
  const grantable = (menus.data ?? []).filter(menu => menu.permission !== undefined)

  /** Open the menu-access dialog with the entries this role already reaches. */
  const openMenus = (role: WireRole): void => {
    const holds = new Set(role.grants
      .filter(grant => grant.scope === 'type')
      .map(grant => `${grant.resourceType}|${grant.action}`))
    setChosen(grantable
      .filter(menu => holds.has(menu.permission as string))
      .map(menu => menu.id))
    setDialog({ kind: 'menus', role })
  }

  const columns: ColumnsType<WireRole> = [
    { title: t('roles.name'), key: 'name', render: (_value, role) => role.name },
    {
      title: t('roles.code'),
      key: 'code',
      render: (_value, role) => <Typography.Text code>{role.code}</Typography.Text>,
    },
    {
      title: t('roles.roleDescription'),
      key: 'description',
      render: (_value, role) => (role.description === ''
        ? <Typography.Text type="secondary">{t('roles.noDescription')}</Typography.Text>
        : role.description),
    },
    {
      title: t('roles.dataScope'),
      key: 'reach',
      render: (_value, role) => t(reachOf(role)),
    },
    {
      title: t('roles.users'),
      key: 'members',
      render: (_value, role) => <People names={role.memberNames} empty="0" />,
    },
    {
      title: t('roles.created'),
      key: 'createdAt',
      render: (_value, role) => (role.createdAt === undefined
        ? t('common.none')
        : <Moment value={role.createdAt} />),
    },
    {
      title: t('roles.kind'),
      key: 'kind',
      render: (_value, role) => (
        <Tag color={role.kind === 'system' ? 'gold' : 'default'}>
          {t(role.kind === 'system' ? 'roles.system' : 'roles.custom')}
        </Tag>
      ),
    },
    {
      title: t('action.actions'),
      key: 'actions',
      render: (_value, role) => (
        <RowActions
          actions={[
            {
              key: 'edit',
              label: t('action.edit'),
              disabled: !mayUpdate,
              onClick: () => { setDialog({ kind: 'edit', role }) },
            },
            {
              key: 'menus',
              label: t('roles.menuAccess'),
              disabled: !mayManageGrants,
              onClick: () => { openMenus(role) },
            },
            {
              key: 'grant',
              label: t('roles.addGrant'),
              disabled: !mayManageGrants,
              onClick: () => { setDialog({ kind: 'grant', role }) },
            },
            {
              key: 'delete',
              label: t('action.delete'),
              danger: true,
              // A role the product ships is what the deployment's own
              // composition binds to, so the control says so rather than
              // offering an act the Control Plane would refuse.
              disabled: !mayDelete || role.kind === 'system',
              onClick: () => { setDialog({ kind: 'delete', role }) },
            },
          ]}
        />
      ),
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

  const editing = dialog?.kind === 'edit' ? dialog.role : undefined

  return (
    <>
      <PageNote text={t('roles.description')} />
      <Toolbar
        filters={(
          <>
            <Input.Search
              allowClear
              value={draftTerm}
              placeholder={t('roles.searchPlaceholder')}
              style={{ width: 240 }}
              onChange={(event) => { setDraftTerm(event.target.value) }}
              onSearch={(value) => { setTerm(value) }}
            />
            <Button type="primary" onClick={() => { setTerm(draftTerm) }}>{t('filter.query')}</Button>
            <Button onClick={() => { setDraftTerm(''); setTerm('') }}>{t('filter.reset')}</Button>
          </>
        )}
        actions={(
          <>
            <Button
              onClick={() => {
                downloadCsv(
                  'roles',
                  [
                    t('roles.name'), t('roles.code'), t('roles.roleDescription'),
                    t('roles.dataScope'), t('roles.users'), t('roles.kind'),
                  ],
                  matching.map(role => [
                    role.name, role.code, role.description, t(reachOf(role)),
                    String(role.memberCount), role.kind,
                  ]),
                )
              }}
            >
              {t('filter.export')}
            </Button>
            {mayCreate && (
              <Button type="primary" onClick={() => { setDialog({ kind: 'add' }) }}>
                {t('filter.add')}
              </Button>
            )}
          </>
        )}
      />
      <Table<WireRole>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={matching}
        loading={roles.loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        expandable={{ expandedRowRender: grantsOf }}
      />

      <FormModal<RoleForm>
        title={t(editing === undefined ? 'roles.addTitle' : 'roles.editTitle')}
        open={dialog?.kind === 'add' || dialog?.kind === 'edit'}
        okText={t(editing === undefined ? 'action.create' : 'action.save')}
        initialValues={editing === undefined
          ? {}
          : { name: editing.name, code: editing.code, description: editing.description }}
        onCancel={() => { setDialog(undefined) }}
        onSubmit={values => act(() => (editing === undefined
          ? api.addRole({
            name: values.name,
            ...(values.code === undefined || values.code === '' ? {} : { code: values.code }),
            ...(values.description === undefined ? {} : { description: values.description }),
          })
          : api.updateRole(editing.id, {
            name: values.name,
            ...(values.code === undefined || values.code === '' ? {} : { code: values.code }),
            description: values.description ?? '',
          })))}
      >
        <Form.Item
          name="name"
          label={t('roles.name')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="code" label={t('roles.code')} extra={t('roles.codeHint')}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label={t('roles.roleDescription')}>
          <Input />
        </Form.Item>
      </FormModal>

      <FormModal<Record<string, never>>
        title={t('roles.menuAccessTitle', { name: dialog?.kind === 'menus' ? dialog.role.name : '' })}
        open={dialog?.kind === 'menus'}
        okText={t('action.save')}
        onCancel={() => { setDialog(undefined) }}
        onSubmit={() => act(() => api.setRoleMenus(
          dialog?.kind === 'menus' ? dialog.role.id : '',
          chosen,
        ))}
      >
        <Typography.Paragraph type="secondary">{t('roles.menuAccessHint')}</Typography.Paragraph>
        <Tree
          checkable
          selectable={false}
          defaultExpandAll
          checkedKeys={[...chosen]}
          // Each entry is checked on its own: a group and the pages under it
          // declare different permissions, and checking a group must not
          // silently grant every permission beneath it.
          checkStrictly
          onCheck={(keys) => {
            const checked = Array.isArray(keys) ? keys : keys.checked
            setChosen(checked as string[])
          }}
          treeData={grantable.map(menu => ({
            key: menu.id,
            title: `${menuLabel(menu, t)} — ${menu.permission as string}`,
          }))}
        />
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

      <ConfirmModal
        title={dialog?.kind === 'delete' ? t('roles.deleteTitle', { name: dialog.role.name }) : ''}
        body={t('roles.deleteBody')}
        open={dialog?.kind === 'delete'}
        onCancel={() => { setDialog(undefined) }}
        onConfirm={() => act(() => api.removeRole(dialog?.kind === 'delete' ? dialog.role.id : ''))}
      />
    </>
  )
}
