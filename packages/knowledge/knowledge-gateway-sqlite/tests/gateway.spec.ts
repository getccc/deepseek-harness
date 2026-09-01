/**
 * The governed gateway against a real access-control provider and a real audit
 * store, because the guarantees worth proving here are relationships between
 * three stores rather than one function's return value: what a role admits,
 * what the catalog holds, and what an audit row is allowed to say.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AccessControlSqlite from '@deepseek-ai/dsh-access-control-sqlite'
import type { AccessControl, ResourceId, Role, RoleId } from '@deepseek-ai/dsh-access-control'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import AuditSqlite from '@deepseek-ai/dsh-audit-sqlite'
import type { Audit } from '@deepseek-ai/dsh-audit'
import { KnowledgeError, KnowledgeRef, type KnowledgeScopeSelection } from '@deepseek-ai/dsh-knowledge'
import {
  KNOWLEDGE_CATALOG_RESOURCE,
  KNOWLEDGE_RESOURCE_TYPE,
  type KnowledgeGateway,
} from '@deepseek-ai/dsh-knowledge-gateway'
import {
  KnowledgeSource,
  type UpstreamKnowledgeBase,
  type UpstreamPassage,
  type UpstreamSearchRequest,
} from '@deepseek-ai/dsh-knowledge-source'
import SqliteKnowledgeGateway, {
  KNOWLEDGE_GATEWAY_SQLITE_APPLICATION_ID,
  SCHEMA_VERSION,
} from '@deepseek-ai/dsh-knowledge-gateway-sqlite'

const A = '690c0727-1af5-4b7a-8465-ebd2845f2266'
const B = '08f25606-8876-49cc-b509-70e84828db08'
const REF_A = KnowledgeRef(`stub:prod:${A}`)
const REF_B = KnowledgeRef(`stub:prod:${B}`)

/** A knowledge source whose listing and answers a test scripts. */
class ScriptedSource extends KnowledgeSource {
  override readonly providerKind = 'stub'
  override readonly sourceCode = 'prod'
  /** What the next listing returns, or the failure it raises. */
  listing: readonly UpstreamKnowledgeBase[] | Error = []
  /** The scopes `search` was called with, so a test can assert what left. */
  readonly searched: UpstreamSearchRequest[] = []
  /** What the next search returns, or the failure it raises. */
  hits: readonly UpstreamPassage[] | Error = []

  list(): Promise<readonly UpstreamKnowledgeBase[]> {
    return this.listing instanceof Error ? Promise.reject(this.listing) : Promise.resolve(this.listing)
  }

  search(request: UpstreamSearchRequest): Promise<readonly UpstreamPassage[]> {
    this.searched.push(request)
    return this.hits instanceof Error ? Promise.reject(this.hits) : Promise.resolve(this.hits)
  }
}

/** One upstream knowledge base, as a listing describes it. */
function upstream(upstreamId: string, patch: Partial<UpstreamKnowledgeBase> = {}): UpstreamKnowledgeBase {
  return {
    upstreamId,
    name: upstreamId === A ? '临港知识库' : '南昌知识库',
    description: '',
    kind: 'document',
    documentCount: 1,
    chunkCount: 0,
    processingCount: 0,
    embeddingModelId: 'emb-shared',
    updatedAt: undefined,
    ...patch,
  }
}

/** One passage, as a source answers with it. */
function passage(upstreamId: string): UpstreamPassage {
  return { upstreamId, title: '运维手册', text: '一级故障 30 分钟内响应。', truncated: false, score: 0.3 }
}

let home: string
let ctx: Context
let source: ScriptedSource
let access: AccessControl
let audit: Audit
let gateway: KnowledgeGateway
let ORG: OrgId
let ALICE: UserId
let BOB: UserId

/** Everything the gateway injects, mounted over one home directory. */
async function dependencies(root: string): Promise<Context> {
  const assembled = new Context()
  await assembled.plugin(SqliteAccountStore, { path: join(root, 'accounts.sqlite') }).await()
  await assembled.plugin(AccessControlSqlite, { path: join(root, 'access.sqlite') }).await()
  await assembled.plugin(AuditSqlite, { path: join(root, 'audit.sqlite'), maxQueryRows: 500 }).await()
  await assembled.plugin(ScriptedSource).await()
  return assembled
}

/** Mount the whole Control Plane half over one home directory. */
async function assemble(root: string): Promise<Context> {
  const assembled = await dependencies(root)
  await assembled.plugin(SqliteKnowledgeGateway, { path: join(root, 'knowledge.sqlite') }).await()
  return assembled
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'dsh-knowledge-'))
  ctx = await assemble(home)
  source = ctx.get('knowledgeSource') as ScriptedSource
  access = ctx.get('accessControl') as AccessControl
  audit = ctx.get('audit') as Audit
  gateway = ctx.get('knowledgeGateway') as KnowledgeGateway
  const store = ctx.get('accountStore') as AccountStore
  ORG = (await store.createOrganization('Acme')).id
  ALICE = (await store.createUser({ orgId: ORG, loginName: 'alice', displayName: 'Alice' })).id
  BOB = (await store.createUser({ orgId: ORG, loginName: 'bob', displayName: 'Bob' })).id
})

afterEach(async () => {
  await ctx.fiber.dispose()
  rmSync(home, { recursive: true, force: true })
})

/** Create a role bound to one member. */
async function roleFor(userId: UserId, name: string): Promise<Role> {
  const role = await access.createRole({ orgId: ORG, name })
  await access.bindUserRole(userId, role.id)
  return role
}

/** The managed resource one knowledge reference is governed as. */
async function resourceOf(ref: string): Promise<ResourceId> {
  const resources = await access.listResources(ORG, KNOWLEDGE_RESOURCE_TYPE)
  const match = resources.find(resource => resource.externalRef === ref)
  if (match === undefined) throw new Error(`no managed resource for ${ref}`)
  return match.id
}

/** Sync a catalog holding both knowledge bases. */
async function syncBoth(): Promise<void> {
  source.listing = [upstream(A), upstream(B)]
  await gateway.sync(ORG)
}

/** A `selected` scope over the given references. */
function selected(...refs: string[]): KnowledgeScopeSelection {
  return { mode: 'selected', refs: refs.map(ref => KnowledgeRef(ref)) }
}

describe('synchronizing the catalog', () => {
  it('mints a stable reference and governs each knowledge base', async () => {
    await syncBoth()
    const view = await gateway.catalogView(ORG)
    expect(view.entries.map(entry => entry.ref)).toEqual([REF_B, REF_A].sort())
    expect(view.source).toMatchObject({ sourceCode: 'prod', providerKind: 'stub', health: 'healthy' })
    const resources = await access.listResources(ORG, KNOWLEDGE_RESOURCE_TYPE)
    expect(resources.map(resource => resource.externalRef).sort()).toEqual([REF_B, REF_A].sort())
  })

  it('keeps identity and grants across an upstream rename', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'reader')
    await access.grantResource(role.id, await resourceOf(REF_A), 'knowledge.search')
    source.listing = [upstream(A, { name: '临港知识库（2026）' }), upstream(B)]
    await gateway.sync(ORG)
    const view = await gateway.catalogView(ORG)
    expect(view.entries.find(entry => entry.ref === REF_A)?.displayName).toBe('临港知识库（2026）')
    // The grant still admits: the reference, not the name, is the identity.
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory.map(entry => entry.ref)).toEqual([REF_A])
  })

  it('disables a vanished entry without deleting it or its grants', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'reader')
    const grant = await access.grantResource(role.id, await resourceOf(REF_A), 'knowledge.search')
    source.listing = [upstream(B)]
    await gateway.sync(ORG)
    const view = await gateway.catalogView(ORG)
    const entry = view.entries.find(candidate => candidate.ref === REF_A)
    expect(entry).toMatchObject({ remotePresent: false, effectiveEnabled: false })
    // The grant survives, so a temporary removal is reversible.
    expect((await access.listRoleGrants(role.id)).map(held => held.id)).toContain(grant)
    expect(await gateway.directory({ orgId: ORG, principalId: ALICE })).toEqual([])
  })

  it('restores a returning entry, and its grant admits again', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'reader')
    await access.grantResource(role.id, await resourceOf(REF_A), 'knowledge.search')
    source.listing = [upstream(B)]
    await gateway.sync(ORG)
    await syncBoth()
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory.map(entry => entry.ref)).toEqual([REF_A])
  })

  it('never overrides an administrator’s disable', async () => {
    await syncBoth()
    await gateway.setEnabled(ORG, REF_A, false)
    await syncBoth()
    const view = await gateway.catalogView(ORG)
    expect(view.entries.find(entry => entry.ref === REF_A)).toMatchObject({
      adminEnabled: false,
      remotePresent: true,
      effectiveEnabled: false,
    })
  })

  it('keeps the last successful snapshot when the source stops answering', async () => {
    await syncBoth()
    source.listing = new KnowledgeError('upstream-unavailable')
    const view = await gateway.sync(ORG)
    expect(view.entries).toHaveLength(2)
    expect(view.source).toMatchObject({ health: 'failing', lastFailure: 'upstream-unavailable' })
    const [row] = await audit.query({ orgId: ORG, action: 'knowledge.catalog.sync' })
    expect(row).toMatchObject({
      outcome: 'error',
      resourceId: KNOWLEDGE_CATALOG_RESOURCE,
      metadata: { knowledgeFailure: 'upstream-unavailable' },
    })
  })

  it('reports a source nobody has synced yet', async () => {
    const view = await gateway.catalogView(ORG)
    expect(view.source).toMatchObject({ health: 'never-synced', lastAttemptAt: undefined })
    expect(view.entries).toEqual([])
  })

  it('joins concurrent callers to one reconciliation', async () => {
    source.listing = [upstream(A)]
    const [first, second] = await Promise.all([
      gateway.sync(ORG),
      gateway.sync(ORG),
    ])
    expect(first).toEqual(second)
    expect((await audit.query({ orgId: ORG, action: 'knowledge.catalog.sync' }))).toHaveLength(1)
  })

  it('refuses to switch an entry the catalog does not hold', async () => {
    await expect(gateway.setEnabled(ORG, REF_A, false))
      .rejects.toMatchObject({ reason: 'not-allowed' })
  })
})

describe('who may see what', () => {
  it('shows a principal holding nothing an empty directory', async () => {
    await syncBoth()
    expect(await gateway.directory({ orgId: ORG, principalId: ALICE })).toEqual([])
  })

  it('shows every enabled base under a type grant', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-knowledge')
    await access.grantType(role.id, KNOWLEDGE_RESOURCE_TYPE, 'knowledge.search')
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory.map(entry => entry.ref).sort()).toEqual([REF_A, REF_B].sort())
  })

  it('never offers the administration catalog resource as a knowledge base', async () => {
    await syncBoth()
    // The catalog administration resource shares the knowledge_scope type, so a
    // type grant on knowledge.search admits it too. It is not a knowledge base,
    // and enumerating the durable catalog rather than listResources is what
    // keeps it out.
    await access.registerResource({
      orgId: ORG,
      type: KNOWLEDGE_RESOURCE_TYPE,
      externalRef: KNOWLEDGE_CATALOG_RESOURCE,
      displayName: 'Knowledge catalog administration',
    })
    const role = await roleFor(ALICE, 'all-knowledge')
    await access.grantType(role.id, KNOWLEDGE_RESOURCE_TYPE, 'knowledge.search')
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory.map(entry => entry.ref)).not.toContain(KNOWLEDGE_CATALOG_RESOURCE)
    expect(directory).toHaveLength(2)
    const view = await gateway.catalogView(ORG)
    expect(view.entries.map(entry => entry.ref)).not.toContain(KNOWLEDGE_CATALOG_RESOURCE)
  })

  it('gives two principals with disjoint grants disjoint directories', async () => {
    await syncBoth()
    const alice = await roleFor(ALICE, 'lingang')
    const bob = await roleFor(BOB, 'nanchang')
    await access.grantResource(alice.id, await resourceOf(REF_A), 'knowledge.search')
    await access.grantResource(bob.id, await resourceOf(REF_B), 'knowledge.search')
    expect((await gateway.directory({ orgId: ORG, principalId: ALICE })).map(e => e.ref)).toEqual([REF_A])
    expect((await gateway.directory({ orgId: ORG, principalId: BOB })).map(e => e.ref)).toEqual([REF_B])
  })

  it('unions the grants of several roles', async () => {
    await syncBoth()
    const first = await roleFor(ALICE, 'lingang')
    const second = await roleFor(ALICE, 'nanchang')
    await access.grantResource(first.id, await resourceOf(REF_A), 'knowledge.search')
    await access.grantResource(second.id, await resourceOf(REF_B), 'knowledge.search')
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory.map(entry => entry.ref).sort()).toEqual([REF_A, REF_B].sort())
  })

  it('drops a base an administrator disabled', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-knowledge')
    await access.grantType(role.id, KNOWLEDGE_RESOURCE_TYPE, 'knowledge.search')
    await gateway.setEnabled(ORG, REF_A, false)
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory.map(entry => entry.ref)).toEqual([REF_B])
  })
})

describe('searching', () => {
  /** Grant one member search on both bases and script two hits. */
  async function grantBoth(): Promise<RoleId> {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-knowledge')
    await access.grantType(role.id, KNOWLEDGE_RESOURCE_TYPE, 'knowledge.search')
    source.hits = [passage(A), passage(B)]
    return role.id
  }

  it('sends the authorized upstream ids and maps hits back to references', async () => {
    await grantBoth()
    const result = await gateway.search({
      orgId: ORG, principalId: ALICE, scope: { mode: 'all' }, query: '年假',
    })
    expect(source.searched[0]?.upstreamIds.slice().sort()).toEqual([A, B].sort())
    expect(result.passages.map(hit => hit.ref).sort()).toEqual([REF_A, REF_B].sort())
    expect(result.searched.map(entry => entry.displayName).sort()).toEqual(['临港知识库', '南昌知识库'].sort())
  })

  it('narrows to a selected subset without widening it', async () => {
    await grantBoth()
    source.hits = [passage(A)]
    await gateway.search({
      orgId: ORG, principalId: ALICE, scope: selected(REF_A), query: '年假',
    })
    expect(source.searched[0]?.upstreamIds).toEqual([A])
  })

  it('refuses the whole request when one selected base is unauthorized', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'lingang')
    await access.grantResource(role.id, await resourceOf(REF_A), 'knowledge.search')
    source.hits = [passage(A)]
    await expect(gateway.search({
      orgId: ORG, principalId: ALICE, scope: selected(REF_A, REF_B), query: '年假',
    })).rejects.toMatchObject({ reason: 'not-allowed' })
    // Not even a partial search: nothing reached the source.
    expect(source.searched).toHaveLength(0)
  })

  it('answers an unknown reference exactly as it answers an unauthorized one', async () => {
    await grantBoth()
    const unknown = KnowledgeRef('stub:prod:00000000-0000-0000-0000-000000000000')
    const refused = await gateway.search({
      orgId: ORG, principalId: ALICE, scope: selected(unknown), query: '年假',
    }).catch((error: unknown) => error)
    expect(refused).toMatchObject({ reason: 'not-allowed' })
    await syncBoth()
    const bob = await roleFor(BOB, 'none')
    expect(bob.id).toBeDefined()
    const unauthorized = await gateway.search({
      orgId: ORG, principalId: BOB, scope: selected(REF_A), query: '年假',
    }).catch((error: unknown) => error)
    expect((unauthorized as KnowledgeError).reason).toBe((refused as KnowledgeError).reason)
  })

  it('refuses an all-mode search for a principal holding nothing', async () => {
    await syncBoth()
    await expect(gateway.search({
      orgId: ORG, principalId: ALICE, scope: { mode: 'all' }, query: '年假',
    })).rejects.toMatchObject({ reason: 'not-allowed' })
    expect(source.searched).toHaveLength(0)
  })

  it('takes effect on the next call after a grant is revoked', async () => {
    const roleId = await grantBoth()
    await gateway.search({ orgId: ORG, principalId: ALICE, scope: { mode: 'all' }, query: '年假' })
    const grants = await access.listRoleGrants(roleId)
    for (const grant of grants) await access.revokeGrant(grant.id)
    await expect(gateway.search({
      orgId: ORG, principalId: ALICE, scope: { mode: 'all' }, query: '年假',
    })).rejects.toMatchObject({ reason: 'not-allowed' })
  })

  it('refuses a scope whose bases do not share one embedding model', async () => {
    source.listing = [upstream(A), upstream(B, { embeddingModelId: 'emb-other' })]
    await gateway.sync(ORG)
    const role = await roleFor(ALICE, 'all-knowledge')
    await access.grantType(role.id, KNOWLEDGE_RESOURCE_TYPE, 'knowledge.search')
    await expect(gateway.search({
      orgId: ORG, principalId: ALICE, scope: { mode: 'all' }, query: '年假',
    })).rejects.toMatchObject({ reason: 'scope-incompatible' })
    // Refused before the call, because the upstream declares no error for it.
    expect(source.searched).toHaveLength(0)
    // A single base out of that set still searches.
    source.hits = [passage(A)]
    await expect(gateway.search({
      orgId: ORG, principalId: ALICE, scope: selected(REF_A), query: '年假',
    })).resolves.toMatchObject({ passages: [expect.objectContaining({ ref: REF_A })] })
  })

  it('drops a hit from a base the request did not scope', async () => {
    await grantBoth()
    source.hits = [passage(A), passage('00000000-0000-0000-0000-000000000000')]
    const result = await gateway.search({
      orgId: ORG, principalId: ALICE, scope: selected(REF_A), query: '年假',
    })
    expect(result.passages.map(hit => hit.ref)).toEqual([REF_A])
  })

  it('raises the source’s own reason when it fails after authorization', async () => {
    await grantBoth()
    source.hits = new KnowledgeError('upstream-unavailable')
    await expect(gateway.search({
      orgId: ORG, principalId: ALICE, scope: selected(REF_A), query: '年假',
    })).rejects.toMatchObject({ reason: 'upstream-unavailable' })
  })
})

describe('what a search records', () => {
  it('records identity, the governed resource, and a bounded count', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'lingang')
    await access.grantResource(role.id, await resourceOf(REF_A), 'knowledge.search')
    source.hits = [passage(A)]
    await gateway.search({
      orgId: ORG, principalId: ALICE, deviceId: 'device-1', correlationId: 'c-9f2a',
      scope: selected(REF_A), query: '年假怎么算',
    })
    const [row] = await audit.query({ orgId: ORG, action: 'knowledge.search' })
    expect(row).toMatchObject({
      outcome: 'allowed',
      principalId: ALICE,
      resourceId: REF_A,
      deviceId: 'device-1',
      correlationId: 'c-9f2a',
      metadata: { itemCount: 1 },
    })
    // The question and the passage it returned are nowhere in the row.
    expect(rendered(row)).not.toMatch(/年假|一级故障/u)
  })

  it('records a refusal with a closed reason and no result count', async () => {
    await syncBoth()
    await roleFor(ALICE, 'none')
    await gateway.search({
      orgId: ORG, principalId: ALICE, scope: selected(REF_A), query: '年假',
    }).catch(() => undefined)
    const [row] = await audit.query({ orgId: ORG, action: 'knowledge.search' })
    expect(row).toMatchObject({ outcome: 'denied', reason: 'no-grant', resourceId: REF_A })
    expect(row?.metadata).toEqual({})
  })

  it('labels an upstream failure without carrying the upstream’s words', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'lingang')
    await access.grantResource(role.id, await resourceOf(REF_A), 'knowledge.search')
    source.hits = new KnowledgeError('upstream-invalid', 'connect ECONNREFUSED 10.0.0.4:8500')
    await gateway.search({
      orgId: ORG, principalId: ALICE, scope: selected(REF_A), query: '年假',
    }).catch(() => undefined)
    const [row] = await audit.query({ orgId: ORG, action: 'knowledge.search' })
    expect(row).toMatchObject({ outcome: 'error', metadata: { knowledgeFailure: 'upstream-invalid' } })
    expect(rendered(row)).not.toMatch(/ECONNREFUSED|10\.0\.0\.4/u)
  })

  it('records one row per knowledge base a search covered', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-knowledge')
    await access.grantType(role.id, KNOWLEDGE_RESOURCE_TYPE, 'knowledge.search')
    source.hits = [passage(A), passage(B)]
    await gateway.search({ orgId: ORG, principalId: ALICE, scope: { mode: 'all' }, query: '年假' })
    const rows = await audit.query({ orgId: ORG, action: 'knowledge.search' })
    expect(rows.map(row => row.resourceId).sort()).toEqual([REF_A, REF_B].sort())
  })
})

describe('when the two stores disagree', () => {
  it('hides a catalog row whose managed resource is gone, until the next sync repairs it', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-knowledge')
    await access.grantType(role.id, KNOWLEDGE_RESOURCE_TYPE, 'knowledge.search')
    // An interrupted registration looks like this: the catalog row is written
    // and the governed resource is not.
    await access.deleteResource(await resourceOf(REF_A))
    expect((await gateway.catalogView(ORG)).entries.map(entry => entry.ref)).toEqual([REF_B])
    expect((await gateway.directory({ orgId: ORG, principalId: ALICE })).map(entry => entry.ref)).toEqual([REF_B])
    await syncBoth()
    expect((await gateway.catalogView(ORG)).entries).toHaveLength(2)
  })

  it('switching an entry whose resource is gone changes the catalog and waits for the sync', async () => {
    await syncBoth()
    await access.deleteResource(await resourceOf(REF_A))
    await gateway.setEnabled(ORG, REF_A, false)
    await syncBoth()
    expect((await gateway.catalogView(ORG)).entries.find(entry => entry.ref === REF_A))
      .toMatchObject({ adminEnabled: false, effectiveEnabled: false })
  })

  it('re-enables an entry an administrator had switched off', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-knowledge')
    await access.grantType(role.id, KNOWLEDGE_RESOURCE_TYPE, 'knowledge.search')
    await gateway.setEnabled(ORG, REF_A, false)
    await gateway.setEnabled(ORG, REF_A, true)
    expect((await gateway.directory({ orgId: ORG, principalId: ALICE })).map(entry => entry.ref).sort())
      .toEqual([REF_A, REF_B].sort())
  })

  it('leaves an entry unusable when it is switched on while the source no longer lists it', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-knowledge')
    await access.grantType(role.id, KNOWLEDGE_RESOURCE_TYPE, 'knowledge.search')
    source.listing = [upstream(B)]
    await gateway.sync(ORG)
    await gateway.setEnabled(ORG, REF_A, true)
    expect((await gateway.directory({ orgId: ORG, principalId: ALICE })).map(entry => entry.ref)).toEqual([REF_B])
  })

  it('rolls the whole listing back when one entry cannot be given a reference', async () => {
    await syncBoth()
    // An upstream id too long to fit the audit token bound: minting its
    // reference throws partway through the listing, and a half-written catalog
    // would leave knowledge bases governed under one listing and not the next.
    source.listing = [upstream(A, { name: 'renamed' }), upstream('u'.repeat(60))]
    await expect(gateway.sync(ORG)).rejects.toThrow(/knowledge reference/u)
    const view = await gateway.catalogView(ORG)
    expect(view.entries.map(entry => entry.displayName)).not.toContain('renamed')
    expect(view.entries).toHaveLength(2)
  })

  it('folds two listing entries claiming the same upstream base into one row', async () => {
    source.listing = [upstream(A), upstream(A, { name: 'second claim' })]
    await gateway.sync(ORG)
    const view = await gateway.catalogView(ORG)
    // One upstream base is one governed identity with one set of grants, so the
    // second claim updates the row rather than creating a rival for it.
    expect(view.entries).toHaveLength(1)
    expect(view.entries[0]).toMatchObject({ ref: REF_A, displayName: 'second claim' })
  })

  it('labels a listing failure that is not a knowledge failure at all', async () => {
    source.listing = new Error('the disk is on fire')
    const view = await gateway.sync(ORG)
    expect(view.source).toMatchObject({ health: 'failing', lastFailure: 'upstream-invalid' })
  })

  it('refuses a database a newer build wrote', async () => {
    const newer = join(home, 'newer.sqlite')
    const db = new DatabaseSync(newer)
    db.exec(`PRAGMA application_id = ${KNOWLEDGE_GATEWAY_SQLITE_APPLICATION_ID}`)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    db.close()
    const other = await dependencies(home)
    await expect(other.plugin(SqliteKnowledgeGateway, { path: newer }).await())
      .rejects.toThrow(/is newer than this build/u)
  })

  it('refuses a database another application wrote', async () => {
    const foreign = join(home, 'foreign.sqlite')
    const db = new DatabaseSync(foreign)
    db.exec('PRAGMA application_id = 12345')
    db.close()
    const other = await dependencies(home)
    await expect(other.plugin(SqliteKnowledgeGateway, { path: foreign }).await())
      .rejects.toThrow(/belongs to another application/u)
  })
})

describe('cancelling and unexpected failures', () => {
  it('forwards the caller’s signal to the source', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'lingang')
    await access.grantResource(role.id, await resourceOf(REF_A), 'knowledge.search')
    source.hits = [passage(A)]
    const controller = new AbortController()
    await gateway.search({
      orgId: ORG, principalId: ALICE, scope: selected(REF_A), query: '年假', signal: controller.signal,
    })
    expect(source.searched[0]?.signal).toBe(controller.signal)
  })

  it('records a cancellation without a failure label', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'lingang')
    await access.grantResource(role.id, await resourceOf(REF_A), 'knowledge.search')
    source.hits = new KnowledgeError('cancelled')
    await gateway.search({
      orgId: ORG, principalId: ALICE, scope: selected(REF_A), query: '年假',
    }).catch(() => undefined)
    const [row] = await audit.query({ orgId: ORG, action: 'knowledge.search' })
    // A cancellation is the caller's, not the source's; no upstream class applies.
    expect(row).toMatchObject({ outcome: 'error' })
    expect(row?.metadata).toEqual({})
  })

  it('records a search failure that is not a knowledge failure at all', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'lingang')
    await access.grantResource(role.id, await resourceOf(REF_A), 'knowledge.search')
    source.hits = new Error('the disk is on fire')
    await gateway.search({
      orgId: ORG, principalId: ALICE, scope: selected(REF_A), query: '年假',
    }).catch(() => undefined)
    const [row] = await audit.query({ orgId: ORG, action: 'knowledge.search' })
    expect(row).toMatchObject({ outcome: 'error', metadata: { knowledgeFailure: 'upstream-invalid' } })
  })
})

describe('the catalog outlives the process', () => {
  it('reads back what an earlier gateway wrote', async () => {
    await syncBoth()
    await gateway.setEnabled(ORG, REF_B, false)
    const reopened = await assemble(home)
    const view = await (reopened.get('knowledgeGateway') as KnowledgeGateway).catalogView(ORG)
    expect(view.entries.map(entry => ({ ref: entry.ref, adminEnabled: entry.adminEnabled })).sort(byRef))
      .toEqual([{ ref: REF_A, adminEnabled: true }, { ref: REF_B, adminEnabled: false }].sort(byRef))
  })
})

/** Render a stored audit row as text; its seq and revision are BigInts. */
function rendered(row: unknown): string {
  return JSON.stringify(row, (_key, value: unknown) => typeof value === 'bigint' ? String(value) : value)
}

/** Order two projected entries by reference, for a stable comparison. */
function byRef(left: { ref: string }, right: { ref: string }): number {
  return left.ref.localeCompare(right.ref)
}
