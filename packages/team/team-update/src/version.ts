/**
 * Comparing dotted numeric versions.
 *
 * The harness ships prerelease tags in its package version, and an update
 * decision must not turn on how those tags sort. Only the numeric components
 * are compared, and anything after them is ignored.
 * @module @deepseek-ai/dsh-team-update/version
 */

/** A version that is one to three numbers, optionally followed by a tag. */
const VERSION = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/u

/** Raised when a string is not a version this build can compare. */
export class MalformedVersionError extends Error {
  constructor(readonly value: string) {
    super(`version ${JSON.stringify(value)} is not one or more dot-separated numbers`)
    this.name = 'MalformedVersionError'
  }
}

/**
 * Read the numeric components of a version.
 * @param value - the version string.
 * @returns major, minor, and patch, with absent components read as zero.
 * @throws {MalformedVersionError} when the string does not start with numbers.
 */
export function versionComponents(value: string): [number, number, number] {
  const match = VERSION.exec(value)
  if (match === null) throw new MalformedVersionError(value)
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

/**
 * Order two versions by their numeric components.
 * @param left - the first version.
 * @param right - the second version.
 * @returns a negative number, zero, or a positive number, as a comparator does.
 * @throws {MalformedVersionError} when either string is not comparable.
 */
export function compareVersions(left: string, right: string): number {
  const a = versionComponents(left)
  const b = versionComponents(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] as number) - (b[index] as number)
    if (difference !== 0) return difference
  }
  return 0
}
