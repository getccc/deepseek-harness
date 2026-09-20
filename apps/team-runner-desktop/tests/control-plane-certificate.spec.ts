import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CERTIFICATE_VERDICT, certificateBody, issuedBy, pinnedCertificateVerdict,
} from '../src/control-plane-certificate.ts'

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')

const authority = fixture('deployment-authority.pem')
const server = fixture('control-plane-server.pem')
const unrelated = fixture('unrelated-authority.pem')
const pinned = new Map([['control.test', authority]])

describe('control plane certificate pinning', () => {
  it('leaves every other host to Chromium', () => {
    const request = { hostname: 'registry.npmjs.org', certificate: { data: server } }
    expect(pinnedCertificateVerdict(request, pinned)).toBe(CERTIFICATE_VERDICT.chromium)
  })

  it('accepts a server certificate the pinned authority signed, chain or no chain', () => {
    // nginx may send only its own certificate, so issuance is what decides.
    expect(pinnedCertificateVerdict({ hostname: 'control.test', certificate: { data: server } }, pinned))
      .toBe(CERTIFICATE_VERDICT.accept)
    expect(pinnedCertificateVerdict(
      { hostname: 'CONTROL.TEST', certificate: { data: server, issuerCert: { data: authority } } },
      pinned,
    )).toBe(CERTIFICATE_VERDICT.accept)
  })

  it('refuses a certificate from any other authority on the pinned host', () => {
    expect(pinnedCertificateVerdict({ hostname: 'control.test', certificate: { data: unrelated } }, pinned))
      .toBe(CERTIFICATE_VERDICT.reject)
  })

  it('refuses the pinned host when the staged authority is not a certificate', () => {
    const broken = new Map([['control.test', 'not a certificate']])
    expect(pinnedCertificateVerdict({ hostname: 'control.test', certificate: { data: server } }, broken))
      .toBe(CERTIFICATE_VERDICT.reject)
  })

  it('ends a self-referencing chain instead of walking it forever', () => {
    const root: { data: string; issuerCert?: unknown } = { data: unrelated }
    root.issuerCert = root
    expect(pinnedCertificateVerdict(
      { hostname: 'control.test', certificate: root as { data: string } },
      pinned,
    )).toBe(CERTIFICATE_VERDICT.reject)
  })

  it('reads one certificate body out of surrounding text and whitespace', () => {
    expect(certificateBody(`lead\n${authority}trail\n`)).toBe(certificateBody(authority))
    expect(certificateBody('no certificate here')).toBe('')
  })

  it('reports issuance only for the pair that has it', () => {
    expect(issuedBy(server, authority)).toBe(true)
    expect(issuedBy(server, unrelated)).toBe(false)
    expect(issuedBy('garbage', authority)).toBe(false)
  })
})
