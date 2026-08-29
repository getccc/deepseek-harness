/**
 * Composition facts about the shipped profile templates: which templates exist,
 * that each one's bundles compose into layers in the declared order, and that
 * the Control Plane shares no bundle with the member profiles.
 *
 * This does not prove a bundle resolves from the installation's dependency
 * closure. The source-plane runner resolves `@deepseek-ai/*` through tsconfig
 * `paths` regardless of any manifest, so a bundle missing from `apps/cli`'s
 * dependencies still composes here and fails only at a real launch with
 * "cannot resolve profile bundle". Catching that needs the artifact plane.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { prepareProfile } from '../src/profile-boot.ts'

const SHIPPED = Object.keys(PROFILE_TEMPLATES).sort()

let home: string
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env['DSH_HOME']
  home = mkdtempSync(join(tmpdir(), 'dsh-shipped-profiles-'))
  process.env['DSH_HOME'] = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = previousHome
  rmSync(home, { force: true, recursive: true })
})

describe('shipped profiles', () => {
  it('covers every template the launcher can be asked for', () => {
    // Pinned so adding a template without deciding its launch story fails here.
    expect(SHIPPED).toEqual([
      'acp',
      'headless',
      'sdk',
      'sdk-minimal',
      'team',
      'team-control-plane',
      'web',
    ])
  })

  it.each(SHIPPED)('composes %s into the layers its template names', (name) => {
    const profile = prepareProfile(name)
    // Resolution preserves the template: each named bundle became exactly one
    // readable layer, in order. The template order itself is pinned literally
    // by app-boot's profile test; this guards the step that resolves it.
    expect(profile.layers.map(layer => layer.packageName))
      .toEqual([...PROFILE_TEMPLATES[name]?.bundles ?? []])
    for (const layer of profile.layers) {
      expect(layer.patches.length, `${layer.packageName} contributed no patch row`).toBeGreaterThan(0)
    }
  })

  it('gives the Control Plane a tree that shares no bundle with the member profiles', () => {
    const controlPlane = new Set(PROFILE_TEMPLATES['team-control-plane']?.bundles ?? [])
    expect(controlPlane.size).toBeGreaterThan(0)
    for (const [name, template] of Object.entries(PROFILE_TEMPLATES)) {
      if (name === 'team-control-plane') continue
      for (const bundle of template.bundles) {
        // A shared bundle is how local execution would reach the Control Plane:
        // every member profile stacks dsh-base, which mounts the Agent loop,
        // filesystem, subprocess, shell, and sandbox providers.
        expect(controlPlane.has(bundle), `${name} and team-control-plane both stack ${bundle}`).toBe(false)
      }
    }
  })
})
