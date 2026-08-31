/**
 * The department tree: the organization at the root, and the departments an
 * administrator hangs from it.
 *
 * The organization is a row rather than a page of its own, because it is the
 * company node every department sits under and because renaming it is the one
 * edit it has.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Button, Form, Input, InputNumber, Select, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { api, type WireDepartment, type WireMember, type WireOrganization } from '../api.ts'
import { useLocale } from '../locale.tsx'
import {
  ConfirmModal, FormModal, Moment, PageNote, People, RowActions, StatusSwitch, Toolbar,
  downloadCsv, toTree, useErrorReporter, useLoaded,
} from '../ui.tsx'

/** One row of the tree: the organization itself, or one department. */
interface Row {
  readonly key: string
  readonly name: string
  readonly code: string | undefined
  readonly category: 'company' | 'department'
  readonly leaderName: string | undefined
  readonly phone: string | undefined
  readonly email: string | undefined
  readonly sortOrder: number | undefined
  readonly memberNames: readonly string[]
  readonly createdAt: number
  readonly status: 'active' | 'suspended' | undefined
  /** The department this row stands for; absent on the organization's own row. */
  readonly department?: WireDepartment
  readonly children?: readonly Row[]
}

/** What the create and edit forms collect. */
interface DepartmentForm {
  name: string
  code: string
  parentId?: string
  category: 'company' | 'department'
  leaderId?: string
  phone?: string
  email?: string
  sortOrder?: number
}

/** Which dialog is open, and what it is about. */
type Dialog =
  | { readonly kind: 'add'; readonly parentId?: string }
  | { readonly kind: 'edit'; readonly department: WireDepartment }
  | { readonly kind: 'rename' }
  | { readonly kind: 'status'; readonly department: WireDepartment }
  | { readonly kind: 'delete'; readonly department: WireDepartment }

/** The filters the toolbar holds. */
interface Filters {
  readonly term: string
  readonly status: 'active' | 'suspended' | undefined
}

const NO_FILTERS: Filters = { term: '', status: undefined }

/**
 * The department tree and everything an administrator does to it.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @returns the departments view.
 */
export function Departments({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const mayManage = held.has('department|department.manage')
  const mayRename = held.has('organization|organization.settings.manage')
  const mayReadMembers = held.has('member|member.read')

  const organization = useLoaded<WireOrganization>(api.organization, report)
  const departments = useLoaded<WireDepartment[]>(api.departments, report)
  // The leader of a department is an account, so the form needs the directory.
  // A member who may read the chart without reading accounts still gets the
  // page; the leader they cannot name is the one control that stays empty.
  const members = useLoaded<WireMember[]>(
    useMemo(() => (): Promise<WireMember[]> => (mayReadMembers ? api.members() : Promise.resolve([])), [mayReadMembers]),
    report,
  )

  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [draft, setDraft] = useState<Filters>(NO_FILTERS)
  const [expanded, setExpanded] = useState<readonly string[] | undefined>(undefined)

  /** Run one write, put its answer on screen, and close the dialog. */
  const act = async (write: () => Promise<WireDepartment[]>): Promise<void> => {
    try {
      departments.replace(await write())
      setDialog(undefined)
    } catch (error) {
      report(error)
    }
  }

  const matching = (departments.data ?? []).filter((department) => {
    const term = filters.term.trim().toLowerCase()
    const named = term === ''
      || department.name.toLowerCase().includes(term)
      || department.code.toLowerCase().includes(term)
    return named && (filters.status === undefined || department.status === filters.status)
  })

  const unassigned = (members.data ?? [])
    .filter(member => member.departmentId === undefined)
    .map(member => member.displayName)

  const rows: Row[] = organization.data === undefined ? [] : [{
    key: organization.data.id,
    name: organization.data.name,
    code: undefined,
    category: 'company',
    leaderName: undefined,
    phone: undefined,
    email: undefined,
    sortOrder: undefined,
    memberNames: unassigned,
    createdAt: organization.data.createdAt,
    status: undefined,
    children: toTree<Row>(
      matching.map(department => ({
        key: department.id,
        name: department.name,
        code: department.code,
        category: department.category,
        leaderName: department.leaderName,
        phone: department.phone,
        email: department.email,
        sortOrder: department.sortOrder,
        memberNames: department.memberNames,
        createdAt: department.createdAt,
        status: department.status,
        department,
      })),
      row => row.key,
      row => row.department?.parentId,
    ),
  }]

  const everyKey = [
    ...(organization.data === undefined ? [] : [organization.data.id]),
    ...matching.map(department => department.id),
  ]

  const columns: ColumnsType<Row> = [
    { title: t('departments.name'), key: 'name', render: (_value, row) => row.name },
    {
      title: t('departments.code'),
      key: 'code',
      render: (_value, row) => row.code ?? t('common.none'),
    },
    {
      title: t('departments.category'),
      key: 'category',
      render: (_value, row) => (
        <Tag color={row.category === 'company' ? 'blue' : 'green'}>
          {t(row.category === 'company' ? 'departments.company' : 'departments.department')}
        </Tag>
      ),
    },
    {
      title: t('departments.leader'),
      key: 'leader',
      render: (_value, row) => row.leaderName ?? t('common.none'),
    },
    {
      title: t('departments.phone'),
      key: 'phone',
      render: (_value, row) => row.phone ?? t('common.none'),
    },
    {
      title: t('departments.email'),
      key: 'email',
      render: (_value, row) => row.email ?? t('common.none'),
    },
    {
      title: t('departments.order'),
      key: 'sortOrder',
      render: (_value, row) => row.sortOrder ?? t('common.none'),
    },
    {
      title: t('departments.members'),
      key: 'members',
      render: (_value, row) => <People names={row.memberNames} empty="0" />,
    },
    {
      title: t('departments.created'),
      key: 'createdAt',
      render: (_value, row) => <Moment value={row.createdAt} />,
    },
    {
      title: t('departments.status'),
      key: 'status',
      render: (_value, row) => (row.department === undefined
        ? null
        : (
          <StatusSwitch
            active={row.status === 'active'}
            disabled={!mayManage}
            onToggle={() => { setDialog({ kind: 'status', department: row.department as WireDepartment }) }}
          />
        )),
    },
    {
      title: t('action.actions'),
      key: 'actions',
      render: (_value, row) => (row.department === undefined
        ? (
          <RowActions
            actions={[{
              key: 'rename',
              label: t('action.edit'),
              disabled: !mayRename,
              onClick: () => { setDialog({ kind: 'rename' }) },
            }]}
          />
        )
        : (
          <RowActions
            actions={[
              {
                key: 'edit',
                label: t('action.edit'),
                disabled: !mayManage,
                onClick: () => { setDialog({ kind: 'edit', department: row.department as WireDepartment }) },
              },
              {
                key: 'delete',
                label: t('action.delete'),
                danger: true,
                disabled: !mayManage,
                onClick: () => { setDialog({ kind: 'delete', department: row.department as WireDepartment }) },
              },
            ]}
          />
        )),
    },
  ]

  const editing = dialog?.kind === 'edit' ? dialog.department : undefined
  const parents = (departments.data ?? []).filter(department => department.id !== editing?.id)

  return (
    <>
      <PageNote text={t('departments.description')} />
      <Toolbar
        filters={(
          <>
            <Input.Search
              allowClear
              value={draft.term}
              placeholder={t('departments.searchPlaceholder')}
              style={{ width: 240 }}
              onChange={(event) => { setDraft({ ...draft, term: event.target.value }) }}
              onSearch={(value) => { setFilters({ ...draft, term: value }) }}
            />
            <Select<'active' | 'suspended' | undefined>
              allowClear
              value={draft.status}
              placeholder={t('filter.status')}
              style={{ width: 150 }}
              onChange={(value) => { setDraft({ ...draft, status: value }) }}
              options={[
                { value: 'active', label: t('status.active') },
                { value: 'suspended', label: t('status.suspended') },
              ]}
            />
            <Button type="primary" onClick={() => { setFilters(draft) }}>{t('filter.query')}</Button>
            <Button onClick={() => { setDraft(NO_FILTERS); setFilters(NO_FILTERS) }}>
              {t('filter.reset')}
            </Button>
          </>
        )}
        actions={(
          <>
            <Button onClick={() => { setExpanded(expanded === undefined ? [] : undefined) }}>
              {t(expanded === undefined ? 'filter.collapseAll' : 'filter.expandAll')}
            </Button>
            <Button
              onClick={() => {
                downloadCsv(
                  'departments',
                  [
                    t('departments.name'), t('departments.code'), t('departments.category'),
                    t('departments.leader'), t('departments.phone'), t('departments.email'),
                    t('departments.order'), t('departments.members'), t('departments.status'),
                  ],
                  matching.map(department => [
                    department.name, department.code, department.category,
                    department.leaderName ?? '', department.phone ?? '', department.email ?? '',
                    String(department.sortOrder), String(department.memberCount), department.status,
                  ]),
                )
              }}
            >
              {t('filter.export')}
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
        rowKey="key"
        size="middle"
        columns={columns}
        dataSource={rows}
        loading={departments.loading || organization.loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        expandable={{
          expandedRowKeys: expanded ?? everyKey,
          onExpandedRowsChange: (keys) => { setExpanded(keys as string[]) },
        }}
      />

      <FormModal<{ name: string }>
        title={t('organization.renameTitle')}
        open={dialog?.kind === 'rename'}
        okText={t('action.save')}
        initialValues={{ name: organization.data?.name ?? '' }}
        onCancel={() => { setDialog(undefined) }}
        onSubmit={async (values) => {
          try {
            organization.replace(await api.renameOrganization(values.name))
            setDialog(undefined)
          } catch (error) {
            report(error)
          }
        }}
      >
        <Typography.Paragraph type="secondary">{t('departments.organizationHint')}</Typography.Paragraph>
        <Form.Item
          name="name"
          label={t('organization.displayName')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          <Input />
        </Form.Item>
      </FormModal>

      <FormModal<DepartmentForm>
        title={t(dialog?.kind === 'edit' ? 'departments.editTitle' : 'departments.addTitle')}
        open={dialog?.kind === 'add' || dialog?.kind === 'edit'}
        okText={t(dialog?.kind === 'edit' ? 'action.save' : 'action.create')}
        initialValues={editing === undefined
          ? {
            category: 'department',
            sortOrder: 1,
            ...(dialog?.kind === 'add' && dialog.parentId !== undefined ? { parentId: dialog.parentId } : {}),
          }
          : {
            name: editing.name,
            code: editing.code,
            category: editing.category,
            ...(editing.parentId === undefined ? {} : { parentId: editing.parentId }),
            ...(editing.leaderId === undefined ? {} : { leaderId: editing.leaderId }),
            ...(editing.phone === undefined ? {} : { phone: editing.phone }),
            ...(editing.email === undefined ? {} : { email: editing.email }),
            sortOrder: editing.sortOrder,
          }}
        onCancel={() => { setDialog(undefined) }}
        onSubmit={values => act(() => (editing === undefined
          ? api.addDepartment({
            name: values.name,
            code: values.code,
            category: values.category,
            ...(values.parentId === undefined ? {} : { parentId: values.parentId }),
            ...(values.leaderId === undefined ? {} : { leaderId: values.leaderId }),
            ...(values.phone === undefined ? {} : { phone: values.phone }),
            ...(values.email === undefined ? {} : { email: values.email }),
            ...(values.sortOrder === undefined ? {} : { sortOrder: values.sortOrder }),
          })
          // An edit sends every field the form holds, including the ones left
          // empty: an empty box is how this form says "clear what is stored".
          : api.updateDepartment(editing.id, {
            name: values.name,
            code: values.code,
            category: values.category,
            leaderId: values.leaderId ?? '',
            phone: values.phone ?? '',
            email: values.email ?? '',
            ...(values.sortOrder === undefined ? {} : { sortOrder: values.sortOrder }),
          })))}
      >
        <Form.Item
          name="name"
          label={t('departments.name')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="code"
          label={t('departments.code')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          <Input placeholder={t('departments.codePlaceholder')} />
        </Form.Item>
        {editing === undefined && (
          <Form.Item name="parentId" label={t('departments.parent')}>
            <Select
              allowClear
              placeholder={t('departments.topLevel')}
              options={parents.map(department => ({ value: department.id, label: department.name }))}
            />
          </Form.Item>
        )}
        <Form.Item name="category" label={t('departments.category')}>
          <Select
            options={[
              { value: 'department', label: t('departments.department') },
              { value: 'company', label: t('departments.company') },
            ]}
          />
        </Form.Item>
        <Form.Item name="leaderId" label={t('departments.leader')}>
          <Select
            allowClear
            showSearch={{ optionFilterProp: 'label' }}
            placeholder={t('departments.noLeader')}
            options={(members.data ?? []).map(member => ({
              value: member.id,
              label: `${member.displayName} (${member.loginName})`,
            }))}
          />
        </Form.Item>
        <Form.Item name="phone" label={t('departments.phone')}>
          <Input />
        </Form.Item>
        <Form.Item name="email" label={t('departments.email')}>
          <Input type="email" />
        </Form.Item>
        <Form.Item name="sortOrder" label={t('departments.order')}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      </FormModal>

      <ConfirmModal
        title={dialog?.kind === 'status'
          ? t(
            dialog.department.status === 'active' ? 'departments.suspendTitle' : 'departments.activateTitle',
            { name: dialog.department.name },
          )
          : ''}
        body={dialog?.kind === 'status'
          ? t(dialog.department.status === 'active' ? 'departments.suspendBody' : 'departments.activateBody')
          : ''}
        open={dialog?.kind === 'status'}
        danger={dialog?.kind === 'status' && dialog.department.status === 'active'}
        onCancel={() => { setDialog(undefined) }}
        onConfirm={() => act(() => api.updateDepartment(
          dialog?.kind === 'status' ? dialog.department.id : '',
          { status: dialog?.kind === 'status' && dialog.department.status === 'active' ? 'suspended' : 'active' },
        ))}
      />

      <ConfirmModal
        title={dialog?.kind === 'delete' ? t('departments.deleteTitle', { name: dialog.department.name }) : ''}
        body={t('departments.deleteBody')}
        open={dialog?.kind === 'delete'}
        onCancel={() => { setDialog(undefined) }}
        onConfirm={() => act(() => api.removeDepartment(
          dialog?.kind === 'delete' ? dialog.department.id : '',
        ))}
      />
    </>
  )
}
