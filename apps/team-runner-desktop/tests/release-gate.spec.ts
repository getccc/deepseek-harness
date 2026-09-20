import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MANIFEST_VERSION, canonicalManifestBytes, type UpdateManifest } from '@deepseek-ai/dsh-team-update'
import { acceptRelease, readManifest, verifyDownload } from '../src/release-gate.ts'

const keys = generateKeyPairSync('ed25519')
const releaseKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
const strangerKey = generateKeyPairSync('ed25519').publicKey
  .export({ format: 'der', type: 'spki' }).toString('base64url')

const artifact = {
  platform: 'darwin',
  architecture: 'arm64',
  url: 'https://control.test/updates/WeWork-1.1.0-mac-arm64.zip',
  digest: 'VGhpcyBpcyBub3QgYSByZWFsIGRpZ2VzdA',
  sizeBytes: 293909077,
} as const

const manifest: UpdateManifest = {
  manifestVersion: MANIFEST_VERSION,
  version: '1.1.0',
  minimumFrom: '1.0.0',
  publishedAt: 1_790_000_000_000,
  artifacts: [artifact],
}

/** Sign one manifest with the release key, as the publishing step does. */
function signed(document: UpdateManifest = manifest, key = keys.privateKey) {
  return { manifest: document, signature: sign(null, canonicalManifestBytes(document), key).toString('base64url') }
}

const target = { releaseKey, installedVersion: '1.0.0', platform: 'darwin', architecture: 'arm64' } as const

const scratch: string[] = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** One downloaded file with the given bytes. */
function downloaded(bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-release-'))
  scratch.push(dir)
  const path = join(dir, 'WeWork.zip')
  writeFileSync(path, bytes)
  return path
}

describe('accepting a release', () => {
  it('accepts the artifact for this computer when the release key signed it', async () => {
    const verdict = await acceptRelease('1.1.0', target, async () => signed())
    expect(verdict).toEqual({ accepted: artifact, required: false })
  })

  it('reports an update the deployment refuses to run without', async () => {
    // The floor is the deployment's own statement, so it rides beside the
    // signed document rather than inside it.
    const floored = async () => ({ ...signed(), minimumVersion: '1.1.0' })
    expect(await acceptRelease('1.1.0', target, floored)).toMatchObject({ required: true })
    expect(await acceptRelease('1.1.0', { ...target, installedVersion: '1.1.0' }, floored))
      .toEqual({ refused: 'release refused: not-newer' })
  })

  it('refuses a manifest the trusted key did not sign', async () => {
    const verdict = await acceptRelease('1.1.0', { ...target, releaseKey: strangerKey }, async () => signed())
    expect(verdict).toEqual({ refused: 'release refused: signature' })
  })

  it('refuses a release no newer than the installed build', async () => {
    const verdict = await acceptRelease('1.1.0', { ...target, installedVersion: '1.1.0' }, async () => signed())
    expect(verdict).toEqual({ refused: 'release refused: not-newer' })
  })

  it('refuses a release this build may not be upgraded across', async () => {
    const gap = signed({ ...manifest, version: '3.0.0', minimumFrom: '2.0.0' })
    const verdict = await acceptRelease('3.0.0', target, async () => gap)
    expect(verdict).toEqual({ refused: 'release refused: upgrade-path' })
  })

  it('refuses a release carrying no artifact for this computer', async () => {
    const verdict = await acceptRelease('1.1.0', { ...target, platform: 'win32' }, async () => signed())
    expect(verdict).toEqual({ refused: 'release refused: no-artifact' })
  })

  it('refuses metadata that offers a version the signature does not cover', async () => {
    // The file beside the artifacts is not what this build trusts.
    const verdict = await acceptRelease('9.9.9', target, async () => signed())
    expect(verdict).toEqual({ refused: 'release metadata offers 9.9.9, the signed manifest 1.1.0' })
  })

  it('refuses when the manifest cannot be read at all', async () => {
    const verdict = await acceptRelease('1.1.0', target, async () => { throw new Error('unreachable deployment') })
    expect(verdict).toEqual({ refused: 'unreachable deployment' })
  })
})

describe('reading the manifest', () => {
  it('reads the document the deployment published', async () => {
    const document = signed()
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => document })
    await expect(readManifest('https://control.test/updates/manifest.json', request)).resolves.toEqual(document)
    expect(request).toHaveBeenCalledWith('https://control.test/updates/manifest.json')
  })

  it('refuses an error answer and a document missing either half', async () => {
    const failing = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) })
    await expect(readManifest('https://control.test/u', failing)).rejects.toThrow(/answered 502/u)
    const partial = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ manifest }) })
    await expect(readManifest('https://control.test/u', partial)).rejects.toThrow(/missing its manifest or signature/u)
  })
})

describe('verifying a download', () => {
  it('accepts the bytes the release key vouched for', async () => {
    const bytes = Buffer.from('a packaged application')
    const digest = (await import('node:crypto')).createHash('sha256').update(bytes).digest('base64url')
    const path = downloaded(bytes)
    await expect(verifyDownload(path, { ...artifact, digest, sizeBytes: bytes.length })).resolves.toBeUndefined()
  })

  it('refuses a file of the wrong size before it reads it', async () => {
    const path = downloaded(Buffer.from('short'))
    await expect(verifyDownload(path, artifact)).resolves.toMatch(/downloaded 5 bytes/u)
  })

  it('refuses bytes the signed manifest does not describe', async () => {
    const bytes = Buffer.from('a substituted application')
    const path = downloaded(bytes)
    await expect(verifyDownload(path, { ...artifact, sizeBytes: bytes.length }))
      .resolves.toBe('the downloaded file does not match the signed manifest')
  })
})
