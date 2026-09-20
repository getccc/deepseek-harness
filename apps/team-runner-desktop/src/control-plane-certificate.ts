/**
 * Accepting the deployment's own certificate authority for the Control Plane
 * host, and nothing else.
 *
 * `electron-updater` requests through Electron's network stack, which trusts
 * the operating system's store and therefore rejects a Control Plane behind a
 * private authority. The shell answers those verifications itself for that one
 * host; every other host keeps Chromium's own verdict.
 * @module @deepseek-ai/dsh-team-runner-desktop/control-plane-certificate
 */

import { X509Certificate } from 'node:crypto'

/** Verdicts `session.setCertificateVerifyProc` accepts from this shell. */
export const CERTIFICATE_VERDICT = {
  /** Trust this certificate for this request. */
  accept: 0,
  /** Refuse the request. */
  reject: -2,
  /** Keep the result Chromium reached on its own. */
  chromium: -3,
} as const

/** One verdict returned to Chromium. */
export type CertificateVerdict = typeof CERTIFICATE_VERDICT[keyof typeof CERTIFICATE_VERDICT]

/** How far a chain is walked before it is treated as unrelated to the pinned authority. */
const MAX_CHAIN_DEPTH = 10

/** The part of Chromium's certificate record this decision reads. */
export interface VerifiedChain {
  /** PEM encoding of this certificate. */
  readonly data: string
  /** The certificate that signed this one; a self-signed root names itself. */
  readonly issuerCert?: VerifiedChain
}

/** What Chromium asks the shell to rule on. */
export interface CertificateRequest {
  readonly hostname: string
  readonly certificate: VerifiedChain
}

/**
 * Reduce one PEM document to the base64 body of its first certificate, so two
 * encodings of the same certificate compare equal.
 * @param pem - PEM text holding at least one certificate.
 * @returns the base64 body, or the empty string when the text holds none.
 */
export function certificateBody(pem: string): string {
  const match = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/u.exec(pem)
  return match === null ? '' : (match[1] as string).replace(/\s+/gu, '')
}

/**
 * Whether `authority` signed `certificate`, read as issuance rather than as
 * presence in a chain, so a server that sends only its own certificate is
 * still recognized.
 * @param certificate - PEM of the certificate under test.
 * @param authority - PEM of the pinned certificate authority.
 * @returns true when the authority's name and key account for the signature.
 */
export function issuedBy(certificate: string, authority: string): boolean {
  try {
    const leaf = new X509Certificate(certificate)
    const root = new X509Certificate(authority)
    return leaf.checkIssued(root) && leaf.verify(root.publicKey)
  } catch {
    // Either document failed to parse as a certificate; it cannot be the
    // pinned pair, and a malformed certificate is never accepted here.
    return false
  }
}

/**
 * Rule on one certificate verification.
 * @param request - the hostname and chain Chromium observed.
 * @param authorities - pinned authority PEM by lowercase hostname.
 * @returns the verdict for `session.setCertificateVerifyProc`.
 */
export function pinnedCertificateVerdict(
  request: CertificateRequest,
  authorities: ReadonlyMap<string, string>,
): CertificateVerdict {
  const authority = authorities.get(request.hostname.toLowerCase())
  if (authority === undefined) return CERTIFICATE_VERDICT.chromium
  const pinned = certificateBody(authority)
  if (pinned === '') return CERTIFICATE_VERDICT.reject
  let node: VerifiedChain | undefined = request.certificate
  for (let depth = 0; node !== undefined && depth < MAX_CHAIN_DEPTH; depth += 1) {
    if (certificateBody(node.data) === pinned) return CERTIFICATE_VERDICT.accept
    if (issuedBy(node.data, authority)) return CERTIFICATE_VERDICT.accept
    node = node.issuerCert === node ? undefined : node.issuerCert
  }
  return CERTIFICATE_VERDICT.reject
}
