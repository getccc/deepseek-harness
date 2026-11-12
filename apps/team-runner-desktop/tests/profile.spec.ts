/** Desktop restarts and upgrades preserve member-owned plugin state and package resolution. */
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execa } from 'execa'
import { expect, it, onTestFinished } from 'vitest'
import { provisionProfile, SHIPPED_PLUGIN_BUNDLES } from '../src/profile.ts'
import { writeRegistryTrust } from '../src/registry-trust.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const home = join(root, 'home')
  const profile = join(home, 'profiles/team')
  const shipped = (fingerprint: string) => {
    const directory = join(root, fingerprint)
    for (const name of [...SHIPPED_PLUGIN_BUNDLES, 'shared-dependency']) {
      const target = join(directory, name)
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'package.json'), JSON.stringify({ name, main: 'index.cjs' }))
      writeFileSync(join(target, 'index.cjs'), name === 'shared-dependency'
        ? `module.exports = ${JSON.stringify(fingerprint)}`
        : "module.exports = require('shared-dependency')")
    }
    return { directory, fingerprint }
  }
  return { root, home, profile, shipped }
}

it('pins only the company registry while retaining other npm settings through an application upgrade', () => {
  const f = fixture()
  provisionProfile(f.home, undefined)
  const npmrc = join(f.profile, '.npmrc')
  const user = 'registry=https://registry.npmjs.org/\n//other.example/:_authToken=fixture-only\n'
  writeFileSync(npmrc, user)
  const registry = 'https://control.example:3095/npm/'
  writeRegistryTrust(f.profile, registry, '/Applications/WeWork.app/Contents/Resources/company ca.crt')
  expect(readFileSync(npmrc, 'utf8')).toBe(`${user}//control.example:3095/npm/:cafile="/Applications/WeWork.app/Contents/Resources/company ca.crt"\n`)
  writeRegistryTrust(f.profile, registry, '/new/company-ca.crt')
  writeRegistryTrust(f.profile, registry, '/new/company-ca.crt')
  expect(readFileSync(npmrc, 'utf8')).toBe(`${user}//control.example:3095/npm/:cafile="/new/company-ca.crt"\n`)
  expect(() => { writeRegistryTrust(f.profile, 'http://control.example/npm/', '/ca.crt') }).toThrow(/HTTPS/u)
  expect(() => { writeRegistryTrust(f.profile, 'https://user:password@control.example/npm/', '/ca.crt') }).toThrow(/credentials/u)
})

it('retains enabled and disabled bundles, dependencies and user patches after a restart', () => {
  const f = fixture()
  const plugins = f.shipped('first')
  provisionProfile(f.home, plugins)
  expect(readFileSync(join(f.profile, 'pnpm-workspace.yaml'), 'utf8'))
    .toContain('autoInstallPeers: false')
  const manifest = join(f.profile, 'package.json')
  const selected = `${JSON.stringify({
    name: 'member-profile', private: true, dependencies: { 'member-plugin': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-cua-bundle'] } },
  }, null, 4)}\n`
  writeFileSync(manifest, selected)
  const workspace = 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\nminimumReleaseAge: 1440\n'
  writeFileSync(join(f.profile, 'pnpm-workspace.yaml'), workspace)
  writeFileSync(join(f.profile, 'cordis.patch.yml'), '- id: member-setting\n  disabled: true\n')
  mkdirSync(join(f.profile, 'node_modules/member-plugin'), { recursive: true })
  writeFileSync(join(f.profile, 'node_modules/member-plugin/local.txt'), 'member data')
  provisionProfile(f.home, plugins)
  expect(readFileSync(manifest, 'utf8')).toBe(selected)
  expect(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8')).toContain('member-setting')
  expect(readFileSync(join(f.profile, 'pnpm-workspace.yaml'), 'utf8')).toBe(workspace)
  expect(readFileSync(join(f.profile, 'node_modules/member-plugin/local.txt'), 'utf8')).toBe('member data')
  const require = createRequire(join(f.profile, 'package.json'))
  expect(require('dsh-univer-office')).toBe('first')
  expect(require('@dsh-external/dsh-echarts')).toBe('first')
})

it('projects a carried company directory for a new profile and preserves an existing selection', () => {
  const f = fixture()
  const plugins = f.shipped('company-directory')
  const name = '@wework/company-plugins'
  const directory = join(plugins.directory, name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, main: 'index.cjs' }))
  writeFileSync(join(directory, 'index.cjs'), "module.exports = 'company directory'")
  provisionProfile(f.home, plugins)
  const manifest = join(f.profile, 'package.json')
  const first = JSON.parse(readFileSync(manifest, 'utf8')) as { dsh: { profile: { bundles: string[] } } }
  expect(first.dsh.profile.bundles).toContain(name)
  expect(createRequire(manifest)(name)).toBe('company directory')
  first.dsh.profile.bundles = first.dsh.profile.bundles.filter(bundle => bundle !== name)
  const selection = `${JSON.stringify(first)}\n`
  writeFileSync(manifest, selection)
  provisionProfile(f.home, plugins)
  expect(readFileSync(manifest, 'utf8')).toBe(selection)
})

it('adds the company directory on upgrade once while retaining business plugin choices and patches', () => {
  const f = fixture()
  provisionProfile(f.home, f.shipped('before-directory'))
  const manifest = join(f.profile, 'package.json')
  const selected = { name: 'member-profile', private: true, dependencies: { 'member-plugin': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'member-plugin'] } } }
  writeFileSync(manifest, `${JSON.stringify(selected)}\n`)
  writeFileSync(join(f.profile, 'cordis.patch.yml'), '- id: member-setting\n  disabled: true\n')
  const plugins = f.shipped('with-directory')
  const name = '@wework/company-plugins'
  const directory = join(plugins.directory, name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, main: 'index.cjs' }))
  writeFileSync(join(directory, 'index.cjs'), "module.exports = 'company directory'")
  provisionProfile(f.home, plugins)
  const upgraded = JSON.parse(readFileSync(manifest, 'utf8')) as typeof selected
  expect(upgraded.dependencies).toEqual(selected.dependencies)
  expect(upgraded.dsh.profile.bundles).toEqual([...selected.dsh.profile.bundles, '@deepseek-ai/dsh-experimental-plugin-market-bundle', name])
  expect(upgraded.dsh.profile.bundles).not.toContain('@wework/ehs-environment-reports')
  expect(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8')).toContain('member-setting')
  upgraded.dsh.profile.bundles = upgraded.dsh.profile.bundles.filter(bundle => bundle !== name)
  const disabled = `${JSON.stringify(upgraded)}\n`
  writeFileSync(manifest, disabled)
  provisionProfile(f.home, plugins)
  expect(readFileSync(manifest, 'utf8')).toBe(disabled)
})

it('selects the catalog bundle once for an older company profile and then retains a disabled choice', () => {
  const f = fixture()
  const plugins = f.shipped('catalog-upgrade')
  const directory = join(plugins.directory, '@wework/company-plugins')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), '{"name":"@wework/company-plugins"}')
  provisionProfile(f.home, plugins)
  const manifest = join(f.profile, 'package.json')
  const marker = join(f.profile, '.company-plugin-index-initialized')
  const selected = JSON.parse(readFileSync(manifest, 'utf8')) as { dsh: { profile: { bundles: string[] } } }
  const market = '@deepseek-ai/dsh-experimental-plugin-market-bundle'
  selected.dsh.profile.bundles = selected.dsh.profile.bundles.filter(name => name !== market)
  writeFileSync(manifest, JSON.stringify(selected))
  rmSync(marker)
  provisionProfile(f.home, plugins)
  const upgraded = JSON.parse(readFileSync(manifest, 'utf8')) as typeof selected
  expect(upgraded.dsh.profile.bundles).toContain(market)
  upgraded.dsh.profile.bundles = upgraded.dsh.profile.bundles.filter(name => name !== market)
  const disabled = `${JSON.stringify(upgraded)}\n`
  writeFileSync(manifest, disabled)
  provisionProfile(f.home, plugins)
  expect(readFileSync(manifest, 'utf8')).toBe(disabled)
})

it('rejects malformed bundle selections without rewriting the member manifest', () => {
  const f = fixture()
  const plugins = f.shipped('company-directory')
  const directory = join(plugins.directory, '@wework/company-plugins')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), '{"name":"@wework/company-plugins"}')
  mkdirSync(f.profile, { recursive: true })
  const manifest = join(f.profile, 'package.json')
  for (const content of ['{"dsh":42}', '{"dsh":{"profile":[]}}', '{"dsh":{"profile":{"bundles":[42]}}}']) {
    writeFileSync(manifest, content)
    expect(() => { provisionProfile(f.home, plugins) }).toThrow('Invalid Team profile')
    expect(readFileSync(manifest, 'utf8')).toBe(content)
  }
})

it('upgrades shipped plugins and their private dependencies without overwriting installed packages', () => {
  const f = fixture()
  provisionProfile(f.home, f.shipped('first'))
  const original = realpathSync(join(f.profile, 'node_modules/dsh-univer-office'))
  const dependency = join(f.profile, 'node_modules/shared-dependency')
  mkdirSync(dependency)
  writeFileSync(join(dependency, 'package.json'), '{"name":"shared-dependency","main":"index.cjs"}')
  writeFileSync(join(dependency, 'index.cjs'), "module.exports = 'member version'")
  provisionProfile(f.home, f.shipped('second'))
  expect(realpathSync(join(f.profile, 'node_modules/dsh-univer-office'))).not.toBe(original)
  const require = createRequire(join(f.profile, 'package.json'))
  expect(require('dsh-univer-office')).toBe('second')
  expect(require('shared-dependency')).toBe('member version')
  expect(existsSync(original)).toBe(true)
})

it('migrates the legacy copied tree while retaining a member-managed Office replacement', () => {
  const f = fixture()
  mkdirSync(join(f.profile, 'node_modules/dsh-univer-office'), { recursive: true })
  writeFileSync(join(f.profile, 'node_modules/dsh-univer-office/package.json'), '{"name":"local-office"}')
  mkdirSync(join(f.profile, 'node_modules/@dsh-external/dsh-echarts'), { recursive: true })
  writeFileSync(join(f.profile, 'node_modules/@dsh-external/dsh-echarts/package.json'), '{"name":"old-echarts"}')
  writeFileSync(join(f.profile, '.dsh-plugin-tree'), 'legacy tree\n')
  writeFileSync(join(f.profile, 'package.json'), '{"dependencies":{"dsh-univer-office":"file:local-office"}}\n')
  provisionProfile(f.home, f.shipped('new'))
  expect(JSON.parse(readFileSync(join(f.profile, 'node_modules/dsh-univer-office/package.json'), 'utf8')))
    .toEqual({ name: 'local-office' })
  expect(createRequire(join(f.profile, 'package.json'))('@dsh-external/dsh-echarts')).toBe('new')
  expect(existsSync(join(f.profile, '.dsh-plugin-tree'))).toBe(false)
})

it('keeps existing local plugin directories that the shell does not own', () => {
  const f = fixture()
  mkdirSync(join(f.profile, 'node_modules/dsh-univer-office'), { recursive: true })
  writeFileSync(join(f.profile, 'node_modules/dsh-univer-office/package.json'), '{"name":"local-office"}')
  provisionProfile(f.home, f.shipped('new'))
  expect(readFileSync(join(f.profile, 'node_modules/dsh-univer-office/package.json'), 'utf8'))
    .toContain('local-office')
})

it.each([true, false])('archives unowned pnpm metadata before a first install (legacy marker=%s)', (legacy) => {
  const f = fixture()
  const plugins = f.shipped('new')
  provisionProfile(f.home, plugins)
  const files = ['.modules.yaml', '.pnpm/lock.yaml', '.pnpm-workspace-state-v1.json']
  for (const file of files) {
    const path = join(f.profile, 'node_modules', file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `copied ${file}\n`)
  }
  if (legacy) writeFileSync(join(f.profile, '.dsh-plugin-tree'), 'old tree\n')
  provisionProfile(f.home, plugins)
  const backups = readdirSync(f.profile).filter(name => name.startsWith('.dsh-pnpm-backup-'))
  expect(backups).toHaveLength(1)
  for (const file of files) {
    expect(existsSync(join(f.profile, 'node_modules', file))).toBe(false)
    expect(readFileSync(join(f.profile, backups[0]!, file), 'utf8')).toBe(`copied ${file}\n`)
  }
  provisionProfile(f.home, plugins)
  expect(readdirSync(f.profile).filter(name => name.startsWith('.dsh-pnpm-backup-'))).toEqual(backups)
  expect(createRequire(join(f.profile, 'package.json'))('dsh-univer-office')).toBe('new')
})

it.each(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'lockfile'])(
  'retains pnpm metadata owned by member %s', (owner) => {
    const f = fixture()
    const plugins = f.shipped('new')
    provisionProfile(f.home, plugins)
    if (owner === 'lockfile') writeFileSync(join(f.profile, 'pnpm-lock.yaml'), 'member lockfile\n')
    else writeFileSync(join(f.profile, 'package.json'), JSON.stringify({ [owner]: { 'member-plugin': '1.0.0' } }))
    const metadata = join(f.profile, 'node_modules/.modules.yaml')
    writeFileSync(metadata, 'member metadata\n')
    provisionProfile(f.home, plugins)
    expect(readFileSync(metadata, 'utf8')).toBe('member metadata\n')
    expect(readdirSync(f.profile).some(name => name.startsWith('.dsh-pnpm-backup-'))).toBe(false)
  },
)

it('installs a member plugin after migrating a copied pnpm tree with different layout settings', async () => {
  const f = fixture()
  const plugins = f.shipped('staged')
  const staging = join(f.root, 'packaging-profile')
  mkdirSync(staging)
  const member = join(f.root, 'member-plugin')
  mkdirSync(member)
  writeFileSync(join(member, 'package.json'), '{"name":"member-plugin","version":"1.0.0","main":"index.cjs"}')
  writeFileSync(join(member, 'index.cjs'), "module.exports = 'installed member plugin'")
  writeFileSync(join(staging, 'package.json'), '{"private":true,"dependencies":{"member-plugin":"file:../member-plugin"}}')
  writeFileSync(join(staging, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\nautoInstallPeers: false\n')
  const config = join(f.root, 'npmrc')
  writeFileSync(config, '')
  const pnpm = join(dirname(createRequire(import.meta.url).resolve('pnpm')), 'bin/pnpm.mjs')
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(?:path|systemroot|windir|comspec|temp|tmp)$/iu.test(key)))
  const run = async (cwd: string, length: number, args: string[]) => {
    const result = await execa(process.execPath, [pnpm, ...args, '--offline', '--ignore-scripts',
      `--config.userconfig=${config}`, `--config.globalconfig=${config}`,
      `--config.store-dir=${join(cwd, 'store')}`, `--config.virtual-store-dir-max-length=${String(length)}`,
      '--config.manage-package-manager-versions=false', '--config.enable-global-virtual-store=false'], {
      cwd, env: { ...environment, CI: 'true' }, extendEnv: false, reject: false, timeout: 30_000,
    })
    expect(result.timedOut, result.stderr).toBe(false)
    expect(result.signal, result.stderr).toBeUndefined()
    return result
  }
  const staged = await run(staging, 120, ['install'])
  expect(staged.exitCode, `${staged.stdout}\n${staged.stderr}`).toBe(0)
  provisionProfile(f.home, plugins)
  // Older installers copied the build machine's pnpm state into the member profile.
  cpSync(join(staging, 'node_modules'), join(f.profile, 'node_modules'), { recursive: true })
  const add = ['add', `file:${member}`]
  const rejected = await run(f.profile, 60, add)
  expect(rejected.exitCode).toBe(1)
  expect(`${rejected.stdout}\n${rejected.stderr}`).toContain('ERR_PNPM_VIRTUAL_STORE_DIR_MAX_LENGTH_DIFF')
  provisionProfile(f.home, plugins)
  const installed = await run(f.profile, 60, add)
  expect(installed.exitCode, `${installed.stdout}\n${installed.stderr}`).toBe(0)
  const require = createRequire(join(f.profile, 'package.json'))
  expect(require('member-plugin')).toBe('installed member plugin')
  expect(require('dsh-univer-office')).toBe('staged')
  expect(require('@dsh-external/dsh-echarts')).toBe('staged')
  const metadata = readFileSync(join(f.profile, 'node_modules/.modules.yaml'), 'utf8')
  provisionProfile(f.home, plugins)
  expect(readFileSync(join(f.profile, 'node_modules/.modules.yaml'), 'utf8')).toBe(metadata)
})

it('reports malformed manifests and incomplete shipped trees without replacing user data', () => {
  const f = fixture()
  mkdirSync(f.profile, { recursive: true })
  const manifest = join(f.profile, 'package.json')
  for (const content of ['[]', '{"dependencies":null}', '{"dependencies":{"plugin":42}}', 'invalid json']) {
    writeFileSync(manifest, content)
    expect(() => { provisionProfile(f.home, undefined) }).toThrow()
    expect(readFileSync(manifest, 'utf8')).toBe(content)
  }
  writeFileSync(manifest, '{}')
  const plugins = f.shipped('incomplete')
  rmSync(join(plugins.directory, 'dsh-univer-office'), { recursive: true })
  expect(() => { provisionProfile(f.home, plugins) }).toThrow('omits dsh-univer-office')
  expect(readFileSync(manifest, 'utf8')).toBe('{}')
})
