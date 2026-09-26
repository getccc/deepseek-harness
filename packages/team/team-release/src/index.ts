/**
 * Published desktop releases: what a deployment offers, to whom, and the
 * oldest build it still accepts.
 *
 * The store never signs anything. A release arrives already signed by the
 * release machine and is recorded byte for byte, so a compromised Control
 * Plane can withhold a release or offer an older one — which the installed
 * application refuses as `not-newer` — but cannot publish a release of its own.
 * @module @deepseek-ai/dsh-team-release
 */

import { DatabaseSync } from 'node:sqlite'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import { compareVersions, versionComponents } from '@deepseek-ai/dsh-team-update'
import { applySchema, type FloorRow, type ReleaseRow } from './schema.ts'
import type { PublishRelease, PublishedRelease, ReleaseChannel, ReleaseFloor } from './types.ts'

export { SCHEMA_VERSION, TEAM_RELEASE_APPLICATION_ID } from './schema.ts'
export type { PublishRelease, PublishedRelease, ReleaseChannel, ReleaseFloor } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    teamReleases: TeamReleaseStore
  }
}

/** Raised when a release's manifest does not describe the version it is published as. */
export class ReleaseVersionMismatchError extends Error {
  constructor(readonly version: string, readonly manifestVersion: string) {
    super(`the manifest describes ${manifestVersion}, not ${version}`)
    this.name = 'ReleaseVersionMismatchError'
  }
}

/** Plugin config: where the published releases live. */
export interface Config {
  /** Path to the release database. */
  path: string
  /** SQLite journal mode; `wal` lets readers run beside the one writer. */
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'
  /** How long a write waits for the lock before it fails. */
  busyTimeoutMs?: number
}

/** The resource type a role is granted to receive releases before everyone else. */
export const RELEASE_RESOURCE_TYPE = 'release'

/** The action a role holds to be offered staged releases. */
export const RELEASE_STAGED_ACTION = 'release.staged'

/** Display name of the governed release resource, wherever it is registered first. */
export const RELEASE_RESOURCE_NAME = 'Client releases'

/** The action an administrator holds to publish, promote, and withdraw releases. */
export const RELEASE_MANAGE_ACTION = 'release.manage'

/** Cordis plugin name. */
export const name = 'team-release'

/**
 * The published releases of one deployment, over SQLite.
 *
 * Versions are ordered by their numbers rather than as text, because that is
 * the order the installed application compares them in; `1.0.10` is newer than
 * `1.0.9` here for the same reason it is there.
 */
export class TeamReleaseStore extends Service {
  static Config: z<Config> = z.object({
    path: z.string().required(),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    busyTimeoutMs: z.natural().default(1_000),
  })

  private readonly db: DatabaseSync

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'teamReleases')
    this.db = new DatabaseSync(config.path, { timeout: config.busyTimeoutMs })
    applySchema(this.db)
    this.db.exec(`PRAGMA journal_mode = ${config.journalMode ?? 'wal'}`)
    // SQLite builds may default WAL to NORMAL, which can lose a resolved write to power loss.
    this.db.exec('PRAGMA synchronous = FULL')
    ctx.effect(() => () => { this.db.close() }, 'team-release: close the release store')
  }

  /**
   * Record one release, or replace the record of a version published before.
   *
   * The manifest is checked against the version it is published as, which is
   * the one mistake that would otherwise ship a signature over another
   * release's files.
   * @param orgId - the organization publishing it.
   * @param release - the signed manifest, its signature, and who it is offered to.
   * @returns the recorded release.
   * @throws {ReleaseVersionMismatchError} when the manifest describes another version.
   */
  publish(orgId: OrgId, release: PublishRelease): PublishedRelease {
    versionComponents(release.version)
    const described = manifestVersion(release.manifest)
    if (described !== release.version) throw new ReleaseVersionMismatchError(release.version, described)
    const publishedAt = Date.now()
    this.db.prepare(`
      INSERT INTO team_release (org_id, version, manifest, signature, channel, published_at, withdrawn_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT (org_id, version) DO UPDATE SET
        manifest = excluded.manifest,
        signature = excluded.signature,
        channel = excluded.channel,
        published_at = excluded.published_at,
        withdrawn_at = NULL
    `).run(orgId, release.version, release.manifest, release.signature, release.channel, publishedAt)
    return { ...release, publishedAt }
  }

  /**
   * Stop offering one release without forgetting it was published.
   * @param orgId - the organization that published it.
   * @param version - the release to withdraw.
   * @returns whether a release was withdrawn.
   */
  withdraw(orgId: OrgId, version: string): boolean {
    const result = this.db
      .prepare('UPDATE team_release SET withdrawn_at = ? WHERE org_id = ? AND version = ? AND withdrawn_at IS NULL')
      .run(Date.now(), orgId, version)
    return result.changes > 0
  }

  /**
   * Every release this organization published, newest first.
   * @param orgId - the organization.
   * @returns the releases, withdrawn ones included.
   */
  list(orgId: OrgId): readonly PublishedRelease[] {
    const rows = this.db.prepare('SELECT * FROM team_release WHERE org_id = ?').all(orgId) as unknown as ReleaseRow[]
    return rows.map(toRelease).sort((left, right) => compareVersions(right.version, left.version))
  }

  /**
   * The newest release offered to one member.
   *
   * A staged release is offered only to members whose roles grant the staged
   * channel; everyone else is offered the newest general release, even when a
   * staged one is newer.
   * @param orgId - the organization.
   * @param staged - whether this member is offered staged releases.
   * @returns the release to offer, or undefined when none is.
   */
  offered(orgId: OrgId, staged: boolean): PublishedRelease | undefined {
    return this.list(orgId).find(release => (
      release.withdrawnAt === undefined && (staged || release.channel === 'general')
    ))
  }

  /**
   * The oldest version this deployment still accepts.
   * @param orgId - the organization.
   * @returns the floor, or undefined when the deployment sets none.
   */
  floor(orgId: OrgId): ReleaseFloor | undefined {
    const row = this.db
      .prepare('SELECT * FROM team_release_floor WHERE org_id = ?')
      .get(orgId) as unknown as FloorRow | undefined
    return row === undefined ? undefined : { version: row.minimum_version, updatedAt: row.updated_at }
  }

  /**
   * Set or clear the oldest version this deployment accepts.
   * @param orgId - the organization.
   * @param version - the floor, or undefined to accept every version.
   * @returns the floor now in force, or undefined when it was cleared.
   */
  setFloor(orgId: OrgId, version: string | undefined): ReleaseFloor | undefined {
    if (version === undefined) {
      this.db.prepare('DELETE FROM team_release_floor WHERE org_id = ?').run(orgId)
      return undefined
    }
    versionComponents(version)
    const updatedAt = Date.now()
    this.db.prepare(`
      INSERT INTO team_release_floor (org_id, minimum_version, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (org_id) DO UPDATE SET minimum_version = excluded.minimum_version, updated_at = excluded.updated_at
    `).run(orgId, version, updatedAt)
    return { version, updatedAt }
  }
}

/** The version a stored manifest document describes. */
function manifestVersion(document: string): string {
  const parsed = JSON.parse(document) as { manifest?: { version?: unknown } }
  const version = parsed.manifest?.version
  if (typeof version !== 'string') throw new Error('the published document carries no manifest version')
  return version
}

/** One stored row as the service returns it. */
function toRelease(row: ReleaseRow): PublishedRelease {
  return {
    version: row.version,
    manifest: row.manifest,
    signature: row.signature,
    channel: row.channel as ReleaseChannel,
    publishedAt: row.published_at,
    ...row.withdrawn_at === null ? {} : { withdrawnAt: row.withdrawn_at },
  }
}

export default TeamReleaseStore
