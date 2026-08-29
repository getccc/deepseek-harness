/**
 * The metadata key catalog: every extra fact an audit record may carry, and the
 * rule each one's value must satisfy.
 *
 * An audit record has no free-text field. Metadata is the only place a caller
 * supplies a value of its own choosing, so a key is not merely named here — it
 * declares a kind, and no kind admits a sentence. A count is a non-negative
 * integer, a label is one of a fixed set of words, and a ref is a short token
 * with no spaces and no slashes. A prompt, a path, a diff, or a query fails
 * every one of them.
 * @module @deepseek-ai/dsh-audit/metadata
 */

/**
 * What an audit metadata value may be.
 *
 * There is deliberately no free-string kind and no boolean kind: the first
 * would reopen the hole the catalog exists to close, and the second has no
 * caller in this build.
 */
export type MetadataSpec =
  /** A non-negative safe integer, such as a row count. */
  | { readonly kind: 'count' }
  /** One word from a fixed set, listed in full. */
  | { readonly kind: 'label'; readonly members: readonly string[] }
  /** A short opaque token: an identifier or a version, never prose. */
  | { readonly kind: 'ref' }

/**
 * What a `ref` value may look like: at most 64 characters drawn from letters,
 * digits, and `. _ : @ -`.
 *
 * The excluded characters are the point. No space rules out prose, no slash
 * rules out a filesystem path or a URL path, and the length rules out a
 * payload that survived both.
 */
export const AUDIT_TOKEN = /^[A-Za-z0-9._:@-]{1,64}$/u

/**
 * Every metadata key this build accepts.
 *
 * Keys arrive with the subsystem that records them. A key with no caller is a
 * hole nobody is watching, so this list stays as short as the audited
 * operations require.
 */
export const METADATA_KEYS = {
  /** How a member proved who they are. */
  authMethod: { kind: 'label', members: ['password'] },
  /** The operating system family a device reported when it bound. */
  platform: { kind: 'label', members: ['darwin', 'linux', 'win32'] },
  /** Which kind of credential an issue, rotate, or revoke acted on. */
  credentialKind: { kind: 'label', members: ['device', 'browser-session'] },
  /** The Runner build that performed a device operation. */
  runnerVersion: { kind: 'ref' },
  /** How many records an export produced. */
  itemCount: { kind: 'count' },
} as const satisfies Record<string, MetadataSpec>

/** A key the metadata catalog registers. */
export type MetadataKey = keyof typeof METADATA_KEYS

/** The metadata an audit record carries: catalog keys and their values. */
export type AuditMetadata = Readonly<Partial<Record<MetadataKey, number | string>>>

/**
 * Whether a string is short and plain enough to store in an audit record.
 * @param value - the candidate token.
 * @returns true when it matches {@link AUDIT_TOKEN}.
 */
export function isAuditToken(value: string): boolean {
  return AUDIT_TOKEN.test(value)
}

/**
 * Whether a metadata value satisfies its key's declared kind.
 * @param spec - the key's declared kind.
 * @param value - the value a caller supplied.
 * @returns true when the value is admissible for that kind.
 */
export function satisfiesSpec(spec: MetadataSpec, value: unknown): boolean {
  // Every arm returns, so TypeScript proves the union exhausted without a
  // default. A spec is only ever read out of METADATA_KEYS, a code constant, so
  // there is no parsed value here for a runtime guard to catch.
  switch (spec.kind) {
    case 'count':
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    case 'label':
      return typeof value === 'string' && spec.members.includes(value)
    case 'ref':
      return typeof value === 'string' && isAuditToken(value)
  }
}
