/**
 * The governed catalog engine under a stand-in capability: a `widget` catalog
 * with two listed columns, mounted over the real access-control, audit, and
 * account-store databases, because what the engine decides is only worth
 * testing against the machinery that would otherwise have allowed it. The
 * knowledge, BI, and GMO gateway suites cover the same code through each real
 * capability.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import AccessControlSqlite from '@deepseek-ai/dsh-access-control-sqlite'
import type { AccessControl, ResourceId } from '@deepseek-ai/dsh-access-control'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import AuditSqlite from '@deepseek-ai/dsh-audit-sqlite'
import type { Audit } from '@deepseek-ai/dsh-audit'
import {
  GovernedCatalog,
  applyCatalogSchema,
  type CatalogRow,
  type CatalogSchema,
  type CatalogSource,
  type CatalogView,
  type GovernedPrincipal,
} from '@deepseek-ai/dsh-governed-catalog-sqlite'

const APPLICATION_ID = 0x44534841 + 90
const SCHEMA_VERSION = 1

const DDL = `
CREATE TABLE IF NOT EXISTS widget_source (
  org_id          TEXT    NOT NULL,
  source_code     TEXT    NOT NULL,
  provider_kind   TEXT    NOT NULL,
  last_attempt_at INTEGER NOT NULL,
  last_success_at INTEGER,
  last_failure    TEXT,
  PRIMARY KEY (org_id, source_code)
) STRICT;
CREATE TABLE IF NOT EXISTS widget (
  org_id             TEXT    NOT NULL,
  widget_ref         TEXT    NOT NULL,
  source_code        TEXT    NOT NULL,
  upstream_id        TEXT    NOT NULL,
  display_name       TEXT    NOT NULL,
  color              TEXT    NOT NULL,
  weight             INTEGER,
  admin_enabled      INTEGER NOT NULL CHECK (admin_enabled IN (0, 1)),
  last_discovered_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, widget_ref)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS widget_upstream ON widget (org_id, source_code, upstream_id);
`

const SCHEMA: CatalogSchema = { name: 'widget-catalog', applicationId: APPLICATION_ID, version: SCHEMA_VERSION, ddl: DDL }

/** Stand-in rows: a type alias, so the engine's cast to SQLite's row record is comparable. */
type WidgetRow = CatalogRow<'widget_ref'> & {
  readonly color: string
  readonly weight: number | null
}

interface WidgetEntry {
  readonly ref: string
  readonly displayName: string
  readonly color: string
  readonly weight: number | undefined
  readonly effectiveEnabled: boolean
}

interface UpstreamWidget {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly weight: number | undefined
}

// The stand-in borrows the BI vocabulary: the audit actions and resource types are closed catalogs.
const RESOURCE_TYPE = 'bi_project'
const CATALOG_RESOURCE = 'urn:dsh:admin:widget-catalog'
const ACTION = 'bi.query'

/** The source a test scripts; a Cordis service so the spec reads it per call. */
class WidgetSource extends Service {
  listing: readonly UpstreamWidget[] | Error = []
  listed = 0

  constructor(ctx: Context) {
    super(ctx, 'widgetSource')
  }

  list(): Promise<readonly UpstreamWidget[]> {
    this.listed += 1
    return this.listing instanceof Error ? Promise.reject(this.listing) : Promise.resolve(this.listing)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    widgetSource: WidgetSource
  }
}

let home: string
let ctx: Context
let source: WidgetSource
let access: AccessControl
let audit: Audit
let catalog: GovernedCatalog<'widget_ref', WidgetRow, WidgetEntry, UpstreamWidget>
let ORG: OrgId
let ALICE: UserId
let startsEnabled = false

/** Mount the engine under the stand-in spec. */
function mount(context: Context, path: string): GovernedCatalog<'widget_ref', WidgetRow, WidgetEntry, UpstreamWidget> {
  return new GovernedCatalog(context, { path, journalMode: 'wal', busyTimeoutMs: 1_000 }, {
    name: 'widget-catalog',
    table: 'widget',
    sourceTable: 'widget_source',
    refColumn: 'widget_ref',
    resourceType: RESOURCE_TYPE,
    catalogResource: CATALOG_RESOURCE,
    syncAction: 'bi.catalog.sync',
    failureKey: 'biFailure',
    startsEnabled,
    listedColumns: ['color', 'weight'],
    applySchema: (db) => { applyCatalogSchema(db, SCHEMA) },
    source: (): CatalogSource<UpstreamWidget> => ({
      sourceCode: 'shop',
      providerKind: 'stub',
      list: () => context.widgetSource.list(),
    }),
    describe: (widget) => {
      if (widget.id.includes(':')) throw new Error(`${widget.id} is not a usable widget reference`)
      return {
        ref: `stub:shop:${widget.id}`,
        upstreamId: widget.id,
        displayName: widget.name,
        values: [widget.color, widget.weight ?? null],
      }
    },
    failureReason: error => error instanceof Error && error.message === 'down' ? 'upstream-unavailable' : 'upstream-invalid',
    unknownEntry: () => new Error('no such widget'),
    entry: (row, resource): WidgetEntry => ({
      ref: row.widget_ref,
      displayName: row.display_name,
      color: row.color,
      weight: row.weight ?? undefined,
      effectiveEnabled: row.admin_enabled === 1 && resource.enabled,
    }),
  })
}

beforeEach(async () => {
  startsEnabled = false
  home = mkdtempSync(join(tmpdir(), 'dsh-catalog-'))
  ctx = new Context()
  await ctx.plugin(SqliteAccountStore, { path: join(home, 'accounts.sqlite') }).await()
  await ctx.plugin(AccessControlSqlite, { path: join(home, 'access.sqlite') }).await()
  await ctx.plugin(AuditSqlite, { path: join(home, 'audit.sqlite'), maxQueryRows: 500 }).await()
  await ctx.plugin(WidgetSource).await()
  source = ctx.get('widgetSource') as WidgetSource
  access = ctx.get('accessControl') as AccessControl
  audit = ctx.get('audit') as Audit
  const store = ctx.get('accountStore') as AccountStore
  ORG = (await store.createOrganization('Acme')).id
  ALICE = (await store.createUser({ orgId: ORG, loginName: 'alice', displayName: 'Alice' })).id
  catalog = mount(ctx, join(home, 'widget.sqlite'))
})

afterEach(async () => {
  await ctx.fiber.dispose()
  rmSync(home, { recursive: true, force: true })
})

const widget = (id: string, patch: Partial<UpstreamWidget> = {}): UpstreamWidget => ({
  id, name: `Widget ${id}`, color: 'red', weight: 5, ...patch,
})
const REF_A = 'stub:shop:a'
const REF_B = 'stub:shop:b'
const alice = (): GovernedPrincipal => ({ orgId: ORG, principalId: ALICE })

/** The governed resource one reference is registered as. */
async function resourceOf(ref: string): Promise<ResourceId> {
  const match = (await access.listResources(ORG, RESOURCE_TYPE)).find(item => item.externalRef === ref)
  if (match === undefined) throw new Error(`no governed resource for ${ref}`)
  return match.id
}

/** Grant Alice the action on one entry through a role, as an administrator would. */
async function grant(ref: string): Promise<void> {
  const role = await access.createRole({ orgId: ORG, name: `reader-${ref}` })
  await access.bindUserRole(ALICE, role.id)
  await access.grantResource(role.id, await resourceOf(ref), ACTION)
}

const refs = (view: CatalogView<WidgetEntry>): string[] => view.entries.map(entry => entry.ref)

describe('synchronization', () => {
  it('writes every listed column, governs each entry, and starts it switched off', async () => {
    source.listing = [widget('a', { weight: undefined }), widget('b', { color: 'blue', weight: 9 })]
    const view = await catalog.sync(ORG)
    expect(view.source).toMatchObject({ sourceCode: 'shop', providerKind: 'stub', health: 'healthy', lastFailure: undefined })
    expect(view.entries).toEqual([
      { ref: REF_A, displayName: 'Widget a', color: 'red', weight: undefined, effectiveEnabled: false },
      { ref: REF_B, displayName: 'Widget b', color: 'blue', weight: 9, effectiveEnabled: false },
    ])
    const resources = await access.listResources(ORG, RESOURCE_TYPE)
    expect(resources.map(resource => [resource.externalRef, resource.enabled])).toEqual([[REF_A, false], [REF_B, false]])
  })

  it('starts a new entry switched on when the capability says so', async () => {
    startsEnabled = true
    catalog = mount(ctx, join(home, 'other.sqlite'))
    source.listing = [widget('a')]
    expect((await catalog.sync(ORG)).entries[0]).toMatchObject({ effectiveEnabled: true })
  })

  it('refreshes the name and listed columns of a known entry without touching the switch', async () => {
    source.listing = [widget('a')]
    await catalog.sync(ORG)
    await catalog.setEnabled(ORG, REF_A, true)
    source.listing = [widget('a', { name: 'Renamed', color: 'green', weight: 1 })]
    const view = await catalog.sync(ORG)
    expect(view.entries).toEqual([{ ref: REF_A, displayName: 'Renamed', color: 'green', weight: 1, effectiveEnabled: true }])
  })

  it('retires an entry the listing drops, with the grants that named it', async () => {
    source.listing = [widget('a'), widget('b')]
    await catalog.sync(ORG)
    await grant(REF_A)
    source.listing = [widget('b')]
    expect(refs(await catalog.sync(ORG))).toEqual([REF_B])
    expect((await access.listResources(ORG, RESOURCE_TYPE)).map(resource => resource.externalRef)).toEqual([REF_B])
  })

  it('re-enables a governed resource a half-finished write left disabled', async () => {
    startsEnabled = true
    catalog = mount(ctx, join(home, 'other.sqlite'))
    source.listing = [widget('a')]
    await catalog.sync(ORG)
    await access.setResourceEnabled(await resourceOf(REF_A), false)
    expect((await catalog.view(ORG)).entries[0]).toMatchObject({ effectiveEnabled: false })
    await catalog.sync(ORG)
    expect((await catalog.view(ORG)).entries[0]).toMatchObject({ effectiveEnabled: true })
  })

  it('keeps the last snapshot and records the failure word when the source stops answering', async () => {
    source.listing = [widget('a')]
    await catalog.sync(ORG)
    source.listing = new Error('down')
    const view = await catalog.sync(ORG)
    expect(refs(view)).toEqual([REF_A])
    expect(view.source).toMatchObject({ health: 'failing', lastFailure: 'upstream-unavailable' })
    const [row] = await audit.query({ orgId: ORG, action: 'bi.catalog.sync', outcome: 'error' })
    expect(row).toMatchObject({ resourceId: CATALOG_RESOURCE, metadata: { biFailure: 'upstream-unavailable' } })
    expect(row?.metadata).not.toHaveProperty('itemCount')
  })

  it('reports a source whose first listing failed as failing, with no success to show', async () => {
    source.listing = new Error('down')
    const view = await catalog.sync(ORG)
    expect(view.entries).toEqual([])
    expect(view.source).toMatchObject({ health: 'failing', lastSuccessAt: undefined, lastFailure: 'upstream-unavailable' })
    expect(view.source.lastAttemptAt).toBeTypeOf('number')
  })

  it('records a successful synchronization with how many entries it listed', async () => {
    source.listing = [widget('a'), widget('b')]
    await catalog.sync(ORG)
    const [row] = await audit.query({ orgId: ORG, action: 'bi.catalog.sync' })
    expect(row).toMatchObject({ outcome: 'allowed', resourceId: CATALOG_RESOURCE, metadata: { itemCount: 2 } })
    expect(row?.metadata).not.toHaveProperty('biFailure')
  })

  it('joins concurrent callers to one reconciliation, and starts a new one afterwards', async () => {
    source.listing = [widget('a')]
    const [first, second] = await Promise.all([catalog.sync(ORG), catalog.sync(ORG)])
    expect(first).toEqual(second)
    expect(source.listed).toBe(1)
    await catalog.sync(ORG)
    expect(source.listed).toBe(2)
  })

  it('writes nothing when one listed entry cannot be described', async () => {
    source.listing = [widget('a')]
    await catalog.sync(ORG)
    source.listing = [widget('a', { name: 'Renamed' }), widget('x:y')]
    await expect(catalog.sync(ORG)).rejects.toThrow(/not a usable widget reference/u)
    expect((await catalog.view(ORG)).entries[0]).toMatchObject({ displayName: 'Widget a' })
  })

  it('rolls the whole listing back when the table refuses one row', async () => {
    source.listing = [widget('a'), widget('b')]
    await catalog.sync(ORG)
    const nameless = widget('b', { name: 'placeholder' })
    Reflect.set(nameless, 'name', null)
    source.listing = [widget('a', { name: 'Renamed' }), nameless]
    await expect(catalog.sync(ORG)).rejects.toThrow()
    expect((await catalog.view(ORG)).entries.map(entry => entry.displayName)).toEqual(['Widget a', 'Widget b'])
  })
})

describe('the catalog view', () => {
  it('reports a source nobody has synchronized yet', async () => {
    const view = await catalog.view(ORG)
    expect(view.source).toMatchObject({
      sourceCode: 'shop', providerKind: 'stub', health: 'never-synced', lastAttemptAt: undefined, lastSuccessAt: undefined,
    })
    expect(view.entries).toEqual([])
  })

  it('hides a row whose governed resource is missing, as an interrupted registration', async () => {
    source.listing = [widget('a')]
    await catalog.sync(ORG)
    await access.deleteResource(await resourceOf(REF_A))
    expect(refs(await catalog.view(ORG))).toEqual([])
    expect(catalog.rows(ORG)).toHaveLength(1)
  })
})

describe('switching an entry', () => {
  it('switches the row and its governed resource together', async () => {
    source.listing = [widget('a')]
    await catalog.sync(ORG)
    await catalog.setEnabled(ORG, REF_A, true)
    expect((await access.listResources(ORG, RESOURCE_TYPE))[0]?.enabled).toBe(true)
    await catalog.setEnabled(ORG, REF_A, false)
    expect(catalog.row(ORG, REF_A)?.admin_enabled).toBe(0)
    expect((await access.listResources(ORG, RESOURCE_TYPE))[0]?.enabled).toBe(false)
  })

  it('still switches the row when its governed resource is missing', async () => {
    source.listing = [widget('a')]
    await catalog.sync(ORG)
    await access.deleteResource(await resourceOf(REF_A))
    await catalog.setEnabled(ORG, REF_A, true)
    expect(catalog.row(ORG, REF_A)?.admin_enabled).toBe(1)
  })

  it('refuses with the capability’s own error for an entry the catalog does not hold', async () => {
    await expect(catalog.setEnabled(ORG, REF_A, true)).rejects.toThrow('no such widget')
  })
})

describe('admission', () => {
  beforeEach(async () => {
    source.listing = [widget('a'), widget('b')]
    await catalog.sync(ORG)
    await catalog.setEnabled(ORG, REF_A, true)
    await catalog.setEnabled(ORG, REF_B, true)
    await grant(REF_A)
  })

  it('admits a granted, enabled entry and returns its row', async () => {
    expect(await catalog.admit(alice(), REF_A, ACTION)).toMatchObject({ widget_ref: REF_A, upstream_id: 'a', color: 'red' })
  })

  it.each([
    ['one the principal holds no grant on', REF_B],
    ['one the catalog does not hold', 'stub:shop:zzz'],
  ])('refuses %s', async (_label, ref) => {
    expect(await catalog.admit(alice(), ref, ACTION)).toBeUndefined()
  })

  it('refuses an entry an administrator switched off, grant or not', async () => {
    await catalog.setEnabled(ORG, REF_A, false)
    expect(await catalog.admit(alice(), REF_A, ACTION)).toBeUndefined()
  })

  it('asks access control fresh with the device and correlation it was given', async () => {
    const asked: unknown[] = []
    const control = ctx.get('accessControl') as AccessControl
    const authorize = control.authorize.bind(control)
    control.authorize = (request) => {
      asked.push(request)
      return authorize(request)
    }
    await catalog.admit({ ...alice(), deviceId: 'device-1', correlationId: 'corr-1' }, REF_A, ACTION)
    expect(asked).toEqual([{
      orgId: ORG,
      principalId: ALICE,
      deviceId: 'device-1',
      action: ACTION,
      resourceType: RESOURCE_TYPE,
      resourceId: REF_A,
      context: { sessionCorrelationId: 'corr-1' },
    }])
  })

  it('lists only enabled, granted entries, never the catalog administration resource', async () => {
    const role = await access.createRole({ orgId: ORG, name: 'everything' })
    await access.bindUserRole(ALICE, role.id)
    await access.grantType(role.id, RESOURCE_TYPE, ACTION)
    await catalog.setEnabled(ORG, REF_B, false)
    expect((await catalog.authorizedEntries(alice(), ACTION)).map(entry => entry.ref)).toEqual([REF_A])
  })

  it('leaves out an entry whose governed resource is missing', async () => {
    await access.deleteResource(await resourceOf(REF_A))
    expect(await catalog.authorizedEntries(alice(), ACTION)).toEqual([])
  })
})

describe('recording an outcome', () => {
  it('stores the principal, the device, the correlation, and only the metadata that is defined', async () => {
    await catalog.record(
      { ...alice(), deviceId: 'device-1', correlationId: 'corr-1' },
      { action: 'bi.query', outcome: 'denied', resourceId: REF_A, reason: 'no-grant', metadata: { itemCount: undefined, biFailure: undefined } },
    )
    const [row] = await audit.query({ orgId: ORG, action: 'bi.query' })
    expect(row).toMatchObject({
      outcome: 'denied', principalId: ALICE, resourceId: REF_A, deviceId: 'device-1', correlationId: 'corr-1', reason: 'no-grant',
    })
    expect(row?.metadata).toEqual({})
  })

  it('leaves out the fields a request does not have', async () => {
    await catalog.record(alice(), { action: 'bi.query', outcome: 'allowed', metadata: { itemCount: 3 } })
    const [row] = await audit.query({ orgId: ORG, action: 'bi.query' })
    expect(row).toMatchObject({ outcome: 'allowed', metadata: { itemCount: 3 } })
    expect(row?.resourceId).toBeUndefined()
    expect(row?.deviceId).toBeUndefined()
    expect(row?.correlationId).toBeUndefined()
    expect(row?.reason).toBeUndefined()
  })
})

describe('the database', () => {
  it('closes with the fiber that opened it', async () => {
    const isolated = new Context()
    const closing = mount(isolated, join(home, 'closing.sqlite'))
    expect(closing.rows(ORG)).toEqual([])
    await isolated.fiber.dispose()
    expect(() => closing.rows(ORG)).toThrow(/not open/u)
  })

  it('applies the schema idempotently and reopens its own file', () => {
    const path = join(home, 'again.sqlite')
    mount(ctx, path)
    expect(() => mount(ctx, path)).not.toThrow()
  })
})

describe('applyCatalogSchema', () => {
  /** Open a database already stamped as a file written by some build. */
  function stamped(applicationId: number, version: number): DatabaseSync {
    const db = new DatabaseSync(':memory:')
    db.exec(`PRAGMA application_id = ${applicationId}`)
    db.exec(`PRAGMA user_version = ${version}`)
    return db
  }

  it('stamps an empty database with the application id and version', () => {
    const db = new DatabaseSync(':memory:')
    applyCatalogSchema(db, SCHEMA)
    expect(db.prepare('PRAGMA application_id').get()).toEqual({ application_id: APPLICATION_ID })
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()).toEqual([
      { name: 'widget' }, { name: 'widget_source' },
    ])
  })

  it('accepts a database it wrote itself', () => {
    const db = stamped(APPLICATION_ID, SCHEMA_VERSION)
    expect(() => { applyCatalogSchema(db, SCHEMA) }).not.toThrow()
  })

  it('refuses a file that belongs to another application', () => {
    expect(() => { applyCatalogSchema(stamped(APPLICATION_ID + 1, 0), SCHEMA) })
      .toThrow(`widget-catalog: database belongs to another application (application_id ${APPLICATION_ID + 1})`)
  })

  it('refuses a newer schema without migrating', () => {
    expect(() => { applyCatalogSchema(stamped(APPLICATION_ID, SCHEMA_VERSION + 1), SCHEMA) })
      .toThrow(`widget-catalog: database schema ${SCHEMA_VERSION + 1} is newer than this build's ${SCHEMA_VERSION}`)
  })

  it('refuses an older schema and says how to rebuild it', () => {
    expect(() => { applyCatalogSchema(stamped(APPLICATION_ID, SCHEMA_VERSION), { ...SCHEMA, version: SCHEMA_VERSION + 1 }) })
      .toThrow(`widget-catalog: database schema ${SCHEMA_VERSION} is older than this build's ${SCHEMA_VERSION + 1}; delete the file and synchronize again`)
  })
})
