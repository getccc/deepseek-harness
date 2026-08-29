/**
 * The values a Runner and the Control Plane must derive identically, checked
 * against the primitives they claim to be rather than against themselves.
 */

import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  digestPublicKey,
  hashSecret,
  newPairingCode,
  newSecret,
  pkceChallenge,
  redeemSigningInput,
  refreshSigningInput,
  verifyDeviceSignature,
} from '../src/index.ts'

describe('secrets', () => {
  it('mints 32 bytes of entropy, base64url, never repeating', () => {
    const minted = new Set(Array.from({ length: 64 }, () => newSecret()))
    expect(minted.size).toBe(64)
    for (const secret of minted) {
      expect(Buffer.from(secret, 'base64url')).toHaveLength(32)
      expect(secret).toMatch(/^[A-Za-z0-9_-]+$/u)
    }
  })

  it('stores a secret only as its SHA-256 digest', () => {
    const secret = newSecret()
    expect(hashSecret(secret)).toBe(createHash('sha256').update(secret).digest('base64url'))
    expect(hashSecret(secret)).not.toContain(secret)
  })
})

describe('the pairing code', () => {
  it('excludes every character a person could misread across two screens', () => {
    const seen = new Set<string>()
    for (let index = 0; index < 200; index += 1) {
      for (const character of newPairingCode().replace('-', '')) seen.add(character)
    }
    // Vowels would let a code spell a word the eye completes; 0/O, 1/I and L
    // are the pairs that look alike in the fonts a browser picks.
    for (const forbidden of ['A', 'E', 'I', 'O', 'U', 'Y', '0', '1', 'L']) {
      expect(seen.has(forbidden), forbidden).toBe(false)
    }
  })
})

describe('PKCE', () => {
  it('is the S256 transformation RFC 7636 defines', () => {
    const verifier = newSecret()
    expect(pkceChallenge(verifier))
      .toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('gives a different challenge for every verifier', () => {
    expect(pkceChallenge('a')).not.toBe(pkceChallenge('b'))
  })
})

describe('the public-key digest', () => {
  it('names the key without carrying it', () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
    expect(digestPublicKey(spki)).toBe(createHash('sha256').update(spki).digest('base64url'))
    expect(digestPublicKey(spki)).not.toContain(spki)
  })
})

describe('what a device signs', () => {
  it('names both the transaction and the code, so one signature does not travel', () => {
    expect(redeemSigningInput('t1', 'c1')).not.toBe(redeemSigningInput('t2', 'c1'))
    expect(redeemSigningInput('t1', 'c1')).not.toBe(redeemSigningInput('t1', 'c2'))
    // The code itself is not in the signed string: a signature that leaked
    // would otherwise carry the code that made it.
    expect(redeemSigningInput('t1', 'c1')).not.toContain('c1')
  })

  it('separates a redemption from a refresh', () => {
    expect(redeemSigningInput('id', 'secret')).not.toBe(refreshSigningInput('id', 'secret'))
  })
})

describe('signature verification', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  const signature = sign(null, Buffer.from('input'), privateKey).toString('base64url')

  it('accepts what the matching private key signed', () => {
    expect(verifyDeviceSignature(spki, 'input', signature)).toBe(true)
  })

  it('rejects a signature over other bytes, and one from another key', () => {
    expect(verifyDeviceSignature(spki, 'other', signature)).toBe(false)
    const other = generateKeyPairSync('ed25519')
    const otherSpki = other.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
    expect(verifyDeviceSignature(otherSpki, 'input', signature)).toBe(false)
  })

  it('refuses a malformed key or signature instead of throwing', () => {
    expect(verifyDeviceSignature('not-a-key', 'input', signature)).toBe(false)
    expect(verifyDeviceSignature(spki, 'input', 'not-a-signature')).toBe(false)
  })
})
