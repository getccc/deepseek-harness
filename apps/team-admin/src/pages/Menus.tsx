/**
 * The console's own navigation, as a tree an administrator edits.
 *
 * An entry says where it goes, which page renders it, and which permission it
 * needs. That last field is what a role's menu access is composed from, so the
 * select offers the permission catalog rather than a free text box: navigation
 * an administrator writes can never name authority this build does not govern.
 */

import { useState, type ReactNode } from 'react'
import { Button, Form, Input, InputNumber, Select, Switch, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api, type WireMenu, type WirePermission } from '../api.ts'
import { useLocale } from '../locale.tsx'
import { CONSOLE_COMPONENTS, MENU_ICONS, menuLabel } from '../menus.ts'
import {
  ConfirmModal, FormModal, Moment, PageNote, RowActions, StatusSwitch, Toolbar,
  toTree, useErrorReporter, useLoaded,
} from '../ui.tsx'

/** Which dialog is open, and what it is about. */
type Dialog =
  | { readonly kind: 'add'; readonly parentId?: string }
  | { readonly kind: 'edit'; readonly menu: WireMenu }
  | { readonly kind: 'status'; readonly menu: WireMenu }
  | { readonly kind: 'delete'; readonly menu: WireMenu }

/** What the create and edit forms collect. */
interface MenuForm {
  name: string
  kind: 'catalog' | 'menu' | 'action'
  parentId?: string
  routePath?: string
  componentPath?: string
  permission?: string
  icon?: string
  sortOrder?: number
  visible: boolean
}

/** One row of the tree the table draws. */
type Row = WireMenu & { readonly children?: readonly Row[] }

/**
 * The navigation tree and everything an administrator does to it.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @returns the menus view.
 */
export function Menus({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const menus = useLoaded<WireMenu[]>(api.menus, report)
  const permissions = useLoaded<WirePermission[]>(api.permissions, report)
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)
  const [term, setTerm] = useState('')
  const [draftTerm, setDraftTerm] = useState('')
  const [status, setStatus] = useState<'active' | 'suspended' | undefined>(undefined)
  const [expanded, setExpanded] = useState<readonly string[] | undefined>(undefined)

  const mayManage = held.has('menu|menu.manage')

  /** Run one write, put its answer on screen, and close the dialog. */
  const act = async (write: () => Promise<WireMenu[]>): Promise<void> => {
    try {
      menus.replace(await write())
      setDialog(undefined)
    } catch (error) {
      report(error)
    }
  }

  const matching = (menus.data ?? []).filter((menu) => {
    const needle = term.trim().toLowerCase()
    const named = needle === '' || menuLabel(menu, t).toLowerCase().includes(needle)
    return named && (status === undefined || menu.status === status)
  })
  const rows = toTree<Row>(matching, menu => menu.id, menu => menu.parentId)

  const columns: ColumnsType<Row> = [
    {
      title: t('menus.name'),
      key: 'name',
      render: (_value, menu) => (
        <span>
          {menuLabel(menu, t)}
          {menu.shipped && (
            <Tag style={{ marginInlineStart: 8 }}>{t('menus.shipped')}</Tag>
          )}
        </span>
      ),
    },
    {
      title: t('menus.kind'),
      key: 'kind',
      render: (_value, menu) => (
        <Tag color={menu.kind === 'catalog' ? 'blue' : menu.kind === 'menu' ? 'green' : 'default'}>
          {t(`menus.${menu.kind}`)}
        </Tag>
      ),
    },
    {
      title: t('menus.route'),
      key: 'routePath',
      render: (_value, menu) => menu.routePath ?? t('menus.none'),
    },
    {
      title: t('menus.component'),
      key: 'componentPath',
      render: (_value, menu) => menu.componentPath ?? t('menus.none'),
    },
    {
      title: t('menus.permission'),
      key: 'permission',
      render: (_value, menu) => (menu.permission === undefined
        ? t('menus.none')
        : <Typography.Text code>{menu.permission}</Typography.Text>),
    },
    { title: t('menus.order'), key: 'sortOrder', render: (_value, menu) => menu.sortOrder },
    {
      title: t('menus.created'),
      key: 'createdAt',
      render: (_value, menu) => <Moment value={menu.createdAt} />,
    },
    {
      title: t('menus.status'),
      key: 'status',
      render: (_value, menu) => (
        <StatusSwitch
          active={menu.status === 'active'}
          disabled={!mayManage}
          onToggle={() => { setDialog({ kind: 'status', menu }) }}
        />
      ),
    },
    {
      title: t('menus.display'),
      key: 'visible',
      render: (_value, menu) => (
        <Tag color={menu.visible ? 'green' : 'default'}>
          {t(menu.visible ? 'menus.shown' : 'menus.hidden')}
        </Tag>
      ),
    },
    {
      title: t('action.actions'),
      key: 'actions',
      render: (_value, menu) => (
        <RowActions
          actions={[
            {
              key: 'child',
              label: t('menus.addChild'),
              disabled: !mayManage,
              onClick: () => { setDialog({ kind: 'add', parentId: menu.id }) },
            },
            {
              key: 'edit',
              label: t('action.edit'),
              disabled: !mayManage,
              onClick: () => { setDialog({ kind: 'edit', menu }) },
            },
            {
              key: 'delete',
              label: t('action.delete'),
              danger: true,
              disabled: !mayManage,
              onClick: () => { setDialog({ kind: 'delete', menu }) },
            },
          ]}
        />
      ),
    },
  ]

  const editing = dialog?.kind === 'edit' ? dialog.menu : undefined
  const parents = (menus.data ?? []).filter(menu => menu.id !== editing?.id && menu.kind !== 'action')

  return (
    <>
      <PageNote text={t('menus.description')} />
      <Toolbar
        filters={(
          <>
            <Input.Search
              allowClear
              value={draftTerm}
              placeholder={t('menus.searchPlaceholder')}
              style={{ width: 220 }}
              onChange={(event) => { setDraftTerm(event.target.value) }}
              onSearch={(value) => { setTerm(value) }}
            />
            <Select<'active' | 'suspended' | undefined>
              allowClear
              value={status}
              placeholder={t('filter.status')}
              style={{ width: 140 }}
              onChange={(value) => { setStatus(value) }}
              options={[
                { value: 'active', label: t('status.active') },
                { value: 'suspended', label: t('status.suspended') },
              ]}
            />
            <Button type="primary" onClick={() => { setTerm(draftTerm) }}>{t('filter.query')}</Button>
            <Button
              onClick={() => { setDraftTerm(''); setTerm(''); setStatus(undefined) }}
            >
              {t('filter.reset')}
            </Button>
          </>
        )}
        actions={(
          <>
            <Button onClick={() => { setExpanded(expanded === undefined ? [] : undefined) }}>
              {t(expanded === undefined ? 'filter.collapseAll' : 'filter.expandAll')}
            </Button>
            {mayManage && (
              <Button type="primary" onClick={() => { setDialog({ kind: 'add' }) }}>
                {t('filter.add')}
              </Button>
            )}
          </>
        )}
      />
      <Table<Row>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={rows}
        loading={menus.loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        expandable={{
          expandedRowKeys: expanded ?? matching.map(menu => menu.id),
          onExpandedRowsChange: (keys) => { setExpanded(keys as string[]) },
        }}
      />

      <FormModal<MenuForm>
        title={t(editing === undefined ? 'menus.addTitle' : 'menus.editTitle')}
        open={dialog?.kind === 'add' || dialog?.kind === 'edit'}
        okText={t(editing === undefined ? 'action.create' : 'action.save')}
        initialValues={editing === undefined
          ? {
            kind: 'menu',
            sortOrder: 1,
            visible: true,
            ...(dialog?.kind === 'add' && dialog.parentId !== undefined ? { parentId: dialog.parentId } : {}),
          }
          : {
            name: menuLabel(editing, t),
            kind: editing.kind,
            ...(editing.parentId === undefined ? {} : { parentId: editing.parentId }),
            ...(editing.routePath === undefined ? {} : { routePath: editing.routePath }),
            ...(editing.componentPath === undefined ? {} : { componentPath: editing.componentPath }),
            ...(editing.permission === undefined ? {} : { permission: editing.permission }),
            ...(editing.icon === undefined ? {} : { icon: editing.icon }),
            sortOrder: editing.sortOrder,
            visible: editing.visible,
          }}
        onCancel={() => { setDialog(undefined) }}
        onSubmit={values => act(() => (editing === undefined
          ? api.addMenu({
            name: values.name,
            kind: values.kind,
            ...(values.parentId === undefined ? {} : { parentId: values.parentId }),
            ...(values.routePath === undefined ? {} : { routePath: values.routePath }),
            ...(values.componentPath === undefined ? {} : { componentPath: values.componentPath }),
            ...(values.permission === undefined ? {} : { permission: values.permission }),
            ...(values.icon === undefined ? {} : { icon: values.icon }),
            ...(values.sortOrder === undefined ? {} : { sortOrder: values.sortOrder }),
            visible: values.visible,
          })
          // An edit sends every field the form holds, including the ones left
          // empty: an empty box is how this form says "clear what is stored".
          : api.updateMenu(editing.id, {
            name: values.name,
            kind: values.kind,
            routePath: values.routePath ?? '',
            componentPath: values.componentPath ?? '',
            permission: values.permission ?? '',
            icon: values.icon ?? '',
            ...(values.sortOrder === undefined ? {} : { sortOrder: values.sortOrder }),
            visible: values.visible,
          })))}
      >
        <Form.Item
          name="name"
          label={t('menus.name')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="kind" label={t('menus.kind')}>
          <Select
            options={[
              { value: 'catalog', label: t('menus.catalog') },
              { value: 'menu', label: t('menus.menu') },
              { value: 'action', label: t('menus.action') },
            ]}
          />
        </Form.Item>
        {editing === undefined && (
          <Form.Item name="parentId" label={t('menus.parent')}>
            <Select
              allowClear
              placeholder={t('menus.topLevel')}
              options={parents.map(menu => ({ value: menu.id, label: menuLabel(menu, t) }))}
            />
          </Form.Item>
        )}
        <Form.Item name="routePath" label={t('menus.route')}>
          <Input placeholder="/system/example" />
        </Form.Item>
        <Form.Item name="componentPath" label={t('menus.component')} extra={t('menus.componentHint')}>
          <Select
            allowClear
            options={CONSOLE_COMPONENTS.map(component => ({ value: component, label: component }))}
          />
        </Form.Item>
        <Form.Item name="permission" label={t('menus.permission')}>
          <Select
            allowClear
            showSearch
            placeholder={t('menus.noPermission')}
            options={(permissions.data ?? []).map(permission => ({
              value: `${permission.resourceType}|${permission.action}`,
              label: `${permission.resourceType} · ${permission.action}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="icon" label={t('menus.icon')}>
          <Select allowClear options={MENU_ICONS.map(icon => ({ value: icon, label: icon }))} />
        </Form.Item>
        <Form.Item name="sortOrder" label={t('menus.order')}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="visible" label={t('menus.display')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </FormModal>

      <ConfirmModal
        title={dialog?.kind === 'status'
          ? t(
            dialog.menu.status === 'active' ? 'menus.suspendTitle' : 'menus.activateTitle',
            { name: menuLabel(dialog.menu, t) },
          )
          : ''}
        body={dialog?.kind === 'status'
          ? t(dialog.menu.status === 'active' ? 'menus.suspendBody' : 'menus.activateBody')
          : ''}
        open={dialog?.kind === 'status'}
        danger={dialog?.kind === 'status' && dialog.menu.status === 'active'}
        onCancel={() => { setDialog(undefined) }}
        onConfirm={() => act(() => api.updateMenu(
          dialog?.kind === 'status' ? dialog.menu.id : '',
          { status: dialog?.kind === 'status' && dialog.menu.status === 'active' ? 'suspended' : 'active' },
        ))}
      />

      <ConfirmModal
        title={dialog?.kind === 'delete' ? t('menus.deleteTitle', { name: menuLabel(dialog.menu, t) }) : ''}
        body={dialog?.kind === 'delete' && dialog.menu.shipped
          ? t('menus.deleteShippedBody')
          : t('menus.deleteBody')}
        open={dialog?.kind === 'delete'}
        onCancel={() => { setDialog(undefined) }}
        onConfirm={() => act(() => api.removeMenu(dialog?.kind === 'delete' ? dialog.menu.id : ''))}
      />
    </>
  )
}
