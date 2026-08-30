/**
 * The update decision, driven with a real Ed25519 release key.
 *
 * A Runner replaces its own executable on the strength of this decision, so
 * every test here asks the same question: could a document nobody signed, or
 * one signed and then edited, get past it?
 */

import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MANIFEST_VERSION,
  MalformedVersionError,
  canonicalManifestBytes,
  compareVersions,
  decideUpdate,
  versionComponents,
  type UpdateArtifact,
  type UpdateManifest,
  type UpdateTarget,
} from '../src/index.ts'

/** A release key pair, as a release process would hold it. */
function newReleaseKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    releaseKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    signManifest: (manifest: UpdateManifest) =>
      sign(null, canonicalManifestBytes(manifest), privateKey).toString('base64url'),
  }
}

const key = newReleaseKey()

/** A well-formed release, which each test then varies. */
function manifest(patch: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    version: '2.5.0',
    minimumFrom: '2.0.0',
    publishedAt: 1_756_000_000_000,
    artifacts: [
      { platform: 'darwin', architecture: 'arm64', url: 'https://dl.example/2.5.0-darwin-arm64', digest: 'abc', sizeBytes: 100 },
      { platform: 'linux', architecture: 'x64', url: 'https://dl.example/2.5.0-linux-x64', digest: 'def', sizeBytes: 120 },
    ],
    ...patch,
  }
}

/** This computer, which each test then varies. */
function target(patch: Partial<UpdateTarget> = {}): UpdateTarget {
  return {
    releaseKey: key.releaseKey,
    installedVersion: '2.4.1',
    platform: 'darwin',
    architecture: 'arm64',
    ...patch,
  }
}

describe('the signature decides everything else', () => {
  it('installs the artifact for this computer when the release key signed it', () => {
    const release = manifest()
    expect(decideUpdate(release, key.signManifest(release), target()))
      .toEqual({ install: release.artifacts[0] })
  })

  it('refuses a manifest nobody signed, or one another key signed', () => {
    const release = manifest()
    expect(decideUpdate(release, 'not-a-signature', target())).toEqual({ refused: 'signature' })
    const impostor = newReleaseKey()
    expect(decideUpdate(release, impostor.signManifest(release), target())).toEqual({ refused: 'signature' })
  })

  it('refuses a manifest edited after it was signed', () => {
    const release = manifest()
    const signature = key.signManifest(release)
    const first = release.artifacts[0] as UpdateArtifact
    for (const edited of [
      manifest({ version: '9.9.9' }),
      manifest({ minimumFrom: '0.0.1' }),
      manifest({ publishedAt: 0 }),
      manifest({ artifacts: [{ ...first, url: 'https://evil.example/payload' }] }),
      manifest({ artifacts: [{ ...first, digest: 'tampered' }] }),
    ]) {
      expect(decideUpdate(edited, signature, target())).toEqual({ refused: 'signature' })
    }
  })

  it('refuses a release key that is not a key', () => {
    const release = manifest()
    expect(decideUpdate(release, key.signManifest(release), target({ releaseKey: 'nonsense' })))
      .toEqual({ refused: 'signature' })
  })
})

describe('what the canonical bytes fix', () => {
  it('signs the same release identically however its artifacts are ordered', () => {
    const forward = manifest()
    const reversed = manifest({ artifacts: [...forward.artifacts].reverse() })
    expect(canonicalManifestBytes(reversed)).toEqual(canonicalManifestBytes(forward))
    // So a signature made over one order verifies against the other, and a
    // release process is not forced to remember which order it used.
    expect(decideUpdate(reversed, key.signManifest(forward), target()))
      .toMatchObject({ install: { platform: 'darwin' } })
  })

  it('names the format, so a manifest cannot be replayed into another one', () => {
    expect(canonicalManifestBytes(manifest()).toString('utf8')).toMatch(/^dsh-update-manifest:1\n/u)
  })
})

describe('which releases may be applied', () => {
  it('refuses a release that is not newer than what is installed', () => {
    for (const installedVersion of ['2.5.0', '2.6.0']) {
      const release = manifest()
      expect(decideUpdate(release, key.signManifest(release), target({ installedVersion })), installedVersion)
        .toEqual({ refused: 'not-newer' })
    }
  })

  it('refuses a release the installed version is too old to receive', () => {
    const release = manifest({ minimumFrom: '2.4.5' })
    // The Runner installs an intermediate release first, rather than finding
    // out after it has already replaced itself.
    expect(decideUpdate(release, key.signManifest(release), target({ installedVersion: '2.4.1' })))
      .toEqual({ refused: 'upgrade-path' })
    expect(decideUpdate(release, key.signManifest(release), target({ installedVersion: '2.4.5' })))
      .toMatchObject({ install: { platform: 'darwin' } })
  })

  it('refuses a manifest format this build does not read', () => {
    const release = manifest({ manifestVersion: MANIFEST_VERSION + 1 })
    expect(decideUpdate(release, key.signManifest(release), target())).toEqual({ refused: 'manifest-version' })
  })

  it('refuses a release with nothing built for this computer', () => {
    const release = manifest()
    expect(decideUpdate(release, key.signManifest(release), target({ architecture: 'x64' })))
      .toEqual({ refused: 'no-artifact' })
    expect(decideUpdate(release, key.signManifest(release), target({ platform: 'win32' })))
      .toEqual({ refused: 'no-artifact' })
  })

  it('refuses a version it cannot compare rather than guessing an order', () => {
    const release = manifest({ version: 'latest' })
    expect(decideUpdate(release, key.signManifest(release), target())).toEqual({ refused: 'malformed-version' })
  })
})

describe('comparing versions', () => {
  it('orders by numeric components and ignores a prerelease tag', () => {
    expect(compareVersions('2.5.0', '2.4.9')).toBeGreaterThan(0)
    expect(compareVersions('2.4.9', '2.5.0')).toBeLessThan(0)
    expect(compareVersions('2.5.0', '2.5.0')).toBe(0)
    // The harness ships prerelease tags in its own version; an update decision
    // must not turn on how those sort.
    expect(compareVersions('0.1.2-alpha.1', '0.1.2')).toBe(0)
    expect(compareVersions('3', '3.0.0')).toBe(0)
    expect(compareVersions('3.1', '3.0.9')).toBeGreaterThan(0)
  })

  it('reads absent components as zero', () => {
    expect(versionComponents('4')).toEqual([4, 0, 0])
    expect(versionComponents('4.2')).toEqual([4, 2, 0])
    expect(versionComponents('4.2.7+build.9')).toEqual([4, 2, 7])
  })

  it('refuses a string that does not start with a number', () => {
    for (const value of ['latest', 'v2.5.0', '', 'two']) {
      expect(() => versionComponents(value), value).toThrow(MalformedVersionError)
    }
  })
})
