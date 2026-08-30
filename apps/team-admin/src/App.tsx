/**
 * The console shell: who is signed in, which view is showing, and the two
 * languages it renders in.
 *
 * The session is read once at start. A browser with none sees the sign-in card
 * and nothing else, because every other view would only be refused.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ApiOutlined,
  ApartmentOutlined,
  BankOutlined,
  DashboardOutlined,
  LaptopOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { App as AntApp, Button, ConfigProvider, Layout, Menu, Select, Space, Spin, Typography, theme } from 'antd'
import { api, holdCsrf, type WireSession } from './api.ts'
import { LOCALE_IDS, useLocale, type LocaleId } from './locale.tsx'
import { Devices } from './pages/Devices.tsx'
import { Login } from './pages/Login.tsx'
import { Members } from './pages/Members.tsx'
import { Models } from './pages/Models.tsx'
import { Organization } from './pages/Organization.tsx'
import { Overview } from './pages/Overview.tsx'
import { Roles } from './pages/Roles.tsx'
import type { CopyKey } from './locales.ts'

/** One entry in the sidebar, and the permission that makes it reachable. */
const VIEWS = [
  { key: 'overview', label: 'nav.overview', icon: <DashboardOutlined />, needs: 'organization|organization.read' },
  { key: 'organization', label: 'nav.organization', icon: <BankOutlined />, needs: 'organization|organization.read' },
  { key: 'members', label: 'nav.members', icon: <TeamOutlined />, needs: 'member|member.read' },
  { key: 'roles', label: 'nav.roles', icon: <ApartmentOutlined />, needs: 'role|role.read' },
  { key: 'devices', label: 'nav.devices', icon: <LaptopOutlined />, needs: 'device|device.inventory.read' },
  { key: 'models', label: 'nav.models', icon: <ApiOutlined />, needs: 'model|model.catalog.read' },
] as const satisfies readonly { key: string; label: CopyKey; icon: ReactNode; needs: string }[]

/** Which view is showing. */
type ViewKey = typeof VIEWS[number]['key']

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
  const held = useMemo(() => new Set(session.permissions), [session.permissions])
  const reachable = VIEWS.filter(view => held.has(view.needs))
  const [view, setView] = useState<ViewKey>(reachable[0]?.key ?? 'overview')
  const [narrow, setNarrow] = useState(false)

  const signOut = async (): Promise<void> => {
    // A session the server has already forgotten is still ended here: the
    // console must not keep showing an administration view either way.
    await api.signOut().catch(() => undefined)
    onSignedOut()
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        width={244}
        breakpoint="lg"
        collapsedWidth={64}
        collapsed={narrow}
        onBreakpoint={setNarrow}
        trigger={null}
      >
        {/* Collapsed, the sider is an icon rail: the organization's name would
            not fit, and a wrapped fragment of it is worse than none. */}
        <div style={{ padding: narrow ? '20px 8px' : '20px 16px', overflow: 'hidden' }}>
          <Typography.Title level={5} style={{ color: '#fff', margin: 0, whiteSpace: 'nowrap' }}>
            {narrow ? 'DS' : t('app.title')}
          </Typography.Title>
          {!narrow && (
            <Typography.Text style={{ color: '#98a2b3', fontSize: 12 }}>
              {session.organization.name}
            </Typography.Text>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[view]}
          onSelect={({ key }) => { setView(key as ViewKey) }}
          items={reachable.map(entry => ({ key: entry.key, icon: entry.icon, label: t(entry.label) }))}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{
            background: '#fff', borderBottom: '1px solid #f0f0f0',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
          }}
        >
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
        <Layout.Content style={{ padding: 24, maxWidth: 1440, width: '100%', margin: '0 auto' }}>
          {view === 'overview' && <Overview />}
          {view === 'organization' && (
            <Organization mayManage={held.has('organization|organization.settings.manage')} />
          )}
          {view === 'members' && <Members held={held} />}
          {view === 'roles' && <Roles held={held} />}
          {view === 'devices' && <Devices held={held} />}
          {view === 'models' && <Models held={held} />}
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
