import { describe, expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createSessionFormatCatalogWithChildren } from '../src/index.ts'

// Payloads as members' WeWork v0 and v2 writers recorded them, including retired office kinds.
const recorded = [
  {
    type: 'knowledge/scope',
    data: {
      version: 1, mode: 'selected',
      bases: [{ ref: 'weknora:prod:8dd1426d-c3a3-46fb-993f-cf1510fb9b18', displayName: '产品技术文档' }],
    },
  },
  { type: 'office/kind', data: { version: 1, kind: 'amec-ppt' } },
  { type: 'knowledge/scope', data: { version: 1, mode: 'all' } },
  { type: 'office/kind', data: { version: 1, kind: 'ppt' } },
  { type: 'knowledge/scope', data: { version: 1, mode: 'off' } },
] as const

function header(version: 0 | 2) {
  return version === 0
    ? { type: 'session', version, id: 'wework-history', createdAt: 1, delegationDepth: 0 }
    : { type: 'session', version, id: 'wework-history', createdAt: 1, isSeeded: false, delegationDepth: 0 }
}

function restore(version: 0 | 2, events: readonly { readonly type: string; readonly data: unknown }[]) {
  const current = createSessionFormatCatalogWithChildren([]).createRestore(header(version), {
    recovery: 'strict', validation: 'current',
  })
  current.decodeRow({ type: 'permission/preset', seq: 0, time: 1, data: { preset: 'workspace-write' } })
  events.forEach((event, index) => { current.decodeRow({ ...event, seq: index + 1, time: index + 2 }) })
  return current.finish()
}

describe('released WeWork Session events', () => {
  it.each([0, 2] as const)('restores v%i knowledge-scope and office-kind events unchanged in the current format', (version) => {
    const artifact = restore(version, recorded)

    expect(artifact.header.version).toBe(SESSION_FORMAT_VERSION)
    expect(artifact.events.filter(event => event.type === 'knowledge/scope' || event.type === 'office/kind')
      .map(({ type, data }) => ({ type, data }))).toEqual(recorded)
  })

  it.each([0, 2] as const)('refuses v%i BI-scope and web-access events that only V3 writers recorded', (version) => {
    for (const event of [
      { type: 'bi/scope', data: { version: 1, mode: 'off' } },
      { type: 'web/access', data: { enabled: false } },
    ]) {
      expect(() => restore(version, [event]), event.type).toThrow(new RegExp(`unknown historical event type "${event.type}"|unclassified event ${event.type}`))
    }
  })

  it.each([0, 2] as const)('refuses a v%i knowledge scope carrying a member no released writer recorded', (version) => {
    expect(() => restore(version, [{ type: 'knowledge/scope', data: { version: 1, mode: 'off', documentRef: 'doc' } }]))
      .toThrow(/unexpected (member|field) "?documentRef/)
  })
})
