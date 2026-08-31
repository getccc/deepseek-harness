/**
 * The user directory: identities, profiles, sign-in status, and role bindings,
 * narrowed by the department tree beside them.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Avatar, Button, DatePicker, Form, Input, Select, Space, Table, Tag, Tree, Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import { api, type WireDepartment, type WireMember, type WireOrganization, type WireRole } from '../api.ts'
import { useLocale } from '../locale.tsx'
import {
  ConfirmModal, FormModal, Moment, PageNote, RowActions, StatusSwitch, StatusTag, Toolbar,
  downloadCsv, useErrorReporter, useLoaded,
} from '../ui.tsx'

/** Which dialog is open, and what it is about. */
type Dialog =
  | { readonly kind: 'add' }
  | { readonly kind: 'edit'; readonly member: WireMember }
  | { readonly kind: 'bind'; readonly member: WireMember }
  | { readonly kind: 'unbind'; readonly member: WireMember; readonly roleId: string; readonly roleName: string }
  | { readonly kind: 'status'; readonly member: WireMember }
  | { readonly kind: 'delete'; readonly member: WireMember }

/** What the create and edit forms collect. */
interface MemberForm {
  loginName: string
  displayName: string
  email?: string
  phone?: string
  gender?: 'male' | 'female' | 'unspecified'
  departmentId?: string
}

/** The filters the toolbar holds. */
interface Filters {
  readonly term: string
  readonly phone: string
  readonly status: 'active' | 'suspended' | undefined
  readonly from: Dayjs | undefined
  readonly to: Dayjs | undefined
}

const NO_FILTERS: Filters = { term: '', phone: '', status: undefined, from: undefined, to: undefined }

/** The key the tree uses for "every department, and the accounts in none". */
const ALL_DEPARTMENTS = ''

/**
 * The member directory and everything an administrator does to it.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @param props.signedInId - the account this session belongs to, which it cannot delete.
 * @returns the users view.
 */
export function Members({
  held, signedInId,
}: { readonly held: ReadonlySet<string>; readonly signedInId: string }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const members = useLoaded<WireMember[]>(api.members, report)
  const roles = useLoaded<WireRole[]>(api.roles, report)
  const mayReadDepartments = held.has('department|department.read')
  const departments = useLoaded<WireDepartment[]>(
    useMemo(() => (): Promise<WireDepartment[]> =>
      (mayReadDepartments ? api.departments() : Promise.resolve([])), [mayReadDepartments]),
    report,
  )
  const organization = useLoaded<WireOrganization>(api.organization, report)

  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [draft, setDraft] = useState<Filters>(NO_FILTERS)
  const [department, setDepartment] = useState<string>(ALL_DEPARTMENTS)
  const [expanded, setExpanded] = useState<readonly string[]>([])

  const mayCreate = held.has('member|member.create')
  const mayUpdate = held.has('member|member.update')
  const mayDelete = held.has('member|member.delete')
  const mayBind = held.has('member|member.role.bind')
  const mayDisable = held.has('member|member.disable')
  const mayEnable = held.has('member|member.enable')

  // The tree starts fully open, which it cannot do at mount: the organization
  // and its departments are still being read then, and there is nothing to open.
  useEffect(() => {
    if (organization.data === undefined) return
    setExpanded([ALL_DEPARTMENTS, organization.data.id])
  }, [organization.data])

  /** Run one write, put its answer on screen, and close the dialog. */
  const act = async (write: () => Promise<WireMember[]>): Promise<void> => {
    try {
      members.replace(await write())
      setDialog(undefined)
    } catch (error) {
      report(error)
    }
  }

  const matching = (members.data ?? []).filter((member) => {
    const term = filters.term.trim().toLowerCase()
    const named = term === ''
      || member.loginName.toLowerCase().includes(term)
      || member.displayName.toLowerCase().includes(term)
      || (member.email ?? '').toLowerCase().includes(term)
    const phoned = filters.phone.trim() === '' || (member.phone ?? '').includes(filters.phone.trim())
    const staged = filters.status === undefined || member.status === filters.status
    const after = filters.from === undefined || member.createdAt >= filters.from.startOf('day').valueOf()
    const before = filters.to === undefined || member.createdAt <= filters.to.endOf('day').valueOf()
    const placed = department === ALL_DEPARTMENTS || member.departmentId === department
    return named && phoned && staged && after && before && placed
  })

  const everyBranch = [
    ALL_DEPARTMENTS,
    ...(organization.data === undefined ? [] : [organization.data.id]),
  ]

  const treeData = [{
    key: ALL_DEPARTMENTS,
    title: t('members.allDepartments'),
    children: organization.data === undefined ? [] : [{
      key: organization.data.id,
      title: organization.data.name,
      selectable: false,
      children: (departments.data ?? []).map(entry => ({
        key: entry.id,
        title: entry.name,
        // The tree is one level of departments under the organization: the
        // list arrives parents-first, and a nested picker would hide a child
        // department behind a parent nobody is filtering by.
        children: [],
      })),
    }],
  }]

  const columns: ColumnsType<WireMember> = [
    {
      title: t('members.user'),
      key: 'identity',
      render: (_value, member) => (
        <Space>
          <Avatar size={28}>{Array.from(member.displayName)[0]}</Avatar>
          <span>
            {member.displayName}
            <Typography.Text type="secondary">{` (${member.loginName})`}</Typography.Text>
          </span>
        </Space>
      ),
    },
    {
      title: t('members.phone'),
      key: 'phone',
      render: (_value, member) => member.phone ?? t('common.none'),
    },
    {
      title: t('members.email'),
      key: 'email',
      render: (_value, member) => member.email ?? t('common.none'),
    },
    {
      title: t('members.gender'),
      key: 'gender',
      render: (_value, member) => (member.gender === undefined
        ? t('common.none')
        : t(`members.${member.gender}`)),
    },
    {
      title: t('members.department'),
      key: 'department',
      render: (_value, member) => member.departmentName ?? t('members.noDepartment'),
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
                color="blue"
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
      title: t('members.status'),
      key: 'status',
      render: (_value, member) => ((member.status === 'active' ? mayDisable : mayEnable)
        ? (
          <StatusSwitch
            active={member.status === 'active'}
            disabled={false}
            onToggle={() => { setDialog({ kind: 'status', member }) }}
          />
        )
        : <StatusTag value={member.status} />),
    },
    {
      title: t('action.actions'),
      key: 'actions',
      render: (_value, member) => (
        <RowActions
          actions={[
            {
              key: 'edit',
              label: t('action.edit'),
              disabled: !mayUpdate,
              onClick: () => { setDialog({ kind: 'edit', member }) },
            },
            {
              key: 'bind',
              label: t('members.bindRole'),
              disabled: !mayBind,
              onClick: () => { setDialog({ kind: 'bind', member }) },
            },
            {
              key: 'delete',
              label: t('action.delete'),
              danger: true,
              // Deleting the account this session belongs to would end the
              // session carrying out the request, so the control says so here
              // rather than letting the Control Plane refuse it.
              disabled: !mayDelete || member.id === signedInId,
              onClick: () => { setDialog({ kind: 'delete', member }) },
            },
          ]}
        />
      ),
    },
  ]

  const editing = dialog?.kind === 'edit' ? dialog.member : undefined
  const bindable = dialog?.kind === 'bind'
    ? (roles.data ?? []).filter(role => !dialog.member.roles.some(bound => bound.id === role.id))
    : []
  const departmentOptions = (departments.data ?? []).map(entry => ({ value: entry.id, label: entry.name }))
  const genderOptions = (['male', 'female', 'unspecified'] as const)
    .map(value => ({ value, label: t(`members.${value}`) }))

  return (
    <>
      <PageNote text={t('members.description')} />
      <div className="split">
        <aside className="split-aside">
          <div className="split-aside-head">
            <span>{t('members.orgTree')}</span>
            <Button
              type="link"
              size="small"
              onClick={() => { setExpanded(expanded.length === 0 ? everyBranch : []) }}
            >
              {t(expanded.length === 0 ? 'filter.expandAll' : 'filter.collapseAll')}
            </Button>
          </div>
          <Tree
            blockNode
            expandedKeys={[...expanded]}
            selectedKeys={[department]}
            treeData={treeData}
            onExpand={(keys) => { setExpanded(keys as string[]) }}
            onSelect={(keys) => { setDepartment((keys[0] ?? ALL_DEPARTMENTS) as string) }}
          />
        </aside>
        <div className="split-main">
          <Toolbar
            filters={(
              <>
                <Input.Search
                  allowClear
                  value={draft.term}
                  placeholder={t('members.searchPlaceholder')}
                  style={{ width: 220 }}
                  onChange={(event) => { setDraft({ ...draft, term: event.target.value }) }}
                  onSearch={(value) => { setFilters({ ...draft, term: value }) }}
                />
                <Input
                  allowClear
                  value={draft.phone}
                  placeholder={t('members.searchPhone')}
                  style={{ width: 180 }}
                  onChange={(event) => { setDraft({ ...draft, phone: event.target.value }) }}
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
                <DatePicker.RangePicker
                  value={draft.from === undefined || draft.to === undefined
                    ? null
                    : [draft.from, draft.to]}
                  placeholder={[t('filter.startTime'), t('filter.endTime')]}
                  onChange={(range) => {
                    setDraft({
                      ...draft,
                      from: range?.[0] ?? undefined,
                      to: range?.[1] ?? undefined,
                    })
                  }}
                />
                <Button type="primary" onClick={() => { setFilters(draft) }}>{t('filter.query')}</Button>
                <Button onClick={() => { setDraft(NO_FILTERS); setFilters(NO_FILTERS) }}>
                  {t('filter.reset')}
                </Button>
              </>
            )}
            actions={(
              <>
                <Button
                  onClick={() => {
                    downloadCsv(
                      'users',
                      [
                        t('members.loginName'), t('members.displayName'), t('members.phone'),
                        t('members.email'), t('members.gender'), t('members.department'),
                        t('members.roles'), t('members.status'),
                      ],
                      matching.map(member => [
                        member.loginName, member.displayName, member.phone ?? '', member.email ?? '',
                        member.gender ?? '', member.departmentName ?? '',
                        member.roles.map(role => role.name).join(' / '), member.status,
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
          <Table<WireMember>
            rowKey="id"
            size="middle"
            columns={columns}
            dataSource={matching}
            loading={members.loading}
            scroll={{ x: 'max-content' }}
            pagination={{
              defaultPageSize: 10,
              showSizeChanger: true,
              showTotal: (total, range) => t('table.range', {
                from: range[0], to: range[1], total,
              }),
            }}
          />
        </div>
      </div>

      <FormModal<MemberForm>
        title={t(editing === undefined ? 'members.addTitle' : 'members.editTitle')}
        open={dialog?.kind === 'add' || dialog?.kind === 'edit'}
        okText={t(editing === undefined ? 'action.create' : 'action.save')}
        initialValues={editing === undefined
          ? {}
          : {
            loginName: editing.loginName,
            displayName: editing.displayName,
            ...(editing.email === undefined ? {} : { email: editing.email }),
            ...(editing.phone === undefined ? {} : { phone: editing.phone }),
            ...(editing.gender === undefined ? {} : { gender: editing.gender }),
            ...(editing.departmentId === undefined ? {} : { departmentId: editing.departmentId }),
          }}
        onCancel={() => { setDialog(undefined) }}
        onSubmit={values => act(() => (editing === undefined
          ? api.addMember({
            loginName: values.loginName,
            displayName: values.displayName,
            ...(values.email === undefined || values.email === '' ? {} : { email: values.email }),
            ...(values.phone === undefined || values.phone === '' ? {} : { phone: values.phone }),
            ...(values.gender === undefined ? {} : { gender: values.gender }),
            ...(values.departmentId === undefined ? {} : { departmentId: values.departmentId }),
          })
          // An edit sends every field the form holds, including the ones left
          // empty: an empty box is how this form says "clear what is stored".
          : api.updateMember(editing.id, {
            displayName: values.displayName,
            email: values.email ?? '',
            phone: values.phone ?? '',
            gender: values.gender ?? '',
            departmentId: values.departmentId ?? '',
          })))}
      >
        {editing === undefined && (
          <Typography.Paragraph type="secondary">{t('members.addHint')}</Typography.Paragraph>
        )}
        <Form.Item
          name="loginName"
          label={t('members.loginName')}
          rules={[{ required: true, message: t('login.required') }]}
        >
          {/* The login name is what a sign-in resolves against and what audit
              records name, so an edit shows it and cannot change it. */}
          <Input disabled={editing !== undefined} />
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
        <Form.Item name="phone" label={`${t('members.phone')} (${t('members.optional')})`}>
          <Input />
        </Form.Item>
        <Form.Item name="gender" label={t('members.gender')}>
          <Select allowClear options={genderOptions} />
        </Form.Item>
        <Form.Item name="departmentId" label={t('members.department')}>
          <Select allowClear placeholder={t('members.noDepartment')} options={departmentOptions} />
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
        title={dialog?.kind === 'delete'
          ? t('members.deleteTitle', { name: dialog.member.displayName })
          : ''}
        body={t('members.deleteBody')}
        open={dialog?.kind === 'delete'}
        onCancel={() => { setDialog(undefined) }}
        onConfirm={() => act(() => api.removeMember(dialog?.kind === 'delete' ? dialog.member.id : ''))}
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
