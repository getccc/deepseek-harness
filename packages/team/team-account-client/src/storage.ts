/**
 * Where the Runner keeps its device key and its team credential.
 *
 * Both live in the credential provider rather than in a file this package
 * writes, so whatever protection a deployment gives credentials covers them
 * too, and so a `dsh` installation has one place a person can inspect and
 * clear.
 * @module @deepseek-ai/dsh-team-account-client/storage
 */

import type { KeyObject } from 'node:crypto'
import { createPrivateKey } from 'node:crypto'
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { DeviceId, FamilyId } from '@deepseek-ai/dsh-device-authorization'
import type { StoredCredential } from './types.ts'

/** Where this computer's device key pair is kept. */
export const DEVICE_KEY_RECORD = credentialKey('team', 'device-key')

/** Where the team credential is kept. */
export const TEAM_CREDENTIAL_RECORD = credentialKey('team', 'credential')

/** The device key as this Runner uses it. */
export interface DeviceKey {
  /** Base64url DER SPKI encoding, which is what the Control Plane stores and digests. */
  readonly publicKey: string
  /** The private half, never leaving this process in any encoded form. */
  readonly privateKey: KeyObject
}

/** What the stored device-key record holds. */
interface DeviceKeyPayload {
  readonly publicKey: string
  readonly privateKey: string
}

/** Generate one Ed25519 pair, as `node:crypto` does. */
export type GenerateKeyPair = (type: 'ed25519') => { publicKey: KeyObject; privateKey: KeyObject }

/**
 * Read this computer's device key, generating it on first use.
 *
 * Generation happens inside the provider's own read-decide-replace, so two
 * Runners racing at first start end with one key rather than two identities.
 * @param credentials - the provider holding this installation's records.
 * @param generate - the key-pair generator, so the caller names the algorithm once.
 * @returns the public encoding the Control Plane sees and the private key this process signs with.
 */
export async function readDeviceKey(
  credentials: CredentialProvider,
  generate: GenerateKeyPair,
): Promise<DeviceKey> {
  const record = await credentials.modifyRecord(DEVICE_KEY_RECORD, (current) => {
    if (current !== undefined) return Promise.resolve(undefined)
    const pair = generate('ed25519')
    const payload: DeviceKeyPayload = {
      publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
      privateKey: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
    }
    return Promise.resolve({ kind: 'grant', payload })
  })
  /* v8 ignore next 3 -- modifyRecord answers with the record after the write, so
     a caller that just wrote or declined always receives one; the check is for
     the type, not a reachable path. */
  if (record === undefined || record.kind !== 'grant') {
    throw new Error('team-account-client: the device key record is missing after a write')
  }
  const payload = record.payload as DeviceKeyPayload
  return {
    publicKey: payload.publicKey,
    privateKey: createPrivateKey({
      key: Buffer.from(payload.privateKey, 'base64url'),
      format: 'der',
      type: 'pkcs8',
    }),
  }
}

/**
 * Read the stored team credential.
 * @param credentials - the provider holding this installation's records.
 * @returns the credential, or undefined when this computer is not bound.
 */
export async function readCredential(credentials: CredentialProvider): Promise<StoredCredential | undefined> {
  const record = await credentials.readRecord(TEAM_CREDENTIAL_RECORD)
  // A record of another kind at this key came from someone editing the store by
  // hand. This computer is not bound, which is the same answer as holding
  // nothing, and is the answer that lets a member bind again.
  return record?.kind === 'grant' ? record.payload as StoredCredential : undefined
}

/**
 * Replace the stored team credential with the one just issued.
 *
 * The write goes through the provider's read-decide-replace, so two refreshes
 * racing cannot leave the older token behind the newer one.
 * @param credentials - the provider holding this installation's records.
 * @param issued - the credential the Control Plane just returned.
 */
export async function writeCredential(credentials: CredentialProvider, issued: {
  deviceId: DeviceId
  familyId: FamilyId
  refreshToken: string
  refreshExpiresAt: number
  accessToken: string
  accessExpiresAt: number
}): Promise<void> {
  const payload: StoredCredential = {
    deviceId: issued.deviceId,
    familyId: issued.familyId,
    refreshToken: issued.refreshToken,
    refreshExpiresAt: issued.refreshExpiresAt,
    accessToken: issued.accessToken,
    accessExpiresAt: issued.accessExpiresAt,
  }
  await credentials.modifyRecord(TEAM_CREDENTIAL_RECORD, () =>
    Promise.resolve({ kind: 'grant', payload }))
}
