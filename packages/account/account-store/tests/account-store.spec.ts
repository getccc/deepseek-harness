/**
 * The seam's own vocabulary: the failures every provider must report the same
 * way, and the brands that keep an organization id from being passed where a
 * user id belongs.
 */

import { describe, expect, it } from 'vitest'
import {
  DuplicateLoginNameError,
  OrgId,
  UnknownAccountUserError,
  UnknownOrganizationError,
  UserId,
} from '../src/index.ts'

describe('account store errors', () => {
  it('names the conflicting login and its organization, so a caller can report which one', () => {
    const error = new DuplicateLoginNameError(OrgId('org-1'), 'alice')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('DuplicateLoginNameError')
    expect(error.orgId).toBe('org-1')
    expect(error.loginName).toBe('alice')
    // Quoted so a login name with surrounding whitespace is visible in the message.
    expect(error.message).toBe('login name "alice" already exists in organization org-1')
  })

  it('carries the account a failed operation named', () => {
    const error = new UnknownAccountUserError(UserId('user-1'))
    expect(error.name).toBe('UnknownAccountUserError')
    expect(error.userId).toBe('user-1')
    expect(error.message).toBe('unknown account user user-1')
  })

  it('carries the organization a failed operation named', () => {
    const error = new UnknownOrganizationError(OrgId('org-1'))
    expect(error.name).toBe('UnknownOrganizationError')
    expect(error.orgId).toBe('org-1')
    expect(error.message).toBe('unknown organization org-1')
  })
})

describe('account identities', () => {
  it('brands without changing the value, so a stored id round-trips exactly', () => {
    expect(OrgId('org-1')).toBe('org-1')
    expect(UserId('user-1')).toBe('user-1')
  })
})
