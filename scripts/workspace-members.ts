/**
 * pnpm workspace member declarations shared by repository checks, so a check
 * reads every declared member area instead of a hand-listed subset.
 * @module scripts/workspace-members
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'

/**
 * Read the `packages:` member globs declared by a pnpm workspace file.
 * @param root - repository root the workspace file path is relative to.
 * @param rel - workspace file path relative to {@link root}.
 * @returns the declared member globs in declaration order.
 * @throws Error when the file declares no members.
 */
export function workspaceMembers(root: string, rel = 'pnpm-workspace.yaml'): string[] {
  const declared = (yaml.load(readFileSync(resolve(root, rel), 'utf8')) as { packages?: unknown }).packages
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(`${rel} declares no workspace members; the manifest set cannot be derived.`)
  }
  return declared.map(member => String(member))
}

/**
 * Manifest globs derived from the workspace declarations, so a new member area
 * (`tools/*`) is read the day it is declared.
 * @param rootMembers - member globs declared by the workspace file.
 * @returns the root manifest plus one glob per declared member, repository-relative.
 */
export function manifestPatterns(rootMembers: readonly string[]): string[] {
  return [
    'package.json',
    ...rootMembers.map(member => `${member}/package.json`),
  ]
}
