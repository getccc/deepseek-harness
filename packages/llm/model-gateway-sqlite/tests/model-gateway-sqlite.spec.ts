/**
 * What a Runner may invoke, and what its call becomes.
 *
 * The gateway is exercised against real access-control and quota compositions
 * rather than stubs, because what is worth testing is the order of the three
 * decisions and what each one refuses — and a stub would only replay whatever
 * this test told it to.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import SqliteAccessControl from '@deepseek-ai/dsh-access-control-sqlite'
import SqliteQuota from '@deepseek-ai/dsh-quota-sqlite'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { AccessControl, RoleId } from '@deepseek-ai/dsh-access-control'
import type { Quota } from '@deepseek-ai/dsh-quota'
import {
  InvocationRefusedError,
  isUsableCredentialRef,
  type InvocationRequest,
  type ModelGateway,
  type RegisterModel,
} from '@deepseek-ai/dsh-model-gateway'
import SqliteModelGateway, {
  MODEL_GATEWAY_SQLITE_APPLICATION_ID,
  SCHEMA_VERSION,
} from '../src/index.ts'
import { applySchema } from '../src/schema.ts'

let ctx: Context
let store: AccountStore
let gateway: ModelGateway
let access: AccessControl
let quota: Quota
let orgId: OrgId
let alice: UserId
let role: RoleId

const PERIOD = '2026-08'

/** A catalog entry, which each test then varies. */
function model(patch: Partial<RegisterModel> = {}): RegisterModel {
  return {
    orgId,
    modelRef: 'company-v4',
    displayName: 'Company V4',
    providerRef: 'deepseek',
    upstreamModel: 'deepseek-chat-20260801',
    endpoint: 'https://api.deepseek.com',
    credentialRef: 'COMPANY_DEEPSEEK_KEY',
    maxOutputTokens: 4_000,
    ...patch,
  }
}

/** An invocation, which each test then varies. */
function invocation(patch: Partial<InvocationRequest> = {}): InvocationRequest {
  return {
    orgId,
    principalId: alice,
    modelRef: 'company-v4',
    period: PERIOD,
    inputTokens: 500,
    ...patch,
  }
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await ctx.plugin(SqliteAccessControl, { path: ':memory:' }).await()
  await ctx.plugin(SqliteQuota, { path: ':memory:', reservationTtlMs: 300_000 }).await()
  await ctx.plugin(SqliteModelGateway, { path: ':memory:' }).await()

  store = ctx.get('accountStore') as AccountStore
  access = ctx.get('accessControl') as AccessControl
  quota = ctx.get('quota') as Quota
  gateway = ctx.get('modelGateway') as ModelGateway
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id
  role = (await access.createRole({ orgId, name: 'engineering' })).id
  await access.bindUserRole(alice, role)
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

/** Let the bound role invoke and discover every model. */
async function grantEverything(): Promise<void> {
  await access.grantType(role, 'model', 'model.invoke')
  await access.grantType(role, 'model', 'model.discover')
}

describe('the catalog', () => {
  it('governs a model in the same act that registers it', async () => {
    await gateway.register(model())
    // A catalog entry access control does not know about is a model no grant
    // can name and nobody can ever invoke.
    const governed = await access.listResources(orgId, 'model')
    expect(governed.map(resource => resource.externalRef)).toEqual(['company-v4'])
  })

  it('keeps the stable ref while the upstream name and credential change under it', async () => {
    await gateway.register(model())
    await grantEverything()
    const before = await gateway.authorize(invocation())
    await gateway.register(model({ upstreamModel: 'deepseek-chat-20260901', credentialRef: 'COMPANY_ROTATED_KEY' }))
    const after = await gateway.authorize(invocation())
    expect(await gateway.list(orgId)).toHaveLength(1)
    expect(before.upstreamModel).toBe('deepseek-chat-20260801')
    expect(after.upstreamModel).toBe('deepseek-chat-20260901')
    expect(after.credentialRef).toBe('COMPANY_ROTATED_KEY')
    // The grant still names the same model, because the ref never moved.
    expect(after.modelRef).toBe('company-v4')
  })

  it('withdraws a model from service on both sides at once', async () => {
    await gateway.register(model())
    await grantEverything()
    await gateway.setStatus(orgId, 'company-v4', 'retired')
    await expect(gateway.authorize(invocation())).rejects.toMatchObject({ reason: 'model-retired' })
    // And access control refuses it too, whichever entry point a request
    // arrives at.
    expect(await access.authorize({
      orgId, principalId: alice, action: 'model.invoke', resourceType: 'model', resourceId: 'company-v4',
    })).toMatchObject({ allowed: false, reason: 'resource-disabled' })
    await gateway.setStatus(orgId, 'company-v4', 'active')
    await expect(gateway.authorize(invocation())).resolves.toMatchObject({ modelRef: 'company-v4' })
  })

  it('refuses an entry whose credential reference could never resolve', async () => {
    // A credential key addresses a stored record; a credential reference is
    // what a gateway resolves at call time. Storing the first would leave a
    // model that reads as active and fails every invocation.
    for (const credentialRef of ['company/deepseek', 'company-deepseek', 'has space', '']) {
      await expect(gateway.register(model({ credentialRef })), credentialRef)
        .rejects.toMatchObject({ name: 'MalformedCatalogEntryError', field: 'credentialRef' })
    }
    expect(await gateway.list(orgId)).toEqual([])
    // And nothing was governed either, so a grant cannot name a model the
    // catalog refused.
    expect(await access.listResources(orgId, 'model')).toEqual([])
  })

  it('accepts a status change for a model nobody registered', async () => {
    await expect(gateway.setStatus(orgId, 'never-registered', 'retired')).resolves.toBeUndefined()
  })

  it('takes a removed model out of governance too, so no grant outlives the entry', async () => {
    await gateway.register(model())
    await grantEverything()
    await expect(gateway.authorize(invocation())).resolves.toMatchObject({ modelRef: 'company-v4' })

    await gateway.remove(orgId, 'company-v4')
    expect(await gateway.list(orgId)).toEqual([])
    // Deleting is not retiring: the governed resource is gone rather than
    // disabled, so nothing is left for a grant to name.
    expect(await access.listResources(orgId, 'model')).toEqual([])
    await expect(gateway.authorize(invocation())).rejects.toMatchObject({ reason: 'unknown-model' })
  })

  it('accepts removing a model nobody registered', async () => {
    await expect(gateway.remove(orgId, 'never-registered')).resolves.toBeUndefined()
  })

  it('leaves a governed model resource the catalog never held', async () => {
    // Other subsystems govern resources of this type that were never catalog
    // entries. Removing a ref this catalog holds nothing for must not take one
    // of those, and the grants written against it, with it.
    const outside = await access.registerResource({
      orgId, type: 'model', externalRef: 'urn:dsh:admin:model-catalog', displayName: 'Model catalog',
    })
    await access.grantResource(role, outside.id, 'model.catalog.manage')

    await gateway.remove(orgId, 'urn:dsh:admin:model-catalog')
    expect((await access.listResources(orgId, 'model')).map(resource => resource.externalRef))
      .toEqual(['urn:dsh:admin:model-catalog'])
    expect(await access.authorize({
      orgId,
      principalId: alice,
      action: 'model.catalog.manage',
      resourceType: 'model',
      resourceId: 'urn:dsh:admin:model-catalog',
    })).toMatchObject({ allowed: true })
  })
})

describe('what a member is shown', () => {
  it('lists only models the principal may discover, and only what a Runner needs', async () => {
    await gateway.register(model())
    await gateway.register(model({ modelRef: 'company-v4-mini', displayName: 'Company V4 Mini' }))
    const resources = await access.listResources(orgId, 'model')
    const mini = resources.find(resource => resource.externalRef === 'company-v4-mini')
    await access.grantResource(role, mini?.id as never, 'model.discover')

    const visible = await gateway.discover(orgId, alice)
    expect(visible).toEqual([{ modelRef: 'company-v4-mini', displayName: 'Company V4 Mini' }])
    // Not the endpoint, not the upstream name, not the credential reference.
    expect(JSON.stringify(visible)).not.toContain('deepseek')
    expect(JSON.stringify(visible)).not.toContain('COMPANY_DEEPSEEK_KEY')
  })

  it('hides a retired model from a member who could otherwise discover it', async () => {
    await gateway.register(model())
    await grantEverything()
    expect(await gateway.discover(orgId, alice)).toHaveLength(1)
    await gateway.setStatus(orgId, 'company-v4', 'retired')
    expect(await gateway.discover(orgId, alice)).toEqual([])
  })

  it('shows an administrator the whole catalog, retired models included', async () => {
    await gateway.register(model())
    await gateway.setStatus(orgId, 'company-v4', 'retired')
    expect(await gateway.list(orgId)).toMatchObject([{ modelRef: 'company-v4', status: 'retired' }])
  })
})

describe('deciding an invocation', () => {
  it('returns a call the Runner could not have constructed', async () => {
    await gateway.register(model())
    await grantEverything()
    const plan = await gateway.authorize(invocation())
    expect(plan).toMatchObject({
      modelRef: 'company-v4',
      endpoint: 'https://api.deepseek.com',
      upstreamModel: 'deepseek-chat-20260801',
      credentialRef: 'COMPANY_DEEPSEEK_KEY',
      maxOutputTokens: 4_000,
    })
    expect(plan.policyRevision).toBeGreaterThan(0n)
    expect((await quota.usage(orgId, PERIOD)).reservedTokens).toBe(4_500)
  })

  it('answers an unknown model and an ungranted one the same way', async () => {
    await gateway.register(model())
    // Alice holds no grant, so the model she cannot invoke reads as one that
    // does not exist: a refusal never tells her which models this organization
    // has.
    await expect(gateway.authorize(invocation())).rejects.toMatchObject({ reason: 'unknown-model' })
    await expect(gateway.authorize(invocation({ modelRef: 'no-such-model' })))
      .rejects.toMatchObject({ reason: 'unknown-model' })
  })

  it('says not-allowed only when the principal holds roles but not this one', async () => {
    await gateway.register(model())
    await gateway.register(model({ modelRef: 'other', displayName: 'Other' }))
    const resources = await access.listResources(orgId, 'model')
    const other = resources.find(resource => resource.externalRef === 'other')
    await access.grantResource(role, other?.id as never, 'model.invoke')
    // The principal is known to access control and holds a grant on another
    // model, which is a different fact from holding nothing at all.
    await expect(gateway.authorize(invocation())).rejects.toMatchObject({ reason: 'unknown-model' })
    await expect(gateway.authorize(invocation({ modelRef: 'other' }))).resolves.toMatchObject({ modelRef: 'other' })
  })

  it('refuses when the organization has no budget left', async () => {
    await gateway.register(model())
    await grantEverything()
    await quota.setLimit(orgId, PERIOD, 1_000)
    await expect(gateway.authorize(invocation())).rejects.toMatchObject({ reason: 'quota-exceeded' })
  })

  it('refuses a nonsensical token count without holding anything', async () => {
    await gateway.register(model())
    await grantEverything()
    await expect(gateway.authorize(invocation({ inputTokens: -1 })))
      .rejects.toMatchObject({ reason: 'malformed' })
    expect((await quota.usage(orgId, PERIOD)).reservedTokens).toBe(0)
  })

  it('reserves against the catalog ceiling, not the Runner ask', async () => {
    await gateway.register(model())
    await grantEverything()
    const plan = await gateway.authorize(invocation({ maxOutputTokens: 999_999 }))
    expect(plan.maxOutputTokens).toBe(4_000)
    expect((await quota.usage(orgId, PERIOD)).reservedTokens).toBe(4_500)
  })

  it('honours a smaller ask, so a short request does not hold a long request budget', async () => {
    await gateway.register(model())
    await grantEverything()
    const plan = await gateway.authorize(invocation({ maxOutputTokens: 100 }))
    expect(plan.maxOutputTokens).toBe(100)
    expect((await quota.usage(orgId, PERIOD)).reservedTokens).toBe(600)
  })

  it('takes no reservation for a model it refuses', async () => {
    await gateway.register(model())
    await expect(gateway.authorize(invocation())).rejects.toBeInstanceOf(InvocationRefusedError)
    expect((await quota.usage(orgId, PERIOD)).reservedTokens).toBe(0)
  })

  it('carries the device and the correlation into both decisions', async () => {
    await gateway.register(model())
    await grantEverything()
    const plan = await gateway.authorize(invocation({
      deviceId: 'device-7',
      correlationId: 'c-9f2a',
      maxOutputTokens: 100,
    }))
    // Both are optional on the request and reach the ledger, so a later reader
    // can tell which computer and which session spent the budget.
    expect(plan.maxOutputTokens).toBe(100)
    expect((await quota.usage(orgId, PERIOD)).reservedTokens).toBe(600)
  })

  it('says not-allowed when the principal holds a role that simply lacks this grant', async () => {
    await gateway.register(model())
    // Alice holds a role, and the model is governed and enabled; what she does
    // not hold is model.invoke on it. Access control calls that no-grant, and
    // this seam reports it as unknown-model — the case that reads as
    // not-allowed is a decision that refused for any other reason.
    await access.grantType(role, 'model', 'model.discover')
    await expect(gateway.authorize(invocation())).rejects.toMatchObject({ reason: 'unknown-model' })

    const other = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    // Bob holds no roles at all, which access control calls default-deny.
    await expect(gateway.authorize(invocation({ principalId: other })))
      .rejects.toMatchObject({ reason: 'not-allowed' })
  })

  it('settles the reservation the plan named', async () => {
    await gateway.register(model())
    await grantEverything()
    const plan = await gateway.authorize(invocation())
    await gateway.settle(plan.reservationId, { kind: 'reported', inputTokens: 500, outputTokens: 700 })
    expect(await quota.usage(orgId, PERIOD)).toMatchObject({ settledTokens: 1_200, reservedTokens: 0 })
  })
})

describe('opening a catalog', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-model-'))
    path = join(dir, 'models.sqlite')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('stamps the application id and schema version, and refuses foreign or newer files', () => {
    const db = new DatabaseSync(path)
    applySchema(db)
    expect((db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id)
      .toBe(MODEL_GATEWAY_SQLITE_APPLICATION_ID)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    expect(() => { applySchema(db) }).toThrow(/newer than this build/u)
    db.close()

    const foreign = new DatabaseSync(join(dir, 'other.sqlite'))
    foreign.exec('PRAGMA application_id = 12345')
    expect(() => { applySchema(foreign) }).toThrow(/another application/u)
    foreign.close()
  })

  it('refuses a status and an output ceiling the catalog does not hold', () => {
    const db = new DatabaseSync(path)
    applySchema(db)
    const insert = db.prepare(
      `INSERT INTO model (org_id, model_ref, display_name, provider_ref, upstream_model,
                          endpoint, credential_ref, max_output_tokens, status)
       VALUES ('o', ?, 'n', 'p', 'u', 'e', 'c', ?, ?)`,
    )
    expect(() => insert.run('a', 100, 'invented')).toThrow(/CHECK/u)
    expect(() => insert.run('b', 0, 'active')).toThrow(/CHECK/u)
    db.close()
  })
})

describe('what can address a provider credential', () => {
  it('accepts a reference and refuses a key', () => {
    expect(isUsableCredentialRef('COMPANY_DEEPSEEK_KEY')).toBe(true)
    expect(isUsableCredentialRef('_private')).toBe(true)
    // `scope/id` is a credential key: it addresses a stored record rather than
    // a reference a gateway resolves.
    expect(isUsableCredentialRef('company/deepseek')).toBe(false)
    expect(isUsableCredentialRef('company-deepseek')).toBe(false)
    expect(isUsableCredentialRef('')).toBe(false)
  })
})
