/**
 * The Runner-facing endpoints over a real HTTP server, a real device
 * credential, and the real governed gateway — because what these routes are
 * for is refusing things, and a refusal is only worth testing against the
 * machinery that would otherwise have allowed it.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SqliteAccessControl from '@deepseek-ai/dsh-access-control-sqlite'
import type { AccessControl } from '@deepseek-ai/dsh-access-control'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import SqliteAudit from '@deepseek-ai/dsh-audit-sqlite'
import SqliteDeviceAuthorization from '@deepseek-ai/dsh-device-authorization-sqlite'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { KnowledgeError } from '@deepseek-ai/dsh-knowledge'
import { KNOWLEDGE_RESOURCE_TYPE, type KnowledgeGateway } from '@deepseek-ai/dsh-knowledge-gateway'
import SqliteKnowledgeGateway from '@deepseek-ai/dsh-knowledge-gateway-sqlite'
import {
  KnowledgeSource,
  type UpstreamDocument,
  type UpstreamDocumentContent,
  type UpstreamDocumentPage,
  type UpstreamDocumentPlacement,
  type UpstreamDocumentRequest,
  type UpstreamDocumentsRequest,
  type UpstreamKnowledgeBase,
  type UpstreamPassage,
  type UpstreamSearchRequest,
} from '@deepseek-ai/dsh-knowledge-source'
import * as knowledgeHttp from '@deepseek-ai/dsh-knowledge-gateway-http'
import {
  KNOWLEDGE_CATALOG_PATH,
  KNOWLEDGE_DOCUMENTS_PATH,
  KNOWLEDGE_DOCUMENT_PATH,
  KNOWLEDGE_PROTOCOL_VERSION,
  KNOWLEDGE_SEARCH_PATH,
} from '@deepseek-ai/dsh-knowledge-gateway-http'

const A = '690c0727-1af5-4b7a-8465-ebd2845f2266'
const REF_A = `stub:prod:${A}`
const REF_B = 'stub:prod:08f25606-8876-49cc-b509-70e84828db08'

/** A knowledge source a test scripts. */
/** One document as a source describes it, for a placement answer. */
function documentOf(upstreamDocId: string): UpstreamDocument {
  return {
    upstreamDocId,
    title: '运维手册',
    description: '',
    fileName: '运维手册.pdf',
    fileType: 'pdf',
    byteSize: 20480,
    state: 'ready',
    updatedAt: undefined,
  }
}

class ScriptedSource extends KnowledgeSource {
  override readonly providerKind = 'stub'
  override readonly sourceCode = 'prod'
  listing: readonly UpstreamKnowledgeBase[] = []
  readonly searched: UpstreamSearchRequest[] = []
  hits: readonly UpstreamPassage[] | Error = []
  /** The listings `listDocuments` was called with, so a test can assert what left. */
  readonly listed: UpstreamDocumentsRequest[] = []
  /** What the next document listing returns. */
  documents: readonly UpstreamDocument[] = []

  list(): Promise<readonly UpstreamKnowledgeBase[]> {
    return Promise.resolve(this.listing)
  }

  /** Every document `describeDocument` was asked about, in order. */
  readonly described: string[] = []
  /** The knowledge base the source says holds any document, or the failure it raises. */
  placement: string | Error = ''
  /** Every content request `fetchDocument` received, in order. */
  readonly fetched: UpstreamDocumentRequest[] = []
  /** What the next content read answers, or the failure it raises. */
  content: UpstreamDocumentContent | Error =
    { kind: 'text', fileName: '运维手册.pdf', text: '一级故障 30 分钟内响应。', truncated: false }

  listDocuments(request: UpstreamDocumentsRequest): Promise<UpstreamDocumentPage> {
    this.listed.push(request)
    return Promise.resolve({ documents: this.documents, pageSize: request.pageSize, total: this.documents.length })
  }

  describeDocument(upstreamDocId: string): Promise<UpstreamDocumentPlacement> {
    this.described.push(upstreamDocId)
    if (this.placement instanceof Error) return Promise.reject(this.placement)
    return Promise.resolve({ upstreamId: this.placement, document: documentOf(upstreamDocId) })
  }

  fetchDocument(request: UpstreamDocumentRequest): Promise<UpstreamDocumentContent> {
    this.fetched.push(request)
    return this.content instanceof Error ? Promise.reject(this.content) : Promise.resolve(this.content)
  }

  search(request: UpstreamSearchRequest): Promise<readonly UpstreamPassage[]> {
    this.searched.push(request)
    return this.hits instanceof Error ? Promise.reject(this.hits) : Promise.resolve(this.hits)
  }
}

let home: string
let cp: Context
let origin: string
let access: AccessControl
let source: ScriptedSource
let orgId: OrgId
let alice: UserId
let accessToken: string

/** Bind a device the way the handoff does, and take its access token. */
async function mintAccessToken(): Promise<string> {
  const { generateKeyPairSync, sign } = await import('node:crypto')
  const auth = cp.get('deviceAuthorization') as import('@deepseek-ai/dsh-device-authorization').DeviceAuthorization
  const { newSecret, pkceChallenge, redeemSigningInput } = await import('@deepseek-ai/dsh-device-authorization')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  const verifier = newSecret()
  const started = await auth.start({
    publicKey: spki, platform: 'darwin', runnerVersion: '2.4.1',
    pkceChallenge: pkceChallenge(verifier),
    callbackUri: 'http://127.0.0.1:3090/team/callback', protocolVersion: 1,
  })
  const issued = await auth.confirm(started.transactionId, {
    orgId, userId: alice, authenticationId: 'session:browser-session',
  })
  const credential = await auth.redeem({
    transactionId: started.transactionId,
    code: issued.code,
    pkceVerifier: verifier,
    deviceSignature: sign(null, Buffer.from(redeemSigningInput(started.transactionId, issued.code)), privateKey)
      .toString('base64url'),
    callbackUri: 'http://127.0.0.1:3090/team/callback',
    protocolVersion: 1,
  })
  return credential.accessToken
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'dsh-knowledge-http-'))
  cp = new Context()
  await cp.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await cp.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await cp.plugin(SqliteAccessControl, { path: ':memory:' }).await()
  await cp.plugin(SqliteAudit, { path: join(home, 'audit.sqlite'), maxQueryRows: 500 }).await()
  await cp.plugin(SqliteDeviceAuthorization, {
    path: ':memory:', transactionTtlMs: 300_000, codeTtlMs: 60_000,
    accessTokenTtlMs: 900_000, refreshTokenTtlMs: 2_592_000_000,
  }).await()
  await cp.plugin(ScriptedSource).await()
  await cp.plugin(SqliteKnowledgeGateway, { path: join(home, 'knowledge.sqlite') }).await()
  await cp.plugin(knowledgeHttp, knowledgeHttp.Config({})).await()
  origin = `http://127.0.0.1:${String(cp.webServer.port)}`

  const store = cp.get('accountStore') as AccountStore
  access = cp.get('accessControl') as AccessControl
  source = cp.get('knowledgeSource') as ScriptedSource
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id

  source.listing = [{
    upstreamId: A, name: '临港知识库', description: '', kind: 'document',
    documentCount: 1, processingCount: 0,
    embeddingModelId: 'emb-shared', updatedAt: undefined,
    createdAt: undefined,
  }]
  await (cp.get('knowledgeGateway') as KnowledgeGateway).sync(orgId)
  accessToken = await mintAccessToken()
})

afterEach(async () => {
  await cp.fiber.dispose()
  rmSync(home, { recursive: true, force: true })
})

/** Let Alice search every knowledge base. */
async function grantAll(): Promise<void> {
  const role = await access.createRole({ orgId, name: 'engineering' })
  await access.bindUserRole(alice, role.id)
  await access.grantType(role.id, KNOWLEDGE_RESOURCE_TYPE, 'knowledge.search')
}

/**
 * POST one body to a knowledge route.
 *
 * The token is a separate argument rather than a defaulted one, because
 * passing `undefined` to a defaulted parameter reads as "use the default" and
 * would silently send a token to a test about sending none.
 */
async function post(path: string, body: unknown, token: string | null = null): Promise<Response> {
  const bearerToken = token ?? accessToken
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === NO_TOKEN ? {} : { authorization: `Bearer ${bearerToken}` }),
    },
    body: JSON.stringify(body),
  })
}

/** Send no `authorization` header at all. */
const NO_TOKEN = 'none'

/** A well-formed search body. */
function searchBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { protocolVersion: KNOWLEDGE_PROTOCOL_VERSION, query: '年假', scope: { mode: 'all' }, ...patch }
}

describe('the version is decided before anything else', () => {
  it.each([
    ['an older version', 0],
    ['a newer version', KNOWLEDGE_PROTOCOL_VERSION + 1],
    ['a version that is not a number', 'one'],
    ['no version at all', undefined],
  ])('refuses %s with the supported range', async (_label, protocolVersion) => {
    const body: Record<string, unknown> = { query: '年假', scope: { mode: 'all' } }
    if (protocolVersion !== undefined) body['protocolVersion'] = protocolVersion
    const response = await post(KNOWLEDGE_SEARCH_PATH, body)
    expect(response.status).toBe(426)
    expect(await response.json()).toEqual({
      error: 'knowledge',
      reason: 'update-required',
      minimum: 1,
      current: KNOWLEDGE_PROTOCOL_VERSION,
    })
  })

  it('decides the version before the token, so an unsupported Runner is told to update', async () => {
    // An old Runner whose token also expired must hear "update", not "sign in
    // again": signing in again through a protocol this build refuses cannot
    // help, and would send a member around a loop.
    const response = await post(KNOWLEDGE_SEARCH_PATH, { protocolVersion: 99, query: 'x', scope: { mode: 'all' } }, 'not-a-token')
    expect(response.status).toBe(426)
  })

  it('decides the version before the operation fields, so a malformed old request still says update', async () => {
    const response = await post(KNOWLEDGE_SEARCH_PATH, { protocolVersion: 99 })
    expect(response.status).toBe(426)
    expect(source.searched).toHaveLength(0)
  })
})

describe('identity comes from the token, never the body', () => {
  it('refuses a request with no token', async () => {
    const response = await post(KNOWLEDGE_CATALOG_PATH, { protocolVersion: KNOWLEDGE_PROTOCOL_VERSION }, NO_TOKEN)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'knowledge', reason: 'unauthenticated' })
  })

  it('refuses a token this Control Plane did not issue', async () => {
    const response = await post(KNOWLEDGE_CATALOG_PATH, { protocolVersion: KNOWLEDGE_PROTOCOL_VERSION }, 'forged')
    expect(response.status).toBe(401)
  })

  it('refuses after the device is revoked, on the next call', async () => {
    await grantAll()
    expect((await post(KNOWLEDGE_CATALOG_PATH, { protocolVersion: KNOWLEDGE_PROTOCOL_VERSION })).status).toBe(200)
    const auth = cp.get('deviceAuthorization') as import('@deepseek-ai/dsh-device-authorization').DeviceAuthorization
    const devices = await auth.listDevices(orgId)
    for (const device of devices) await auth.revokeDevice(device.id)
    expect((await post(KNOWLEDGE_CATALOG_PATH, { protocolVersion: KNOWLEDGE_PROTOCOL_VERSION })).status).toBe(401)
  })

  it('ignores an organization or principal a body tries to name', async () => {
    await grantAll()
    const other = await (cp.get('accountStore') as AccountStore).createOrganization('Rival')
    const response = await post(KNOWLEDGE_SEARCH_PATH, searchBody({
      orgId: other.id, principalId: 'user-somebody-else', deviceId: 'device-elsewhere',
    }))
    // The extra fields changed nothing: the answer is Alice's own directory.
    expect(response.status).toBe(200)
    expect(source.searched[0]?.upstreamIds).toEqual([A])
  })
})

describe('the authorized directory', () => {
  it('answers a principal holding nothing an empty directory', async () => {
    const response = await post(KNOWLEDGE_CATALOG_PATH, { protocolVersion: KNOWLEDGE_PROTOCOL_VERSION })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ entries: [] })
  })

  it('names each authorized base without exposing an upstream id', async () => {
    await grantAll()
    const response = await post(KNOWLEDGE_CATALOG_PATH, { protocolVersion: KNOWLEDGE_PROTOCOL_VERSION })
    const entries = (await response.json() as { entries: Record<string, unknown>[] }).entries
    expect(entries).toEqual([{
      ref: REF_A, displayName: '临港知识库', description: '', kind: 'document', documentCount: 1,
    }])
    // The reference embeds the upstream id by construction; what must not
    // appear is a field a Runner could read one out of and address directly.
    expect(Object.keys(entries[0] ?? {}).sort())
      .toEqual(['description', 'displayName', 'documentCount', 'kind', 'ref'])
  })

  it('refuses a method that is not POST', async () => {
    const response = await fetch(`${origin}${KNOWLEDGE_CATALOG_PATH}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(response.status).toBe(405)
  })
})

describe('searching', () => {
  it('returns passages naming the DSH reference that produced them', async () => {
    await grantAll()
    source.hits = [{ upstreamId: A, title: '运维手册', text: '一级故障 30 分钟内响应。', truncated: false, score: 0.3 }]
    const response = await post(KNOWLEDGE_SEARCH_PATH, searchBody())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      query: '年假',
      passages: [{ ref: REF_A, title: '运维手册', truncated: false }],
      searched: [{ ref: REF_A, displayName: '临港知识库' }],
    })
  })

  it('passes a selected scope through and refuses one that is not authorized', async () => {
    await grantAll()
    source.hits = []
    expect((await post(KNOWLEDGE_SEARCH_PATH, searchBody({
      scope: { mode: 'selected', refs: [REF_A] },
    }))).status).toBe(200)
    const refused = await post(KNOWLEDGE_SEARCH_PATH, searchBody({
      scope: { mode: 'selected', refs: ['stub:prod:00000000-0000-0000-0000-000000000000'] },
    }))
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'knowledge', reason: 'not-allowed' })
  })

  it.each([
    ['no query', { query: undefined }],
    ['an empty query', { query: '' }],
    ['a query that is not a string', { query: 7 }],
    ['no scope', { scope: undefined }],
    ['a scope that is not one', { scope: 'everything' }],
    ['an unknown scope mode', { scope: { mode: 'some' } }],
    ['a selected scope with no references', { scope: { mode: 'selected', refs: [] } }],
    ['a malformed reference', { scope: { mode: 'selected', refs: ['not-a-ref'] } }],
    ['a reference that is not a string', { scope: { mode: 'selected', refs: [7] } }],
    ['a fractional result bound', { maxResults: 1.5 }],
    ['a zero result bound', { maxResults: 0 }],
    ['a result bound that is not a number', { maxResults: 'ten' }],
    ['a fractional document count', { maxDocuments: 2.5 }],
    ['a zero document count', { maxDocuments: 0 }],
  ])('refuses %s as malformed', async (_label, patch) => {
    await grantAll()
    // Object.entries drops nothing, so an `undefined` in the patch means
    // "omit this field" and is filtered out rather than assigned.
    const body = Object.fromEntries(
      Object.entries({ ...searchBody(), ...patch }).filter(([, value]) => value !== undefined),
    )
    const response = await post(KNOWLEDGE_SEARCH_PATH, body)
    expect(response.status).toBe(400)
    expect(source.searched).toHaveLength(0)
  })

  it('refuses a body that is not JSON, and one that is too large', async () => {
    const bad = await fetch(`${origin}${KNOWLEDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(bad.status).toBe(400)
    const huge = await post(KNOWLEDGE_SEARCH_PATH, searchBody({ query: 'x'.repeat(100_000) }))
    expect(huge.status).toBe(400)
  })

  it('refuses a JSON array, which is not a request object', async () => {
    const response = await fetch(`${origin}${KNOWLEDGE_SEARCH_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: '[]',
    })
    expect(response.status).toBe(400)
  })

  it('honours a caller’s result bound', async () => {
    await grantAll()
    source.hits = []
    await post(KNOWLEDGE_SEARCH_PATH, searchBody({ maxResults: 3 }))
    expect(source.searched[0]?.maxResults).toBe(3)
    expect(source.searched[0]).not.toHaveProperty('maxDocuments')
  })

  it('carries a document ranking to the source', async () => {
    await grantAll()
    source.hits = []
    await post(KNOWLEDGE_SEARCH_PATH, searchBody({ maxDocuments: 10 }))
    expect(source.searched[0]?.maxDocuments).toBe(10)
  })
})

describe('failures map onto closed reasons', () => {
  it.each([
    ['upstream-unavailable', 502],
    ['upstream-invalid', 502],
  ] as const)('answers %s with HTTP %i and no upstream words', async (reason, status) => {
    await grantAll()
    source.hits = new KnowledgeError(reason, 'connect ECONNREFUSED 10.0.0.4:8500')
    const response = await post(KNOWLEDGE_SEARCH_PATH, searchBody())
    expect(response.status).toBe(status)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({ error: 'knowledge', reason })
    expect(body).not.toMatch(/ECONNREFUSED|10\.0\.0\.4/u)
  })

  it('answers a defect of this deployment as internal, with no reason to act on', async () => {
    await grantAll()
    source.hits = new Error('the disk is on fire')
    const response = await post(KNOWLEDGE_SEARCH_PATH, searchBody())
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({ error: 'internal' })
    expect(body).not.toMatch(/disk/u)
  })

  it('answers an incompatible scope with a reason a member can act on', async () => {
    await grantAll()
    source.listing = [
      { upstreamId: A, name: 'A', description: '', kind: 'document', documentCount: 0, processingCount: 0, embeddingModelId: 'one', updatedAt: undefined, createdAt: undefined },
      { upstreamId: '08f25606-8876-49cc-b509-70e84828db08', name: 'B', description: '', kind: 'document', documentCount: 0, processingCount: 0, embeddingModelId: 'two', updatedAt: undefined, createdAt: undefined },
    ]
    await (cp.get('knowledgeGateway') as KnowledgeGateway).sync(orgId)
    const response = await post(KNOWLEDGE_SEARCH_PATH, searchBody())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'knowledge', reason: 'scope-incompatible' })
  })

  it('answers a directory failure with the gateway’s own reason', async () => {
    // No grant at all is an empty directory rather than a refusal, so the
    // failure path is reached through a gateway that raises instead.
    const failing = { directory: () => Promise.reject(new KnowledgeError('control-plane-unreachable')) }
    const isolated = new Context()
    await isolated.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    isolated.provide('knowledgeGateway', failing)
    isolated.provide('deviceAuthorization', {
      verifyAccessToken: () => Promise.resolve({ orgId, principalId: alice, deviceId: 'device-1' }),
    })
    await isolated.plugin(knowledgeHttp, knowledgeHttp.Config({})).await()
    const response = await fetch(`http://127.0.0.1:${String(isolated.webServer.port)}${KNOWLEDGE_CATALOG_PATH}`, {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: KNOWLEDGE_PROTOCOL_VERSION }),
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'knowledge', reason: 'control-plane-unreachable' })
    await isolated.fiber.dispose()
  })
})

describe('one knowledge base’s documents', () => {
  it('lists an authorized knowledge base, naming documents by governed reference', async () => {
    await grantAll()
    source.documents = [{
      upstreamDocId: 'doc-1',
      title: '运维手册',
      description: '',
      fileName: '运维手册.pdf',
      fileType: 'pdf',
      byteSize: 20480,
      state: 'ready',
      updatedAt: undefined,
    }]
    const response = await post(KNOWLEDGE_DOCUMENTS_PATH, {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION, ref: REF_A, page: 1, pageSize: 5,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ref: REF_A,
      documents: [{ docRef: `${REF_A}/doc-1`, ref: REF_A, fileName: '运维手册.pdf', state: 'ready' }],
      page: 1,
      pageSize: 5,
    })
    expect(source.listed).toEqual([{ upstreamId: A, page: 1, pageSize: 5 }])
  })

  it('refuses a knowledge base this principal holds nothing on, and asks the source nothing', async () => {
    const response = await post(KNOWLEDGE_DOCUMENTS_PATH, {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION, ref: REF_A,
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'knowledge', reason: 'not-allowed' })
    expect(source.listed).toEqual([])
  })

  it.each([
    ['no reference', {}],
    ['a reference that is not one', { ref: 'not-a-reference' }],
    ['a page that is not a whole number', { ref: REF_A, page: 1.5 }],
    ['a page below one', { ref: REF_A, page: 0 }],
    ['a page size that is not a number', { ref: REF_A, pageSize: 'ten' }],
  ])('refuses %s as malformed', async (_label, patch) => {
    await grantAll()
    const response = await post(KNOWLEDGE_DOCUMENTS_PATH, {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION, ...patch,
    })
    expect(response.status).toBe(400)
    expect(source.listed).toEqual([])
  })

  it('refuses a method that is not POST', async () => {
    const response = await fetch(`${origin}${KNOWLEDGE_DOCUMENTS_PATH}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(response.status).toBe(405)
  })
})

describe('one document’s content', () => {
  it('carries the original file as base64, with the type it is served as', async () => {
    await grantAll()
    source.placement = A
    source.content = {
      kind: 'bytes', fileName: '运维手册.pdf', contentType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]),
    }
    const response = await post(KNOWLEDGE_DOCUMENT_PATH, {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION, docRef: `${REF_A}/doc-1`, maxBytes: 4096,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      kind: 'bytes',
      docRef: `${REF_A}/doc-1`,
      fileName: '运维手册.pdf',
      contentType: 'application/pdf',
      base64: 'AQID',
    })
  })

  it('carries parsed text as itself', async () => {
    await grantAll()
    source.placement = A
    source.content = { kind: 'text', fileName: '运维手册.pdf', text: '一级故障 30 分钟内响应。', truncated: true }
    const response = await post(KNOWLEDGE_DOCUMENT_PATH, {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION, docRef: `${REF_A}/doc-1`,
    })
    expect(await response.json()).toMatchObject({ kind: 'text', truncated: true })
  })

  it('answers a document the source will serve nothing from with its own reason', async () => {
    await grantAll()
    source.placement = A
    source.content = new KnowledgeError('document-unavailable', 'nothing to serve')
    const response = await post(KNOWLEDGE_DOCUMENT_PATH, {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION, docRef: `${REF_A}/doc-1`,
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'knowledge', reason: 'document-unavailable' })
  })

  it.each([
    ['no reference', {}],
    ['a knowledge reference where a document belongs', { docRef: REF_A }],
    ['a byte bound that is not a whole number', { docRef: `${REF_A}/doc-1`, maxBytes: 0.5 }],
  ])('refuses %s as malformed', async (_label, patch) => {
    await grantAll()
    const response = await post(KNOWLEDGE_DOCUMENT_PATH, {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION, ...patch,
    })
    expect(response.status).toBe(400)
    expect(source.described).toEqual([])
  })

  it('reads nothing for a request that never opened', async () => {
    await grantAll()
    const unauthenticated = await post(KNOWLEDGE_DOCUMENT_PATH, {
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION, docRef: `${REF_A}/doc-1`,
    }, NO_TOKEN)
    expect(unauthenticated.status).toBe(401)
    const wrongMethod = await fetch(`${origin}${KNOWLEDGE_DOCUMENT_PATH}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(wrongMethod.status).toBe(405)
    expect(source.described).toEqual([])
  })
})

describe('a search narrowed to documents', () => {
  it('carries the knowledge base and the documents inside it', async () => {
    await grantAll()
    source.hits = []
    const response = await post(KNOWLEDGE_SEARCH_PATH, searchBody({
      scope: { mode: 'documents', ref: REF_A, docRefs: [`${REF_A}/doc-1`, `${REF_A}/doc-2`] },
    }))
    expect(response.status).toBe(200)
    expect(source.searched[0]).toMatchObject({ upstreamIds: [A], upstreamDocIds: ['doc-1', 'doc-2'] })
  })

  it.each([
    ['a document from another knowledge base', { mode: 'documents', ref: REF_A, docRefs: [`${REF_B}/doc-1`] }],
    ['no documents', { mode: 'documents', ref: REF_A, docRefs: [] }],
    ['no knowledge base', { mode: 'documents', docRefs: [`${REF_A}/doc-1`] }],
    ['a knowledge base that is not one', { mode: 'documents', ref: 'nope', docRefs: [`${REF_A}/doc-1`] }],
    ['a document reference that is not one', { mode: 'documents', ref: REF_A, docRefs: ['nope'] }],
    ['documents that are not a list', { mode: 'documents', ref: REF_A, docRefs: 'doc-1' }],
  ])('refuses %s as malformed', async (_label, scope) => {
    await grantAll()
    const response = await post(KNOWLEDGE_SEARCH_PATH, searchBody({ scope }))
    expect(response.status).toBe(400)
    expect(source.searched).toEqual([])
  })
})
