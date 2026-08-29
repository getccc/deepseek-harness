/**
 * The catalogs and the value rules, which together are the reason an audit
 * record cannot carry a member's work.
 */

import { describe, expect, it } from 'vitest'
import { OrgId } from '@deepseek-ai/dsh-account-store'
import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
  InvalidAuditValueError,
  METADATA_KEYS,
  MetadataKeyNotAllowedError,
  UnknownAuditActionError,
  UnknownMetadataKeyError,
  isAuditAction,
  isAuditToken,
  satisfiesSpec,
  checkAuditRecord,
  type AuditRecord,
} from '../src/index.ts'

const orgId = OrgId('org-1')

/** A minimal well-formed record, which each test then spoils in one way. */
function record(patch: Partial<AuditRecord> = {}): AuditRecord {
  return { orgId, action: 'member.login', outcome: 'allowed', ...patch }
}

describe('the two catalogs agree', () => {
  it('declares only metadata keys the metadata catalog registers', () => {
    for (const [action, spec] of Object.entries(AUDIT_ACTIONS)) {
      for (const key of spec.metadata) {
        expect(Object.hasOwn(METADATA_KEYS, key), `${action} declares ${key}`).toBe(true)
      }
    }
  })

  it('leaves no metadata key without an action that carries it', () => {
    const declared = new Set(Object.values(AUDIT_ACTIONS).flatMap(spec => [...spec.metadata]))
    expect([...Object.keys(METADATA_KEYS)].filter(key => !declared.has(key as never))).toEqual([])
  })

  it('lists every action’s resource type once', () => {
    const types = Object.values(AUDIT_ACTIONS).map(spec => spec.resourceType)
    expect([...AUDIT_RESOURCE_TYPES].sort()).toEqual([...new Set(types)].sort())
  })

  it('recognizes catalog actions and nothing else', () => {
    expect(isAuditAction('device.bind')).toBe(true)
    expect(isAuditAction('device.explode')).toBe(false)
    expect(isAuditAction('toString')).toBe(false)
  })
})

describe('a token is short and plain', () => {
  it('admits identifiers, versions, and refs', () => {
    for (const value of ['a', 'deepseek-chat', '1.2.3', 'user:42', 'runner@2.0.0', 'a'.repeat(64)]) {
      expect(isAuditToken(value), value).toBe(true)
    }
  })

  it('refuses prose, paths, and anything overlong', () => {
    for (const value of ['two words', '/Users/alice/app.ts', 'a'.repeat(65), '', 'why?', 'x\ny']) {
      expect(isAuditToken(value), JSON.stringify(value)).toBe(false)
    }
  })
})

describe('a metadata value satisfies its kind', () => {
  it('counts whole non-negative numbers only', () => {
    const spec = { kind: 'count' } as const
    expect(satisfiesSpec(spec, 0)).toBe(true)
    expect(satisfiesSpec(spec, 12)).toBe(true)
    expect(satisfiesSpec(spec, -1)).toBe(false)
    expect(satisfiesSpec(spec, 1.5)).toBe(false)
    expect(satisfiesSpec(spec, '12')).toBe(false)
  })

  it('labels only with a listed word', () => {
    const spec = { kind: 'label', members: ['darwin', 'linux'] } as const
    expect(satisfiesSpec(spec, 'linux')).toBe(true)
    expect(satisfiesSpec(spec, 'plan9')).toBe(false)
    expect(satisfiesSpec(spec, 1)).toBe(false)
  })

  it('refs only with a token', () => {
    const spec = { kind: 'ref' } as const
    expect(satisfiesSpec(spec, '2.4.1')).toBe(true)
    expect(satisfiesSpec(spec, 'the whole prompt')).toBe(false)
    expect(satisfiesSpec(spec, 7)).toBe(false)
  })
})

describe('the check names the problem instead of throwing it', () => {
  it('passes a record whose every field follows its rule', () => {
    expect(checkAuditRecord(record({
      principalId: 'user-1' as never,
      resourceId: 'deepseek-chat',
      deviceId: 'device-1',
      correlationId: 'c-9f2a',
      metadata: { authMethod: 'password' },
    }))).toBeUndefined()
  })

  it('refuses an action this build does not audit', () => {
    expect(checkAuditRecord(record({ action: 'member.vanish' as never })))
      .toBeInstanceOf(UnknownAuditActionError)
  })

  it('refuses a metadata key no catalog registers', () => {
    expect(checkAuditRecord(record({ metadata: { prompt: 'hello' } as never })))
      .toBeInstanceOf(UnknownMetadataKeyError)
  })

  it('refuses a registered key the action does not declare', () => {
    expect(checkAuditRecord(record({ metadata: { itemCount: 3 } })))
      .toBeInstanceOf(MetadataKeyNotAllowedError)
  })

  it('refuses a declared key whose value fails its kind', () => {
    expect(checkAuditRecord(record({ metadata: { authMethod: 'telepathy' } })))
      .toBeInstanceOf(InvalidAuditValueError)
  })

  it('refuses prose in every token field, naming the field', () => {
    for (const field of ['resourceId', 'deviceId', 'correlationId'] as const) {
      expect(checkAuditRecord(record({ [field]: 'SELECT * FROM secrets' })), field)
        .toMatchObject({ name: 'InvalidAuditValueError', field })
    }
  })
})
