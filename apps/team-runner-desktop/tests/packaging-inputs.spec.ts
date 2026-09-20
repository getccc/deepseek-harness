import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { APP_VERSION_ENV, pluginTreeFingerprint, resolveAppVersion } from '../scripts/packaging-inputs.mjs'

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
