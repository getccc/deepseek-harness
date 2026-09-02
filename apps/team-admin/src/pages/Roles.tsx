/**
 * Roles: what each one admits, who holds it, and the two ways to compose it —
 * by navigation entry, or by naming a permission from the catalog directly.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { Button, Form, Input, Space, Switch, Table, Tag, Tree, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { TreeDataNode } from 'antd'
import {
  api,
  type WireGrant,
  type WireKnowledgeAccess,
  type WireKnowledgeCatalog,
  type WireMenu,
  type WireModel,
  type WireRole,
} from '../api.ts'
import { useLocale } from '../locale.tsx'
import {
  ConfirmModal, FormModal, Moment, PageNote, People, RowActions, Toolbar,
  downloadCsv, useErrorReporter, useLoaded,
} from '../ui.tsx'
import { menuLabel } from '../menus.ts'

/**
 * The tree row standing for whole-catalog access.
 *
 * It is the parent of every knowledge base, so ticking it ticks them all and
 * `knowledgeChoice` reads that back as whole-catalog access; it is never a
 * value the Control Plane stores.
 */
const KNOWLEDGE_ALL_KEY = 'knowledge-all'

/** Which dialog is open, and what it is about. */
type Dialog =
  | { readonly kind: 'add' }
  | { readonly kind: 'edit'; readonly role: WireRole }
  | { readonly kind: 'menus'; readonly role: WireRole }
  | { readonly kind: 'models'; readonly role: WireRole }
  | { readonly kind: 'knowledge'; readonly role: WireRole }
  | { readonly kind: 'revoke'; readonly grant: WireGrant }
  | { readonly kind: 'delete'; readonly role: WireRole }

/** What the create and edit forms collect. */
interface RoleForm {
  name: string
  code?: string
  description?: string
  coversCatalog: boolean
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
function reachOf(
  role: WireRole,
): 'roles.dataScopeCatalog' | 'roles.dataScopeNone' | 'roles.dataScopeAll' | 'roles.dataScopeSelected' {
  if (role.coversCatalog) return 'roles.dataScopeCatalog'
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
  const menus = useLoaded<WireMenu[]>(api.menus, report)
  const mayReadModels = held.has('model|model.catalog.read')
  const models = useLoaded<WireModel[]>(
    useMemo(() => (): Promise<WireModel[]> =>
      (mayReadModels ? api.models() : Promise.resolve([])), [mayReadModels]),
    report,
  )
  const mayReadKnowledge = held.has('knowledge_scope|knowledge.catalog.read')
  const knowledge = useLoaded<WireKnowledgeCatalog>(
    useMemo(() => (): Promise<WireKnowledgeCatalog> => (mayReadKnowledge
      ? api.knowledgeBases()
      : Promise.resolve({ source: { sourceCode: '', providerKind: '', health: 'never-synced' }, knowledgeBases: [] })),
    [mayReadKnowledge]),
    report,
  )
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined)
  const [term, setTerm] = useState('')
  const [draftTerm, setDraftTerm] = useState('')
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [opened, setOpened] = useState<readonly string[]>([])

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

  /** The `resourceType|action` pairs one role holds across a whole type. */
  const typeGrantsOf = (role: WireRole): Set<string> => new Set(role.grants
    .filter(grant => grant.scope === 'type')
    .map(grant => `${grant.resourceType}|${grant.action}`))

  /**
   * The navigation as a tree, with the permission each entry declares beside
   * it. A group declares none and is shown but not checkable: it is where the
   * pages sit, not something a role can be given.
   */
  const menuNodes = (parentId: string | undefined): TreeDataNode[] =>
    (menus.data ?? [])
      .filter(menu => menu.parentId === parentId)
      .map(menu => ({
        key: menu.id,
        title: menu.permission === undefined
          ? menuLabel(menu, t)
          : `${menuLabel(menu, t)} — ${menu.permission}`,
        checkable: menu.permission !== undefined,
        children: menuNodes(menu.id),
      }))

  /** Open the menu-access dialog with the entries this role already reaches. */
  const openMenus = (role: WireRole): void => {
    const holds = typeGrantsOf(role)
    setChosen(grantable
      .filter(menu => holds.has(menu.permission as string))
      .map(menu => menu.id))
    // The groups start open, which the tree cannot do on its own: it is built
    // when the dialog opens, and its own `defaultExpandAll` ran at mount with
    // nothing to expand.
    setOpened((menus.data ?? []).filter(menu => menu.kind === 'catalog').map(menu => menu.id))
    setDialog({ kind: 'menus', role })
  }

  /** Open exact-model access with every model this role can currently discover. */
  const openModels = (role: WireRole): void => {
    const allModels = role.grants.some(grant =>
      grant.scope === 'type'
      && grant.resourceType === 'model'
      && grant.action === 'model.discover')
    const discovered = new Set(role.grants.flatMap(grant =>
      grant.scope === 'resource'
      && grant.resourceType === 'model'
      && grant.action === 'model.discover'
      && grant.resourceId !== undefined
        ? [grant.resourceId]
        : []))
    setChosen((models.data ?? [])
      .filter(model => allModels || discovered.has(model.resourceId))
      .map(model => model.resourceId))
    setDialog({ kind: 'models', role })
  }

  /** Open knowledge access with the mode this role's grants already describe. */
  const openKnowledge = (role: WireRole): void => {
    const all = role.grants.some(grant =>
      grant.scope === 'type'
      && grant.resourceType === 'knowledge_scope'
      && grant.action === 'knowledge.search')
    const exact = role.grants.flatMap(grant =>
      grant.scope === 'resource'
      && grant.resourceType === 'knowledge_scope'
      && grant.action === 'knowledge.search'
      && grant.resourceId !== undefined
        ? [grant.resourceId]
        : [])
    // Whole-catalog access opens with every row ticked, which is the same
    // picture an administrator would draw by hand and the same one `save`
    // reads back as whole-catalog access.
    // Only the leaves: the tree derives the whole-catalog row's own state from
    // its children, and `chosen` stays a list of knowledge bases throughout.
    setChosen(all ? (knowledge.data?.knowledgeBases ?? []).map(base => base.resourceId) : exact)
    setDialog({ kind: 'knowledge', role })
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
              key: 'models',
              label: t('roles.modelAccess'),
              disabled: !mayManageGrants || !mayReadModels,
              onClick: () => { openModels(role) },
            },
            {
              key: 'knowledge',
              label: t('knowledge.access.title'),
              disabled: !mayManageGrants || !mayReadKnowledge,
              onClick: () => { openKnowledge(role) },
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
  const showingMenus = dialog?.kind === 'menus' ? dialog.role : undefined
  const showingModels = dialog?.kind === 'models' ? dialog.role : undefined
  const showingKnowledge = dialog?.kind === 'knowledge' ? dialog.role : undefined
  /** Every knowledge base a role may still be newly given. */
  const selectableKnowledge = (knowledge.data?.knowledgeBases ?? [])
    .filter(base => base.remotePresent || chosen.includes(base.resourceId))

  /**
   * What the ticked rows ask the Control Plane to store.
   *
   * Ticking every knowledge base is stored as whole-catalog access rather than
   * as that list of names, so a knowledge base added tomorrow is included:
   * an administrator who ticked the top row asked for everything, not for the
   * four things that happened to exist while the dialog was open.
   * @returns the mode, and the references a selection names.
   */
  const knowledgeChoice = (): WireKnowledgeAccess => {
    const present = (knowledge.data?.knowledgeBases ?? []).filter(base => base.remotePresent)
    if (chosen.length === 0) return { mode: 'none' }
    if (present.every(base => chosen.includes(base.resourceId))) return { mode: 'all' }
    return {
      mode: 'selected',
      knowledgeRefs: selectableKnowledge
        .filter(base => chosen.includes(base.resourceId))
        .map(base => base.knowledgeRef),
    }
  }

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
          ? { coversCatalog: false }
          : {
            name: editing.name,
            code: editing.code,
            description: editing.description,
            coversCatalog: editing.coversCatalog,
          }}
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
            // Only sent when it changed: the field is grant management rather
            // than editing how the role reads, and the route asks for that
            // permission whenever the request carries it.
            ...(values.coversCatalog === editing.coversCatalog
              ? {}
              : { coversCatalog: values.coversCatalog }),
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
        <Form.Item
          name="coversCatalog"
          label={t('roles.coversCatalog')}
          valuePropName="checked"
          extra={t('roles.coversCatalogHint')}
        >
          {/* Creating a role does not carry this: a new role is composed after
              it exists, and widening one is grant management. */}
          <Switch disabled={editing === undefined || !mayManageGrants} />
        </Form.Item>
      </FormModal>

      <FormModal<Record<string, never>>
        title={t('roles.menuAccessTitle', { name: showingMenus?.name ?? '' })}
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
          expandedKeys={[...opened]}
          onExpand={(keys) => { setOpened(keys as string[]) }}
          checkedKeys={[...chosen]}
          // Each entry is checked on its own: a group and the pages under it
          // declare different permissions, and checking a group must not
          // silently grant every permission beneath it.
          checkStrictly
          onCheck={(keys) => {
            const checked = Array.isArray(keys) ? keys : keys.checked
            setChosen(checked as string[])
          }}
          treeData={menuNodes(undefined)}
        />
      </FormModal>

      <FormModal<Record<string, never>>
        title={t('knowledge.access.title')}
        open={dialog?.kind === 'knowledge'}
        okText={t('action.save')}
        onCancel={() => { setDialog(undefined) }}
        onSubmit={() => act(() => api.setRoleKnowledge(showingKnowledge?.id ?? '', knowledgeChoice()))}
      >
        <Typography.Paragraph type="secondary">{t('knowledge.access.hint')}</Typography.Paragraph>
        <Tree
          checkable
          selectable={false}
          defaultExpandAll
          checkedKeys={[...chosen]}
          onCheck={(keys) => {
            const checked = Array.isArray(keys) ? keys : keys.checked
            setChosen((checked as string[]).filter(key => key !== KNOWLEDGE_ALL_KEY))
          }}
          treeData={[{
            key: KNOWLEDGE_ALL_KEY,
            title: t('knowledge.access.all'),
            children: selectableKnowledge.map(base => ({
              key: base.resourceId,
              title: base.remotePresent
                ? base.displayName
                : `${base.displayName} — ${t('knowledge.access.missing')}`,
              // A knowledge base the source no longer lists stays visible while
              // it is already chosen, so an administrator can see why a role's
              // access became unusable, but cannot newly pick it.
              disabled: !base.remotePresent,
            })),
          }]}
        />
      </FormModal>

      <FormModal<Record<string, never>>
        title={t('roles.modelAccessTitle', { name: showingModels?.name ?? '' })}
        open={dialog?.kind === 'models'}
        okText={t('action.save')}
        onCancel={() => { setDialog(undefined) }}
        onSubmit={() => act(() => api.setRoleModels(
          dialog?.kind === 'models' ? dialog.role.id : '',
          chosen,
        ))}
      >
        <Typography.Paragraph type="secondary">{t('roles.modelAccessHint')}</Typography.Paragraph>
        <Tree
          checkable
          selectable={false}
          defaultExpandAll
          checkedKeys={[...chosen]}
          onCheck={(keys) => {
            const checked = Array.isArray(keys) ? keys : keys.checked
            setChosen((checked as string[]).filter(key => key !== 'model-resources'))
          }}
          treeData={[{
            key: 'model-resources',
            title: t('roles.modelResource'),
            children: (models.data ?? []).map(model => ({
              key: model.resourceId,
              title: `${model.displayName} (${model.modelRef})`,
              disabled: model.status !== 'active',
            })),
          }]}
        />
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
