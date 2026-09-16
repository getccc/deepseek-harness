import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  DEFAULT_KNOWLEDGE_SCOPE,
  InvalidKnowledgeRefError,
  KNOWLEDGE_DOC_ID_MAX_LENGTH,
  KNOWLEDGE_REF_MAX_LENGTH,
  KNOWLEDGE_SOURCE_CODE_MAX_LENGTH,
  Knowledge,
  KnowledgeDocRef,
  KnowledgeError,
  KnowledgeRef,
  foldKnowledgeScope,
  formatKnowledgeDocRef,
  formatKnowledgeRef,
  isKnowledgeDocRef,
  isKnowledgeRef,
  parseKnowledgeDocRef,
  parseKnowledgeRef,
  parseKnowledgeScope,
  selectionOf,
  type KnowledgeBaseEntry,
  type KnowledgeDocumentContent,
  type KnowledgeDocumentPage,
  type KnowledgeDocumentRequest,
  type KnowledgeDocumentsRequest,
  type KnowledgeScope,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'

const UUID = '690c0727-1af5-4b7a-8465-ebd2845f2266'

/** The reference a well-formed WeKnora entry mints. */
function ref(sourceCode = 'prod', upstreamId = UUID): string {
  return formatKnowledgeRef({ providerKind: 'weknora', sourceCode, upstreamId })
}

/** One committed scope event, as a Session log holds it. */
function scopeEvent(scope: KnowledgeScope, seq: number): SessionEvent {
  return { seq, type: 'knowledge/scope', data: scope } as SessionEvent
}

/** A committed event this capability ignores. */
function otherEvent(seq: number): SessionEvent {
  return { seq, type: 'turn/start', data: { turn: seq } } as SessionEvent
}

describe('knowledge references', () => {
  it('assembles and reads back the three segments', () => {
    const value = ref()
    expect(value).toBe(`weknora:prod:${UUID}`)
    expect(parseKnowledgeRef(value)).toEqual({
      providerKind: 'weknora',
      sourceCode: 'prod',
      upstreamId: UUID,
    })
    expect(isKnowledgeRef(value)).toBe(true)
  })

  it('brands without validating, so a parsed value is the one that proves the grammar', () => {
    expect(KnowledgeRef('anything at all')).toBe('anything at all')
    expect(isKnowledgeRef('anything at all')).toBe(false)
  })

  it.each([
    ['an empty provider kind', { providerKind: '', sourceCode: 'prod', upstreamId: UUID }],
    ['an empty source code', { providerKind: 'weknora', sourceCode: '', upstreamId: UUID }],
    ['an empty upstream id', { providerKind: 'weknora', sourceCode: 'prod', upstreamId: '' }],
    ['a space', { providerKind: 'weknora', sourceCode: 'a b', upstreamId: UUID }],
    ['a slash', { providerKind: 'weknora', sourceCode: 'a/b', upstreamId: UUID }],
    ['an embedded separator', { providerKind: 'weknora', sourceCode: 'a:b', upstreamId: UUID }],
  ])('refuses %s', (_label, parts) => {
    expect(() => formatKnowledgeRef(parts)).toThrow(InvalidKnowledgeRefError)
  })

  it('refuses a source code past the derived maximum', () => {
    const longest = 'a'.repeat(KNOWLEDGE_SOURCE_CODE_MAX_LENGTH)
    expect(ref(longest)).toContain(longest)
    expect(() => formatKnowledgeRef({
      providerKind: 'weknora',
      sourceCode: `${longest}a`,
      upstreamId: UUID,
    })).toThrow(/longer than 19 characters/u)
  })

  it('refuses a reference past the audit token maximum even when each segment is legal', () => {
    expect(() => formatKnowledgeRef({
      providerKind: 'weknora',
      sourceCode: 'prod',
      upstreamId: 'u'.repeat(KNOWLEDGE_REF_MAX_LENGTH),
    })).toThrow(/over the audit token maximum of 64/u)
  })

  it('keeps every minted reference inside the audit token rule', () => {
    const auditToken = /^[A-Za-z0-9._:@-]{1,64}$/u
    expect(auditToken.test(ref('a'.repeat(KNOWLEDGE_SOURCE_CODE_MAX_LENGTH)))).toBe(true)
  })

  it.each([
    ['too few segments', `weknora:${UUID}`],
    ['too many segments', `weknora:prod:${UUID}:extra`],
    ['no segments', ''],
    ['three segments with an empty one', `weknora::${UUID}`],
    ['three segments over the length maximum', `weknora:prod:${'u'.repeat(KNOWLEDGE_REF_MAX_LENGTH)}`],
  ])('reads %s back as undefined', (_label, value) => {
    expect(parseKnowledgeRef(value)).toBeUndefined()
    expect(isKnowledgeRef(value)).toBe(false)
  })
})

describe('document references', () => {
  it('carries its knowledge base and the upstream document id, and reads back into both', () => {
    const docRef = formatKnowledgeDocRef({ ref: KnowledgeRef(ref()), upstreamDocId: 'doc-7' })
    expect(docRef).toBe(`${ref()}/doc-7`)
    expect(parseKnowledgeDocRef(docRef)).toEqual({ ref: ref(), upstreamDocId: 'doc-7' })
    expect(isKnowledgeDocRef(docRef)).toBe(true)
  })

  it('is longer than an audit token, which is why it is its own brand', () => {
    // Two UUIDs do not fit KNOWLEDGE_REF_MAX_LENGTH. A document is never the
    // audited resource — what an operation on one records is its knowledge base
    // — so the audit bound does not apply to it.
    const docRef = formatKnowledgeDocRef({ ref: KnowledgeRef(ref()), upstreamDocId: UUID })
    expect(docRef.length).toBeGreaterThan(KNOWLEDGE_REF_MAX_LENGTH)
    expect(isKnowledgeDocRef(docRef)).toBe(true)
  })

  it.each([
    ['a knowledge base that is not a reference', 'weknora:prod', 'doc-1'],
    ['an empty document id', ref(), ''],
    ['a document id holding the separator', ref(), 'a/b'],
    ['a document id holding a colon', ref(), 'a:b'],
    ['a document id over the maximum', ref(), 'd'.repeat(KNOWLEDGE_DOC_ID_MAX_LENGTH + 1)],
  ])('refuses %s', (_label, base, upstreamDocId) => {
    expect(() => formatKnowledgeDocRef({ ref: KnowledgeRef(base), upstreamDocId }))
      .toThrow(InvalidKnowledgeRefError)
  })

  it.each([
    ['a value with no separator', 'weknora:prod:kb-1'],
    ['a value whose knowledge base is not one', 'weknora:prod/doc-1'],
    ['a value with nothing after the separator', `${ref()}/`],
  ])('reads %s as not a document reference', (_label, value) => {
    expect(parseKnowledgeDocRef(value)).toBeUndefined()
    expect(isKnowledgeDocRef(value)).toBe(false)
  })

  it('brands a raw string without checking it, for a caller that already proved the grammar', () => {
    expect(KnowledgeDocRef('anything')).toBe('anything')
  })
})

describe('session scope fold', () => {
  it('folds an empty log to off', () => {
    expect(foldKnowledgeScope([])).toEqual(DEFAULT_KNOWLEDGE_SCOPE)
    expect(foldKnowledgeScope([otherEvent(0)])).toEqual({ version: 1, mode: 'off' })
  })

  it('takes the last recorded scope', () => {
    const selected: KnowledgeScope = {
      version: 1,
      mode: 'selected',
      bases: [{ ref: KnowledgeRef(ref()), displayName: '临港知识库' }],
    }
    const events = [scopeEvent({ version: 1, mode: 'all' }, 0), otherEvent(1), scopeEvent(selected, 2)]
    expect(foldKnowledgeScope(events)).toEqual(selected)
  })

  it('folds a prefix, so rewind and fork read what the log said then', () => {
    const events = [
      scopeEvent({ version: 1, mode: 'all' }, 0),
      scopeEvent({ version: 1, mode: 'off' }, 1),
    ]
    expect(foldKnowledgeScope(events, 1)).toEqual({ version: 1, mode: 'all' })
    expect(foldKnowledgeScope(events, 0)).toEqual(DEFAULT_KNOWLEDGE_SCOPE)
    expect(foldKnowledgeScope(events)).toEqual({ version: 1, mode: 'off' })
  })
})

describe('scope validation', () => {
  it('accepts the modes that carry no bases', () => {
    expect(parseKnowledgeScope({ version: 1, mode: 'off' })).toEqual({ version: 1, mode: 'off' })
    expect(parseKnowledgeScope({ version: 1, mode: 'all' })).toEqual({ version: 1, mode: 'all' })
  })

  it('accepts a selection and keeps the recorded display name', () => {
    const parsed = parseKnowledgeScope({
      version: 1,
      mode: 'selected',
      bases: [{ ref: ref(), displayName: '南昌知识库' }],
    })
    expect(parsed).toEqual({
      version: 1,
      mode: 'selected',
      bases: [{ ref: ref(), displayName: '南昌知识库' }],
    })
  })

  it.each([
    ['a non-object', 'off'],
    ['null', null],
    ['an unknown version', { version: 2, mode: 'off' }],
    ['an unknown mode', { version: 1, mode: 'everything' }],
    ['a selection with no bases array', { version: 1, mode: 'selected' }],
    ['an empty selection', { version: 1, mode: 'selected', bases: [] }],
    ['a non-object base', { version: 1, mode: 'selected', bases: ['x'] }],
    ['a null base', { version: 1, mode: 'selected', bases: [null] }],
    ['a malformed reference', { version: 1, mode: 'selected', bases: [{ ref: 'weknora', displayName: 'n' }] }],
    ['a non-string reference', { version: 1, mode: 'selected', bases: [{ ref: 7, displayName: 'n' }] }],
    ['a missing display name', { version: 1, mode: 'selected', bases: [{ ref: ref() }] }],
    ['an empty display name', { version: 1, mode: 'selected', bases: [{ ref: ref(), displayName: '' }] }],
  ])('refuses %s', (_label, value) => {
    expect(parseKnowledgeScope(value)).toBeUndefined()
  })
})

describe('operation selection', () => {
  it('builds no selection while the scope is off', () => {
    expect(selectionOf({ version: 1, mode: 'off' })).toBeUndefined()
  })

  it('leaves all unexpanded, because expansion is the Control Plane authorizing', () => {
    expect(selectionOf({ version: 1, mode: 'all' })).toEqual({ mode: 'all' })
  })

  it('carries the selected references without their display names', () => {
    expect(selectionOf({
      version: 1,
      mode: 'selected',
      bases: [{ ref: KnowledgeRef(ref()), displayName: '临港知识库' }],
    })).toEqual({ mode: 'selected', refs: [ref()] })
  })
})

describe('failures', () => {
  it('carries a closed reason, with and without developer detail', () => {
    const bare = new KnowledgeError('not-allowed')
    expect(bare.reason).toBe('not-allowed')
    expect(bare.message).toBe('not-allowed')
    expect(bare.name).toBe('KnowledgeError')
    expect(new KnowledgeError('upstream-invalid', 'missing data').message)
      .toBe('upstream-invalid: missing data')
  })
})

describe('the seam', () => {
  /** The smallest provider that satisfies the seam, for a mount test. */
  class StubKnowledge extends Knowledge {
    catalog(): Promise<readonly KnowledgeBaseEntry[]> {
      return Promise.resolve([{
        ref: KnowledgeRef(ref()),
        displayName: '临港知识库',
        description: '',
        kind: 'document',
      }])
    }

    documents(request: KnowledgeDocumentsRequest): Promise<KnowledgeDocumentPage> {
      return Promise.resolve({
        ref: request.ref,
        documents: [{
          docRef: KnowledgeDocRef(`${request.ref}/doc-1`),
          ref: request.ref,
          title: '运维手册',
          description: '',
          fileName: '运维手册.pdf',
          fileType: 'pdf',
          byteSize: 2048,
          state: 'ready',
          updatedAt: undefined,
        }],
        page: request.page ?? 1,
        pageSize: 20,
        total: 1,
      })
    }

    documentContent(request: KnowledgeDocumentRequest): Promise<KnowledgeDocumentContent> {
      return Promise.resolve({
        kind: 'text',
        docRef: request.docRef,
        fileName: '运维手册.pdf',
        text: '一级故障 30 分钟内响应。',
        truncated: false,
      })
    }

    search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult> {
      return Promise.resolve({ query: request.query, searched: [], passages: [], truncated: false })
    }
  }

  it('mounts under ctx.knowledge and answers every operation', async () => {
    const ctx = new Context()
    await ctx.plugin(StubKnowledge)
    const entries = await ctx.knowledge.catalog()
    expect(entries.map(entry => entry.displayName)).toEqual(['临港知识库'])
    const page = await ctx.knowledge.documents({ ref: KnowledgeRef(ref()) })
    expect(page.documents.map(document => document.docRef)).toEqual([`${ref()}/doc-1`])
    const content = await ctx.knowledge.documentContent({ docRef: KnowledgeDocRef(`${ref()}/doc-1`) })
    expect(content.kind).toBe('text')
    const result = await ctx.knowledge.search({ query: '年假', scope: { mode: 'all' } })
    expect(result.query).toBe('年假')
  })
})

describe('a document-narrowed scope', () => {
  const DOC_A = `${ref()}/doc-1`
  const DOC_B = `${ref()}/doc-2`

  /** A document-narrowed scope over the given references, each titled by its own reference. */
  function documentScope(base: string, docRefs: unknown): unknown {
    const documents = Array.isArray(docRefs)
      ? (docRefs as unknown[]).map(docRef => ({ ref: docRef, title: `标题 ${String(docRef)}` }))
      : docRefs
    return { version: 1, mode: 'selected', bases: [{ ref: base, displayName: '临港知识库', documents }] }
  }

  it('reads back as one knowledge base carrying the documents inside it, titles included', () => {
    const scope = parseKnowledgeScope(documentScope(ref(), [DOC_A, DOC_B]))
    expect(scope).toEqual({
      version: 1,
      mode: 'selected',
      bases: [{
        ref: ref(),
        displayName: '临港知识库',
        documents: [{ ref: DOC_A, title: `标题 ${DOC_A}` }, { ref: DOC_B, title: `标题 ${DOC_B}` }],
      }],
    })
  })

  it('reads a narrowing written under a name this build does not know as the whole knowledge base', () => {
    // Wider than the member chose, never narrower: the one cost of recording
    // the narrowing as an optional property rather than a mode.
    const scope = parseKnowledgeScope({
      version: 1, mode: 'selected', bases: [{ ref: ref(), displayName: '临港知识库', docRefs: [DOC_A] }],
    })
    expect(scope).toEqual({ version: 1, mode: 'selected', bases: [{ ref: ref(), displayName: '临港知识库' }] })
  })

  it('carries its knowledge base and its documents into one operation', () => {
    const scope = parseKnowledgeScope(documentScope(ref(), [DOC_A]))
    expect(selectionOf(scope as KnowledgeScope)).toEqual({
      mode: 'documents', ref: ref(), docRefs: [DOC_A],
    })
  })

  it('carries a knowledge base with no documents as the whole knowledge base', () => {
    const scope = parseKnowledgeScope({
      version: 1, mode: 'selected', bases: [{ ref: ref(), displayName: '临港知识库' }],
    })
    expect(selectionOf(scope as KnowledgeScope)).toEqual({ mode: 'selected', refs: [ref()] })
  })

  it('folds out of a log like any other scope', () => {
    const scope = parseKnowledgeScope(documentScope(ref(), [DOC_A])) as KnowledgeScope
    expect(foldKnowledgeScope([scopeEvent({ version: 1, mode: 'all' }, 1), scopeEvent(scope, 2)]))
      .toEqual(scope)
  })

  it.each([
    ['a document from another knowledge base', documentScope(ref(), [`${ref('other')}/doc-1`])],
    ['an empty document list', documentScope(ref(), [])],
    ['a document reference that is not one', documentScope(ref(), ['not-a-reference'])],
    ['a knowledge base that is not one', documentScope('weknora:prod', [DOC_A])],
    ['documents that are not a list', documentScope(ref(), 'doc-1')],
    ['a document that is not an object', {
      version: 1, mode: 'selected', bases: [{ ref: ref(), displayName: '临港知识库', documents: ['doc-1'] }],
    }],
    ['a document with no title', {
      version: 1, mode: 'selected', bases: [{ ref: ref(), displayName: '临港知识库', documents: [{ ref: DOC_A }] }],
    }],
    ['documents on one of several knowledge bases', {
      version: 1,
      mode: 'selected',
      bases: [
        { ref: ref(), displayName: '临港知识库', documents: [{ ref: DOC_A, title: '运维手册' }] },
        { ref: ref('other'), displayName: '南昌知识库' },
      ],
    }],
  ])('refuses %s', (_label, value) => {
    // A scope whose halves disagree would search a knowledge base its recorded
    // name does not describe, which is the one way it could promise something
    // a later search would not do.
    expect(parseKnowledgeScope(value)).toBeUndefined()
  })
})
