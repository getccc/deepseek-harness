import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { decideUpdate } from '@deepseek-ai/dsh-team-update'
import { readUpdateMetadata, releaseManifest, signRelease } from '../scripts/release-manifest.mjs'

const keys = generateKeyPairSync('ed25519')
const privateKeyPem = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
const releaseKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')

const BASE_URL = 'https://control.test/updates/'
const ZIP = Buffer.from('a notarized application bundle')
const XZIP = Buffer.from('a notarized application bundle for Intel')
const EXE = Buffer.from('a windows installer')

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** One release directory as electron-builder leaves it. */
function release(
  version: string,
  platforms: { mac?: boolean | 'arm64' | 'x64'; win?: boolean } = { mac: true, win: true },
): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-release-'))
  directories.push(directory)
  if (platforms.mac !== undefined && platforms.mac !== false) {
    // `true` is a release built for both macOS architectures, as electron-builder
    // writes it when one run produces both zips.
    const built = platforms.mac === true ? ['arm64', 'x64'] : [platforms.mac]
    const files = built.flatMap((architecture) => {
      writeFileSync(join(directory, `WeWork-mac-${architecture}.zip`), architecture === 'arm64' ? ZIP : XZIP)
      writeFileSync(join(directory, `WeWork-mac-${architecture}.dmg`), Buffer.from('a disk image nothing updates from'))
      return [
        `  - url: WeWork-mac-${architecture}.zip`,
        `    size: ${String((architecture === 'arm64' ? ZIP : XZIP).length)}`,
        `  - url: WeWork-mac-${architecture}.dmg`,
        '    size: 33',
      ]
    })
    writeFileSync(join(directory, 'latest-mac.yml'), [`version: ${version}`, 'files:', ...files, ''].join('\n'))
  }
  if (platforms.win === true) {
    writeFileSync(join(directory, 'WeWork.exe'), EXE)
    writeFileSync(join(directory, 'latest.yml'), [
      `version: ${version}`,
      'files:',
      '  - url: WeWork.exe',
      `    size: ${String(EXE.length)}`,
      '',
    ].join('\n'))
  }
  return directory
}

describe('release manifest', () => {
  it('describes the artifact each platform updates from, never the disk image', () => {
    const manifest = releaseManifest({
      directory: release('1.1.0'), version: '1.1.0', minimumFrom: '1.0.0', baseUrl: BASE_URL, publishedAt: 42,
    })
    expect(manifest.artifacts).toEqual([
      {
        platform: 'darwin',
        architecture: 'arm64',
        url: 'https://control.test/updates/WeWork-mac-arm64.zip',
        digest: createHash('sha256').update(ZIP).digest('base64url'),
        sizeBytes: ZIP.length,
      },
      {
        platform: 'darwin',
        architecture: 'x64',
        url: 'https://control.test/updates/WeWork-mac-x64.zip',
        digest: createHash('sha256').update(XZIP).digest('base64url'),
        sizeBytes: XZIP.length,
      },
      {
        platform: 'win32',
        architecture: 'x64',
        url: 'https://control.test/updates/WeWork.exe',
        digest: createHash('sha256').update(EXE).digest('base64url'),
        sizeBytes: EXE.length,
      },
    ])
    expect(manifest).toMatchObject({ version: '1.1.0', minimumFrom: '1.0.0', publishedAt: 42 })
  })

  it('publishes one platform when only that one was built', () => {
    const manifest = releaseManifest({
      directory: release('1.1.0', { mac: true }), version: '1.1.0', minimumFrom: '1.0.0', baseUrl: BASE_URL,
    })
    expect(manifest.artifacts.map(artifact => artifact.platform)).toEqual(['darwin', 'darwin'])
  })

  it('publishes only the macOS architecture that was built', () => {
    const intel = releaseManifest({
      directory: release('1.1.0', { mac: 'x64' }), version: '1.1.0', minimumFrom: '1.0.0', baseUrl: BASE_URL,
    })
    expect(intel.artifacts.map(artifact => [artifact.architecture, artifact.url])).toEqual([
      ['x64', 'https://control.test/updates/WeWork-mac-x64.zip'],
    ])
    const appleSilicon = releaseManifest({
      directory: release('1.1.0', { mac: 'arm64' }), version: '1.1.0', minimumFrom: '1.0.0', baseUrl: BASE_URL,
    })
    expect(appleSilicon.artifacts.map(artifact => artifact.architecture)).toEqual(['arm64'])
  })

  it('is accepted by an Intel build and never offers it the Apple silicon zip', () => {
    const manifest = releaseManifest({
      directory: release('1.1.0'), version: '1.1.0', minimumFrom: '1.0.0', baseUrl: BASE_URL,
    })
    const document = signRelease(manifest, privateKeyPem)
    const decision = decideUpdate(document.manifest, document.signature, {
      releaseKey, installedVersion: '1.0.0', platform: 'darwin', architecture: 'x64',
    })
    expect(decision).toEqual({ install: manifest.artifacts[1] })
  })

  it('refuses a release directory built for another version', () => {
    // Publishing the previous build under this version's number would sign a
    // manifest over the wrong files.
    expect(() => releaseManifest({
      directory: release('1.0.9'), version: '1.1.0', minimumFrom: '1.0.0', baseUrl: BASE_URL,
    })).toThrow(/latest-mac\.yml describes 1\.0\.9, not 1\.1\.0/u)
  })

  it('refuses a directory with no update metadata at all', () => {
    expect(() => releaseManifest({
      directory: release('1.1.0', {}), version: '1.1.0', minimumFrom: '1.0.0', baseUrl: BASE_URL,
    })).toThrow(/no update metadata for any platform/u)
  })

  it('reads a metadata document and refuses one that is not one', () => {
    expect(readUpdateMetadata('version: 1.0.0\nfiles:\n  - url: a.zip\n    size: 3\n'))
      .toEqual({ version: '1.0.0', files: [{ url: 'a.zip', size: 3 }] })
    expect(() => readUpdateMetadata('version: 1.0.0\n')).toThrow(/no version or file list/u)
  })
})

describe('the published document', () => {
  it('is accepted by the build it was published for', () => {
    // The round trip that matters: what the release machine signs is what an
    // installed application accepts.
    const manifest = releaseManifest({
      directory: release('1.1.0'), version: '1.1.0', minimumFrom: '1.0.0', baseUrl: BASE_URL,
    })
    const document = signRelease(manifest, privateKeyPem)
    const decision = decideUpdate(document.manifest, document.signature, {
      releaseKey, installedVersion: '1.0.0', platform: 'darwin', architecture: 'arm64',
    })
    expect(decision).toEqual({ install: manifest.artifacts[0] })
  })

  it('is refused once anything in it is altered', () => {
    const manifest = releaseManifest({
      directory: release('1.1.0'), version: '1.1.0', minimumFrom: '1.0.0', baseUrl: BASE_URL,
    })
    const document = signRelease(manifest, privateKeyPem)
    const altered = {
      ...document.manifest,
      artifacts: [{ ...document.manifest.artifacts[0], url: 'https://attacker.test/WeWork.zip' }],
    }
    expect(decideUpdate(altered, document.signature, {
      releaseKey, installedVersion: '1.0.0', platform: 'darwin', architecture: 'arm64',
    })).toEqual({ refused: 'signature' })
  })

  it('refuses to sign with anything but an Ed25519 release key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const manifest = releaseManifest({
      directory: release('1.1.0'), version: '1.1.0', minimumFrom: '1.0.0', baseUrl: BASE_URL,
    })
    expect(() => signRelease(manifest, rsa.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()))
      .toThrow(/must be an Ed25519 private key/u)
  })
})
