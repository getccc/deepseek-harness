import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import TeamReleaseStore, { ReleaseVersionMismatchError } from '../src/index.ts'

const ORG = 'org-1' as OrgId
const roots: string[] = []

/** One store over a private database file. */
async function store(): Promise<{ releases: TeamReleaseStore; dispose: () => Promise<void> }> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-release-store-'))
  roots.push(root)
  const ctx = new Context()
  const fiber = ctx.plugin(TeamReleaseStore, { path: join(root, 'releases.sqlite') })
  await fiber.await()
  return { releases: ctx.get('teamReleases') as TeamReleaseStore, dispose: async () => { await fiber.dispose() } }
}

/** A published document for one version. */
function document(version: string): string {
  return JSON.stringify({ manifest: { manifestVersion: 1, version, minimumFrom: '1.0.0', publishedAt: 1, artifacts: [] }, signature: 'sig' })
}

/** Publish one release into a store. */
function publish(releases: TeamReleaseStore, version: string, channel: 'staged' | 'general' = 'general') {
  return releases.publish(ORG, { version, manifest: document(version), signature: `sig-${version}`, channel })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('published releases', () => {
  it('orders releases by their numbers, not as text', async () => {
    const { releases, dispose } = await store()
    publish(releases, '1.0.9')
    publish(releases, '1.0.10')
    publish(releases, '1.1.0')
    expect(releases.list(ORG).map(release => release.version)).toEqual(['1.1.0', '1.0.10', '1.0.9'])
    await dispose()
  })

  it('offers a staged release only to members who are offered staged releases', async () => {
    const { releases, dispose } = await store()
    publish(releases, '1.0.0')
    publish(releases, '1.1.0', 'staged')
    expect(releases.offered(ORG, false)?.version).toBe('1.0.0')
    expect(releases.offered(ORG, true)?.version).toBe('1.1.0')
    // Promoting it is one publish of the same version on the general channel.
    publish(releases, '1.1.0')
    expect(releases.offered(ORG, false)?.version).toBe('1.1.0')
    await dispose()
  })

  it('offers nothing from a withdrawn release, and remembers it was published', async () => {
    const { releases, dispose } = await store()
    publish(releases, '1.0.0')
    publish(releases, '1.1.0')
    expect(releases.withdraw(ORG, '1.1.0')).toBe(true)
    expect(releases.withdraw(ORG, '1.1.0')).toBe(false)
    expect(releases.offered(ORG, true)?.version).toBe('1.0.0')
    expect(releases.list(ORG).map(release => release.version)).toEqual(['1.1.0', '1.0.0'])
    expect(releases.list(ORG)[0]?.withdrawnAt).toBeTypeOf('number')
    await dispose()
  })

  it('refuses a manifest that describes another version', async () => {
    const { releases, dispose } = await store()
    expect(() => releases.publish(ORG, {
      version: '1.1.0', manifest: document('1.2.0'), signature: 'sig', channel: 'general',
    })).toThrow(ReleaseVersionMismatchError)
    expect(() => releases.publish(ORG, {
      version: 'latest', manifest: document('latest'), signature: 'sig', channel: 'general',
    })).toThrow(/not one or more dot-separated numbers/u)
    await dispose()
  })

  it('records the floor and clears it', async () => {
    const { releases, dispose } = await store()
    expect(releases.floor(ORG)).toBeUndefined()
    expect(releases.setFloor(ORG, '1.0.0')?.version).toBe('1.0.0')
    expect(releases.floor(ORG)?.version).toBe('1.0.0')
    expect(releases.setFloor(ORG, '1.1.0')?.version).toBe('1.1.0')
    expect(releases.setFloor(ORG, undefined)).toBeUndefined()
    expect(releases.floor(ORG)).toBeUndefined()
    await dispose()
  })

  it('replaces the record of a version published again', async () => {
    const { releases, dispose } = await store()
    publish(releases, '1.0.0', 'staged')
    releases.withdraw(ORG, '1.0.0')
    publish(releases, '1.0.0')
    const [release] = releases.list(ORG)
    expect(release).toMatchObject({ version: '1.0.0', channel: 'general' })
    expect(release?.withdrawnAt).toBeUndefined()
    await dispose()
  })
})
