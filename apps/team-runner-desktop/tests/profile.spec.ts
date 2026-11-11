/** Desktop restarts and upgrades preserve member-owned plugin state and package resolution. */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { provisionProfile, SHIPPED_PLUGIN_BUNDLES } from '../src/profile.ts'

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

it('retains enabled and disabled bundles, dependencies and user patches after a restart', () => {
  const f = fixture()
  const plugins = f.shipped('first')
  provisionProfile(f.home, plugins)
  const manifest = join(f.profile, 'package.json')
  const selected = `${JSON.stringify({
    name: 'member-profile', private: true, dependencies: { 'member-plugin': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-cua-bundle'] } },
  }, null, 4)}\n`
  writeFileSync(manifest, selected)
  writeFileSync(join(f.profile, 'cordis.patch.yml'), '- id: member-setting\n  disabled: true\n')
  mkdirSync(join(f.profile, 'node_modules/member-plugin'), { recursive: true })
  writeFileSync(join(f.profile, 'node_modules/member-plugin/local.txt'), 'member data')
  provisionProfile(f.home, plugins)
  expect(readFileSync(manifest, 'utf8')).toBe(selected)
  expect(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8')).toContain('member-setting')
  expect(readFileSync(join(f.profile, 'node_modules/member-plugin/local.txt'), 'utf8')).toBe('member data')
  const require = createRequire(join(f.profile, 'package.json'))
  expect(require('dsh-univer-office')).toBe('first')
  expect(require('@dsh-external/dsh-echarts')).toBe('first')
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
