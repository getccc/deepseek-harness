/**
 * Install the platform packages of the executable's target CPU when it differs from the build host.
 *
 * `pnpm deploy` installs only the host's optional platform packages (ripgrep, the system addon,
 * koffi, sharp), and reads `supportedArchitectures` from `pnpm-workspace.yaml` alone: neither a
 * command-line `--config.*` setting, an environment variable, nor the global config file selects them.
 * The deploy therefore runs with a marked block appended to that file, which is removed afterwards.
 */
import { readFile, writeFile } from 'node:fs/promises'

/** A pkg target as far as dependency selection is concerned. */
export interface DeployTarget {
  readonly platform: 'linux' | 'macos' | 'win'
  readonly arch: 'x64' | 'arm64'
}

/** The `os` and `cpu` values pnpm matches optional dependencies against. */
export interface SupportedArchitectures {
  readonly os: readonly string[]
  readonly cpu: readonly string[]
}

const BEGIN = '# BEGIN build-exe-for-python-sdk temporary supportedArchitectures'
const END = '# END build-exe-for-python-sdk temporary supportedArchitectures'
const BLOCK = new RegExp(`\\n?${BEGIN}[\\s\\S]*?${END}\\n?`, 'u')

const NODE_OS = { linux: 'linux', macos: 'darwin', win: 'win32' } as const

/**
 * Decide which platform packages a deploy for these targets must install.
 * @param targets - the pkg targets one deploy serves.
 * @param host - the target the build host runs, which a plain deploy already installs for.
 * @returns the `os`/`cpu` values to install, or undefined when every target is the host's own.
 */
export function supportedArchitecturesFor(
  targets: readonly DeployTarget[],
  host: DeployTarget,
): SupportedArchitectures | undefined {
  if (targets.every(target => target.platform === host.platform && target.arch === host.arch)) return undefined
  return {
    os: [...new Set(targets.map(target => NODE_OS[target.platform]))],
    cpu: [...new Set(targets.map(target => target.arch))],
  }
}

/**
 * Remove the block an earlier, interrupted run left behind.
 * @param workspace - the text of `pnpm-workspace.yaml`.
 * @returns the text without the temporary block.
 */
export function stripSupportedArchitectures(workspace: string): string {
  return workspace.replace(BLOCK, '')
}

/**
 * Append the temporary `supportedArchitectures` block.
 * @param workspace - the text of `pnpm-workspace.yaml` without a block from an earlier run.
 * @param architectures - the values to install platform packages for.
 * @returns the text with the block appended.
 * @throws when the file already declares `supportedArchitectures`, which this must not override.
 */
export function withSupportedArchitectures(workspace: string, architectures: SupportedArchitectures): string {
  if (/^supportedArchitectures\s*:/mu.test(workspace)) {
    throw new Error(
      'build-exe-for-python-sdk: pnpm-workspace.yaml already declares supportedArchitectures; '
      + 'a cross-architecture build would override it.',
    )
  }
  const lines = [
    BEGIN,
    'supportedArchitectures:',
    '  os:',
    ...architectures.os.map(value => `    - ${value}`),
    '  cpu:',
    ...architectures.cpu.map(value => `    - ${value}`),
    END,
  ]
  return `${workspace.replace(/\n*$/u, '\n')}\n${lines.join('\n')}\n`
}

/**
 * Run a step with the temporary block in the workspace file, restoring the file afterwards.
 * @param file - the path of `pnpm-workspace.yaml`.
 * @param architectures - the values to install platform packages for, or undefined to leave the file alone.
 * @param step - the work that reads the file, normally `pnpm deploy`.
 * @returns when the step has finished and the file is restored, including when it failed.
 */
export async function withTargetArchitectures(
  file: string,
  architectures: SupportedArchitectures | undefined,
  step: () => Promise<void>,
): Promise<void> {
  if (architectures === undefined) {
    await step()
    return
  }
  const original = stripSupportedArchitectures(await readFile(file, 'utf8'))
  await writeFile(file, withSupportedArchitectures(original, architectures))
  try {
    await step()
  } finally {
    await writeFile(file, original)
  }
}
