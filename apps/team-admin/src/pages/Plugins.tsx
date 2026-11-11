/** Register internal plugin versions and control which ones members can discover. */
import { useState, type ReactNode } from 'react'
import { Alert, App, Avatar, Button, Card, Empty, Form, Input, Radio, Skeleton, Tag, Typography } from 'antd'
import { AppstoreOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { api, ApiError, type PluginRegistration, type WirePluginCatalog, type WirePluginVersion } from '../api.ts'
import { useLocale } from '../locale.tsx'
import type { CopyKey } from '../locales.ts'
import { ConfirmModal, FormModal, Moment, PageNote, useErrorReporter, useLoaded } from '../ui.tsx'
import s from './Plugins.module.css'

/**
 * The plugin center's catalog and publication controls.
 * @param props.held - the signed-in administrator's permission pairs.
 * @returns the plugin management page.
 */
export function Plugins({ held }: { readonly held: ReadonlySet<string> }): ReactNode {
  const { t } = useLocale()
  const report = useErrorReporter()
  const { message } = App.useApp()
  const [loadFailed, setLoadFailed] = useState(false)
  const catalog = useLoaded<WirePluginCatalog>(api.pluginCatalog, () => { setLoadFailed(true) })
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'all' | WirePluginVersion['state']>('all')
  const versions = catalog.data?.versions ?? []
  const search = query.trim().toLocaleLowerCase()
  const shown = versions.filter(version =>
    (state === 'all' || version.state === state)
    && [version.title, version.name, version.author, version.description, version.version]
      .some(value => value.toLocaleLowerCase().includes(search)))
  const reload = (): void => {
    setLoadFailed(false)
    catalog.reload()
  }
  const [registering, setRegistering] = useState(false)
  const [selected, setSelected] = useState<WirePluginVersion | undefined>()
  const mayManage = held.has('release|release.manage')
  const errors: Readonly<Record<string, CopyKey>> = {
    'package-unavailable': 'plugins.error.package',
    'not-a-bundle': 'plugins.error.bundle',
    'version-changed': 'plugins.error.changed',
    'withdraw-before-edit': 'plugins.error.withdraw',
    'invalid-fields': 'plugins.error.fields',
    'invalid-compatibility': 'plugins.error.compatibility',
    'manifest-too-large': 'plugins.error.large',
    'missing-publish-time': 'plugins.error.package',
  }
  const act = async (operation: () => Promise<WirePluginCatalog>): Promise<void> => {
    try {
      catalog.replace(await operation())
      setRegistering(false)
      setSelected(undefined)
    } catch (error) {
      const key = error instanceof ApiError && error.code !== undefined ? errors[error.code] : undefined
      if (key === undefined) report(error)
      else void message.error(t(key))
    }
  }
  return (
    <>
      <PageNote text={t('plugins.description')} />
      <div className={s.toolbar}>
        <Input
          className={s.search}
          size="large"
          prefix={<SearchOutlined />}
          allowClear
          aria-label={t('plugins.search')}
          placeholder={t('plugins.search')}
          value={query}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <div className={s.actions}>
          <Button size="large" icon={<ReloadOutlined />} onClick={reload} loading={catalog.loading}>
            {t('plugins.refresh')}
          </Button>
          {mayManage && (
            <Button size="large" type="primary" icon={<PlusOutlined />} onClick={() => { setRegistering(true) }}>
              {t('plugins.register')}
            </Button>
          )}
        </div>
      </div>
      <div className={s.filters}>
        <Radio.Group value={state} aria-label={t('plugins.state')}>
          {(['all', 'published', 'draft', 'withdrawn'] as const).map(value => (
            <Radio.Button key={value} value={value} onChange={() => { setState(value) }}>
              {t(value === 'all' ? 'plugins.all' : `plugins.state.${value}`)}
              <span className={s.count}>
                {value === 'all' ? versions.length : versions.filter(version => version.state === value).length}
              </span>
            </Radio.Button>
          ))}
        </Radio.Group>
        <Typography.Text type="secondary" role="status">
          {t('plugins.results', { count: shown.length })}
        </Typography.Text>
      </div>
      {loadFailed && (
        <Alert
          className={s.error}
          type="error"
          showIcon
          title={t('error.unavailable')}
          action={<Button onClick={reload}>{t('plugins.refresh')}</Button>}
        />
      )}
      {catalog.loading && catalog.data === undefined ? (
        <div className={s.grid} aria-busy="true" aria-label={t('plugins.plugin')}>
          {['first', 'second', 'third'].map(key => (
            <Card key={key} className={s.card}><Skeleton active avatar paragraph={{ rows: 3 }} /></Card>
          ))}
        </div>
      ) : catalog.data !== undefined && shown.length === 0 ? (
        <Card className={s.empty}>
          <Empty description={t(versions.length === 0 ? 'plugins.empty' : 'plugins.noResults')} />
        </Card>
      ) : (
        <div className={s.grid}>
          {shown.map(version => (
            <Card key={`${version.name}@${version.version}`} className={s.card}>
              <article className={s.content} aria-label={version.title}>
                <div className={s.heading}>
                  <div className={s.identity}>
                    <Typography.Title level={4} className={s.title}>{version.title}</Typography.Title>
                    <Typography.Text type="secondary" className={s.package}>{version.name}</Typography.Text>
                  </div>
                  {mayManage && (
                    <Button danger={version.state === 'published'} onClick={() => { setSelected(version) }}>
                      {t(version.state === 'published' ? 'plugins.withdraw' : 'plugins.publish')}
                    </Button>
                  )}
                </div>
                <div className={s.author}>
                  <Avatar size="small" icon={<AppstoreOutlined />} />
                  {version.author !== '' && <Typography.Text type="secondary">{version.author}</Typography.Text>}
                  <Typography.Text type="secondary">v{version.version}</Typography.Text>
                </div>
                <Typography.Paragraph className={s.description} ellipsis={{ rows: 3, expandable: true, symbol: t('plugins.expand') }}>
                  {version.description || t('plugins.noDescription')}
                </Typography.Paragraph>
                <div className={s.footer}>
                  <div className={s.tags}>
                    <Tag className={s.compatibility}>
                      {version.engines.dsh === undefined ? t('plugins.compatibilityAny') : `DSH ${version.engines.dsh}`}
                    </Tag>
                    <Tag color={version.state === 'published' ? 'green' : 'default'}>{t(`plugins.state.${version.state}`)}</Tag>
                  </div>
                  <Typography.Text type="secondary" className={s.updated}>
                    {t('plugins.updatedAt')} · <Moment value={version.updatedAt} />
                  </Typography.Text>
                </div>
              </article>
            </Card>
          ))}
        </div>
      )}
      {catalog.data !== undefined && (
        <Typography.Paragraph type="secondary" className={s.index} copyable={{ text: new URL(catalog.data.indexPath, location.origin).href }}>
          {t('plugins.index')}: {new URL(catalog.data.indexPath, location.origin).href}
        </Typography.Paragraph>
      )}
      <FormModal<PluginRegistration>
        title={t('plugins.register')}
        open={registering}
        okText={t('plugins.saveDraft')}
        onCancel={() => { setRegistering(false) }}
        onSubmit={values => act(() => api.registerPlugin(values))}
      >
        <Form.Item name="name" label={t('plugins.package')} rules={[{ required: true, message: t('plugins.required') }]}>
          <Input placeholder={t('plugins.packagePlaceholder')} />
        </Form.Item>
        <Form.Item name="version" label={t('plugins.version')} rules={[{ required: true, message: t('plugins.required') }]}>
          <Input placeholder={t('plugins.versionPlaceholder')} />
        </Form.Item>
        <Form.Item name="title" label={t('plugins.title')} rules={[{ required: true, message: t('plugins.required') }]}>
          <Input maxLength={160} />
        </Form.Item>
        <Form.Item name="description" label={t('plugins.summary')}><Input.TextArea maxLength={1000} rows={3} /></Form.Item>
      </FormModal>
      {selected !== undefined && (
        <ConfirmModal
          open
          title={t(selected.state === 'published' ? 'plugins.withdraw' : 'plugins.publish')}
          body={t(selected.state === 'published' ? 'plugins.withdrawBody' : 'plugins.publishBody', {
            name: selected.title, version: selected.version,
          })}
          danger={selected.state === 'published'}
          onCancel={() => { setSelected(undefined) }}
          onConfirm={() => act(() => api.setPluginState(selected.name, selected.version,
            selected.state === 'published' ? 'withdrawn' : 'published'))}
        />
      )}
    </>
  )
}
