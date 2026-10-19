import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  APP_VERSION_ENV, OFFICE_SIDECAR_ENV, UPDATE_ORIGIN_ENV, pluginTreeFingerprint, resolveAppVersion,
  resolveOfficeSidecar, resolveUpdateOrigin,
} from '../scripts/packaging-inputs.mjs'

const trees: string[] = []

/** One plugin tree on disk, named by its file contents. */
function tree(files: Record<string, string>, links: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-tree-'))
  trees.push(root)
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content)
  }
  for (const [path, target] of Object.entries(links)) {
    const link = join(root, path)
    mkdirSync(join(link, '..'), { recursive: true })
    symlinkSync(target, link)
  }
  return root
}

afterEach(() => {
  for (const root of trees.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('release version', () => {
  it('accepts three numbers and nothing else', () => {
    expect(resolveAppVersion({ [APP_VERSION_ENV]: '1.0.0' })).toBe('1.0.0')
    expect(resolveAppVersion({ [APP_VERSION_ENV]: ' 12.4.37 ' })).toBe('12.4.37')
  })

  it('refuses the suffixes that would break updating', () => {
    // A prerelease tag sends electron-updater to another channel, and the
    // decision kernel compares it equal to the release that follows it.
    expect(() => resolveAppVersion({ [APP_VERSION_ENV]: '1.1.0-beta.1' })).toThrow(/no prerelease tag/u)
    // Build metadata is ignored by semver comparison, so two builds of one
    // version would never replace each other.
    expect(() => resolveAppVersion({ [APP_VERSION_ENV]: '1.0.0+20260920.1' })).toThrow(/build metadata/u)
    expect(() => resolveAppVersion({ [APP_VERSION_ENV]: '0.1.6-alpha.1.20260917.2' })).toThrow(/received/u)
    expect(() => resolveAppVersion({ [APP_VERSION_ENV]: '1.0' })).toThrow(/MAJOR\.MINOR\.PATCH/u)
  })

  it('refuses a build that names no release', () => {
    expect(() => resolveAppVersion({})).toThrow(/must name the release version/u)
    expect(() => resolveAppVersion({ [APP_VERSION_ENV]: '  ' })).toThrow(/must name the release version/u)
  })
})

describe('where releases are fetched from', () => {
  const controlPlane = 'https://control.example.com:3095'

  it('serves releases from the deployment itself by default', () => {
    expect(resolveUpdateOrigin({}, controlPlane)).toBe('https://control.example.com:3095/updates/')
  })

  it('takes object storage or a CDN instead, ending in a slash either way', () => {
    // A Control Plane with little bandwidth would otherwise carry a few
    // hundred megabytes per member on every release.
    expect(resolveUpdateOrigin({ [UPDATE_ORIGIN_ENV]: 'https://cdn.example.com/wework' }, controlPlane))
      .toBe('https://cdn.example.com/wework/')
    expect(resolveUpdateOrigin({ [UPDATE_ORIGIN_ENV]: 'http://127.0.0.1:8099/updates/' }, controlPlane))
      .toBe('http://127.0.0.1:8099/updates/')
  })

  it('refuses an address that is not fetched over http', () => {
    expect(() => resolveUpdateOrigin({ [UPDATE_ORIGIN_ENV]: 'file:///tmp/updates/' }, controlPlane))
      .toThrow(/http or https/u)
  })
})

describe('plugin tree fingerprint', () => {
  it('is the same for two installs of one dependency set', () => {
    const first = tree({ 'a/package.json': '{"name":"a"}', 'a/index.js': 'x'.repeat(40) })
    const second = tree({ 'a/index.js': 'y'.repeat(40), 'a/package.json': '{"name":"b"}' })
    // Same paths and sizes, different contents and modification times: the
    // fingerprint exists to skip recopying, not to verify the tree.
    expect(pluginTreeFingerprint(first)).toBe(pluginTreeFingerprint(second))
  })

  it('changes when a package is added, removed, or resized', () => {
    const base = tree({ 'a/index.js': 'x' })
    const added = tree({ 'a/index.js': 'x', 'b/index.js': 'x' })
    const resized = tree({ 'a/index.js': 'xx' })
    expect(pluginTreeFingerprint(added)).not.toBe(pluginTreeFingerprint(base))
    expect(pluginTreeFingerprint(resized)).not.toBe(pluginTreeFingerprint(base))
  })

  it('records a link without following it', () => {
    const linked = tree({ 'a/index.js': 'x' }, { 'b': '../elsewhere' })
    const plain = tree({ 'a/index.js': 'x' })
    expect(pluginTreeFingerprint(linked)).not.toBe(pluginTreeFingerprint(plain))
  })
})

describe('Office sidecar', () => {
  const mac = {
    'node/bin/node': '',
    'node_modules/@deepseek-ai/libreoffice-kit/package.json': '{}',
    'node_modules/@deepseek-ai/libreoffice-kit-darwin-arm64/package.json': '{}',
  }

  it('accepts the directory the Runner executable publishes for this platform', () => {
    const directory = tree(mac)
    expect(resolveOfficeSidecar({ [OFFICE_SIDECAR_ENV]: directory }, false)).toBe(directory)
    const windows = tree({
      'node/bin/node.exe': '',
      'node_modules/@deepseek-ai/libreoffice-kit/package.json': '{}',
      'node_modules/@deepseek-ai/libreoffice-kit-win32-x64/package.json': '{}',
    })
    expect(resolveOfficeSidecar({ [OFFICE_SIDECAR_ENV]: windows }, true)).toBe(windows)
  })

  it('refuses a build that names no sidecar', () => {
    expect(() => resolveOfficeSidecar({}, false)).toThrow(/DSH_RUNTIME_DOWNLOAD=office/u)
    expect(() => resolveOfficeSidecar({ [OFFICE_SIDECAR_ENV]: ' ' }, false)).toThrow(/must name the prepared Office sidecar/u)
  })

  it('refuses a sidecar prepared for the other platform or missing its Node runtime', () => {
    const windows = tree({ ...mac, 'node/bin/node.exe': '' })
    // The engine package, not just the kit, decides whether a document converts.
    expect(() => resolveOfficeSidecar({ [OFFICE_SIDECAR_ENV]: windows }, true)).toThrow(/libreoffice-kit-win32-x64/u)
    const { 'node/bin/node': _node, ...withoutNode } = mac
    expect(() => resolveOfficeSidecar({ [OFFICE_SIDECAR_ENV]: tree(withoutNode) }, false)).toThrow(/Node runtime/u)
    const { 'node_modules/@deepseek-ai/libreoffice-kit/package.json': _kit, ...withoutKit } = mac
    expect(() => resolveOfficeSidecar({ [OFFICE_SIDECAR_ENV]: tree(withoutKit) }, false)).toThrow(/libreoffice-kit at/u)
  })
})
