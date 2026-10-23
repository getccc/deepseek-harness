import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  machOArchitecture, stripSupportedArchitectures, supportedArchitecturesFor, withSupportedArchitectures, withTargetArchitectures,
} from './build-exe-for-python-sdk-architectures.ts'

const appleSilicon = { platform: 'macos', arch: 'arm64' } as const
const intel = { platform: 'macos', arch: 'x64' } as const
const WORKSPACE = 'packages:\n  - packages/*/*\n'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function workspaceFile(text: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-architectures-'))
  directories.push(directory)
  const file = join(directory, 'pnpm-workspace.yaml')
  await writeFile(file, text)
  return file
}

describe('supportedArchitecturesFor', () => {
  it('leaves a build for the host alone', () => {
    expect(supportedArchitecturesFor([appleSilicon], appleSilicon)).toBeUndefined()
  })

  it('selects the target CPU, not the host CPU, for a cross-architecture build', () => {
    expect(supportedArchitecturesFor([intel], appleSilicon)).toEqual({ os: ['darwin'], cpu: ['x64'] })
  })

  it('selects every target when one deploy serves several', () => {
    expect(supportedArchitecturesFor([appleSilicon, intel], appleSilicon)).toEqual({ os: ['darwin'], cpu: ['arm64', 'x64'] })
  })
})

describe('the temporary workspace block', () => {
  it('is appended with the selected values and removed again byte for byte', () => {
    const changed = withSupportedArchitectures(WORKSPACE, { os: ['darwin'], cpu: ['x64'] })
    expect(changed).toContain('supportedArchitectures:\n  os:\n    - darwin\n  cpu:\n    - x64\n')
    expect(stripSupportedArchitectures(changed)).toBe(WORKSPACE)
  })

  it('refuses to override a declaration the workspace already carries', () => {
    expect(() => withSupportedArchitectures(`${WORKSPACE}supportedArchitectures:\n  cpu:\n    - arm64\n`, { os: ['darwin'], cpu: ['x64'] }))
      .toThrow(/already declares supportedArchitectures/u)
  })
})

describe('withTargetArchitectures', () => {
  it('exposes the block to the step and restores the file afterwards', async () => {
    const file = await workspaceFile(WORKSPACE)
    let during = ''
    await withTargetArchitectures(file, { os: ['darwin'], cpu: ['x64'] }, async () => { during = await readFile(file, 'utf8') })
    expect(during).toContain('    - x64')
    expect(await readFile(file, 'utf8')).toBe(WORKSPACE)
  })

  it('restores the file when the step fails', async () => {
    const file = await workspaceFile(WORKSPACE)
    await expect(withTargetArchitectures(file, { os: ['darwin'], cpu: ['x64'] }, () => Promise.reject(new Error('deploy failed'))))
      .rejects.toThrow('deploy failed')
    expect(await readFile(file, 'utf8')).toBe(WORKSPACE)
  })

  it('cleans a block an interrupted run left behind', async () => {
    const stale = withSupportedArchitectures(WORKSPACE, { os: ['linux'], cpu: ['arm64'] })
    const file = await workspaceFile(stale)
    await withTargetArchitectures(file, { os: ['darwin'], cpu: ['x64'] }, async () => undefined)
    expect(await readFile(file, 'utf8')).toBe(WORKSPACE)
  })

  it('does not touch the file when no cross-architecture selection is needed', async () => {
    const file = await workspaceFile(WORKSPACE)
    let during = ''
    await withTargetArchitectures(file, undefined, async () => { during = await readFile(file, 'utf8') })
    expect(during).toBe(WORKSPACE)
  })
})

describe('machOArchitecture', () => {
  const header = (magic: number, cpu: number): Uint8Array => {
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, magic, true)
    view.setUint32(4, cpu, true)
    return bytes
  }

  it('names the CPU of a 64-bit Mach-O file', () => {
    expect(machOArchitecture(header(0xfeedfacf, 0x01000007))).toBe('x64')
    expect(machOArchitecture(header(0xfeedfacf, 0x0100000c))).toBe('arm64')
  })

  it('rejects other files and CPUs', () => {
    expect(machOArchitecture(header(0x464c457f, 0x01000007))).toBeUndefined()
    expect(machOArchitecture(header(0xfeedfacf, 0x00000012))).toBeUndefined()
    expect(machOArchitecture(new Uint8Array(4))).toBeUndefined()
  })
})
