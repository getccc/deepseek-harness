/**
 * The console shell: who is signed in, which pages they can open, and the tabs
 * they have open right now.
 *
 * Navigation is not a list in this file. It is the organization's own stored
 * tree, read once at start: an administrator reorders, renames, hides, and adds
 * to it in the menus page, and this shell draws whatever it says. What this
 * file fixes is the two vocabularies that tree points into — the page
 * components this build ships and the icons it can draw.
 *
 * The session is read once at start. A browser with none sees the sign-in card
 * and nothing else, because every other view would only be refused.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ApiOutlined,
  AppstoreOutlined,
  BankOutlined,
  DashboardOutlined,
  LaptopOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import {
  App as AntApp, Button, ConfigProvider, Empty, Layout, Menu as AntMenu, Select, Space, Spin,
  Tabs, Typography, theme,
} from 'antd'
import { api, holdCsrf, type WireMenu, type WireSession } from './api.ts'
import { LOCALE_IDS, useLocale, type LocaleId } from './locale.tsx'
import { menuLabel, reachableMenus, type ConsoleComponent, type MenuIcon } from './menus.ts'
import { Departments } from './pages/Departments.tsx'
import { Devices } from './pages/Devices.tsx'
import { Login } from './pages/Login.tsx'
import { Members } from './pages/Members.tsx'
import { Menus } from './pages/Menus.tsx'
import { Models } from './pages/Models.tsx'
import { Overview } from './pages/Overview.tsx'
import { Roles } from './pages/Roles.tsx'
import { useErrorReporter, useLoaded } from './ui.tsx'

/** What every page component this build ships is given. */
interface ViewProps {
  readonly held: ReadonlySet<string>
  /** The account this session belongs to, which some acts refuse to touch. */
  readonly signedInId: string
}

/**
 * The page components this build ships, by the path a stored entry names.
 *
 * The keys are the whole of what a `componentPath` may be. An entry naming
 * anything else is navigation to a page this build does not have, and the shell
 * says so where the page would go.
 */
const VIEWS: Record<ConsoleComponent, (props: ViewProps) => ReactNode> = {
  'dashboard/OverviewPage': () => <Overview />,
  'system/DepartmentsPage': ({ held }) => <Departments held={held} />,
  'system/UsersPage': ({ held, signedInId }) => <Members held={held} signedInId={signedInId} />,
  'system/RolesPage': ({ held }) => <Roles held={held} />,
  'system/MenusPage': ({ held }) => <Menus held={held} />,
  'resources/DevicesPage': ({ held }) => <Devices held={held} />,
  'resources/ModelsPage': ({ held }) => <Models held={held} />,
}

/** The icons this build draws, by the name a stored entry gives. */
const ICONS: Record<MenuIcon, ReactNode> = {
  dashboard: <DashboardOutlined />,
  setting: <SettingOutlined />,
  bank: <BankOutlined />,
  team: <TeamOutlined />,
  safety: <SafetyCertificateOutlined />,
  menu: <MenuOutlined />,
  appstore: <AppstoreOutlined />,
  laptop: <LaptopOutlined />,
  api: <ApiOutlined />,
}

/** Width below which the sider is an icon rail, matching Ant Design's `lg`. */
const RAIL_QUERY = '(max-width: 991px)'

/**
 * Whether this viewport is too narrow for the full sider.
 *
 * One media query drives both the sider's width and what it renders. Ant
 * Design's own `breakpoint` prop collapses the element without telling the
 * component, which leaves the expanded brand block wrapped inside a rail.
 * @returns true while the viewport is at rail width.
 */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => globalThis.matchMedia(RAIL_QUERY).matches)
  useEffect(() => {
    const query = globalThis.matchMedia(RAIL_QUERY)
    const follow = (event: MediaQueryListEvent): void => { setNarrow(event.matches) }
    query.addEventListener('change', follow)
    setNarrow(query.matches)
    return () => { query.removeEventListener('change', follow) }
  }, [])
  return narrow
}

/**
 * The page one open tab shows.
 * @param props.menu - the navigation entry the tab stands for.
 * @param props.held - the `resourceType|action` pairs this member holds.
 * @param props.signedInId - the account this session belongs to.
 * @returns the page, or what to say in place of a page this build does not have.
 */
function View({
  menu, held, signedInId,
}: {
  readonly menu: WireMenu
  readonly held: ReadonlySet<string>
  readonly signedInId: string
}): ReactNode {
  const { t } = useLocale()
  const render = menu.componentPath === undefined
    ? undefined
    : VIEWS[menu.componentPath as ConsoleComponent]
  if (render === undefined) {
    return (
      <Empty
        description={(
          <>
            <div>{t('shell.unknownView')}</div>
            <Typography.Text type="secondary">
              {t('shell.unknownViewBody', { path: menu.componentPath ?? t('menus.none') })}
            </Typography.Text>
          </>
        )}
      />
    )
  }
  return render({ held, signedInId })
}

/**
 * The signed-in console.
 * @param props.session - who is signed in and what they hold.
 * @param props.onSignedOut - called once this session has ended.
 * @returns the console layout.
 */
function Console({
  session, onSignedOut,
}: { readonly session: WireSession; readonly onSignedOut: () => void }): ReactNode {
  const { t, locale, setLocale } = useLocale()
  const report = useErrorReporter()
  const held = useMemo(() => new Set(session.permissions), [session.permissions])
  const menus = useLoaded<WireMenu[]>(api.menus, report)
  const narrow = useNarrowViewport()
  const [folded, setFolded] = useState(false)
  const [openIds, setOpenIds] = useState<readonly string[]>([])
  const [active, setActive] = useState<string | undefined>(undefined)
  const [openGroups, setOpenGroups] = useState<readonly string[]>([])

  const reachable = useMemo(
    () => reachableMenus(menus.data ?? [], held),
    [menus.data, held],
  )
  const pages = useMemo(() => reachable.filter(menu => menu.kind === 'menu'), [reachable])
  const byId = useMemo(() => new Map(pages.map(menu => [menu.id, menu])), [pages])

  // The first page this member can open is the one they land on, and every
  // group starts expanded. Both happen once the tree has arrived rather than at
  // mount, when there is nothing to open. Later loads leave the tabs alone: a
  // reload of the tree must not close what is open.
  useEffect(() => {
    const first = pages[0]
    if (active !== undefined || first === undefined) return
    setOpenIds([first.id])
    setActive(first.id)
    setOpenGroups(reachable.filter(menu => menu.kind === 'catalog').map(menu => menu.id))
  }, [pages, active, reachable])

  const open = (id: string): void => {
    setOpenIds(current => (current.includes(id) ? current : [...current, id]))
    setActive(id)
  }

  const close = (id: string): void => {
    const remaining = openIds.filter(open2 => open2 !== id)
    setOpenIds(remaining)
    // Closing the tab in front moves to the one before it, which is where the
    // reader was; closing any other leaves the front tab where it is.
    if (active === id) setActive(remaining.at(-1))
  }

  const signOut = async (): Promise<void> => {
    // A session the server has already forgotten is still ended here: the
    // console must not keep showing an administration view either way.
    await api.signOut().catch(() => undefined)
    onSignedOut()
  }

  /** The sidebar, as the stored tree describes it. */
  const items = reachable
    .filter(menu => menu.parentId === undefined)
    .map((menu) => {
      const children = reachable.filter(child => child.parentId === menu.id)
      const icon = menu.icon === undefined ? undefined : ICONS[menu.icon as MenuIcon]
      return {
        key: menu.id,
        label: menuLabel(menu, t),
        ...(icon === undefined ? {} : { icon }),
        ...(children.length === 0
          ? {}
          : {
            children: children.map(child => ({
              key: child.id,
              label: menuLabel(child, t),
            })),
          }),
      }
    })

  const railed = narrow || folded

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider width={228} collapsedWidth={64} collapsed={railed} trigger={null}>
        {/* Collapsed, the sider is an icon rail: the organization's name would
            not fit, and a wrapped fragment of it is worse than none. */}
        <div className="brand" style={{ padding: railed ? '20px 8px' : '20px 16px' }}>
          <Typography.Title level={5} style={{ color: '#fff', margin: 0, whiteSpace: 'nowrap' }}>
            {railed ? 'DS' : t('app.title')}
          </Typography.Title>
          {!railed && (
            <Typography.Text style={{ color: '#98a2b3', fontSize: 12 }}>
              {session.organization.name}
            </Typography.Text>
          )}
        </div>
        <AntMenu
          theme="dark"
          mode="inline"
          selectedKeys={active === undefined ? [] : [active]}
          openKeys={[...openGroups]}
          onOpenChange={(keys) => { setOpenGroups(keys) }}
          items={items}
          onSelect={({ key }) => { if (byId.has(key)) open(key) }}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header className="console-header">
          <Button
            type="text"
            aria-label={t('members.orgTree')}
            icon={railed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => { setFolded(!folded) }}
          />
          <Space>
            <Select<LocaleId>
              value={locale}
              onChange={setLocale}
              aria-label={t('lang.label')}
              options={LOCALE_IDS.map(id => ({ value: id, label: id === 'zh' ? '中文' : 'English' }))}
              style={{ width: 110 }}
            />
            <Typography.Text>{session.member.displayName}</Typography.Text>
            <Button onClick={() => void signOut()}>{t('nav.signOut')}</Button>
          </Space>
        </Layout.Header>
        {openIds.length > 0 && (
          <Tabs
            className="console-tabs"
            type="editable-card"
            hideAdd
            {...(active === undefined ? {} : { activeKey: active })}
            onChange={setActive}
            onEdit={(key, action) => { if (action === 'remove') close(key as string) }}
            items={openIds.map(id => ({
              key: id,
              label: menuLabel(byId.get(id) as WireMenu, t),
              // The first tab is where a closed tab sends the reader back to,
              // so it stays open.
              closable: openIds.length > 1,
            }))}
          />
        )}
        <Layout.Content className="console-content">
          {menus.loading
            ? <Spin />
            : active === undefined
              ? <Empty description={t('shell.noNavigation')} />
              : (
                <View
                  menu={byId.get(active) as WireMenu}
                  held={held}
                  signedInId={session.member.id}
                />
              )}
        </Layout.Content>
      </Layout>
    </Layout>
  )
}

/**
 * The whole application: read the session, then render one of two things.
 * @returns the console or the sign-in card.
 */
export function App(): ReactNode {
  const { antd } = useLocale()
  const [session, setSession] = useState<WireSession | undefined>(undefined)
  const [asking, setAsking] = useState(true)

  const accept = useCallback((next: WireSession) => {
    holdCsrf(next.csrf)
    setSession(next)
  }, [])

  useEffect(() => {
    let current = true
    api.session().then(
      (next) => { if (current) { accept(next); setAsking(false) } },
      () => {
        // Any answer other than a session means the sign-in card: a refusal
        // here is "nobody is signed in", and so is an unreachable server.
        if (current) { setSession(undefined); setAsking(false) }
      },
    )
    return () => { current = false }
  }, [accept])

  return (
    <ConfigProvider locale={antd} theme={{ algorithm: theme.defaultAlgorithm }}>
      <AntApp>
        {asking
          ? <div className="auth"><Spin size="large" /></div>
          : session === undefined
            ? <Login onSignedIn={accept} />
            : <Console session={session} onSignedOut={() => { setSession(undefined) }} />}
      </AntApp>
    </ConfigProvider>
  )
}
