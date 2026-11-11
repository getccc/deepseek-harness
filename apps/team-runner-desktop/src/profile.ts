/**
 * The Team profile this desktop build composes in its private Harness home.
 *
 * The bundled Runner executable carries the in-box bundles, and the installer
 * ships the out-of-tree plugins as a real directory tree beside it, because
 * their native addons and their own dependency copying cannot read a packaged
 * executable's virtual filesystem. The shell initializes the profile once;
 * subsequent launches preserve the member's bundle selection and dependencies.
 * @module
 */
import { createHash } from 'node:crypto'
import {
  constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync,
  renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/** Bundle layers the Runner executable resolves from its own installation. */
export const RUNNER_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-team',
] as const

/**
 * Bundle layers the installer ships as a plugin tree, in mount order: the
 * univer office tools the office picker's Word, Excel, and PowerPoint kinds
 * build with, and the ECharts renderer its visualization kind answers into.
 */
export const SHIPPED_PLUGIN_BUNDLES = ['dsh-univer-office', '@dsh-external/dsh-echarts'] as const

/**
 * Render the initial Team profile manifest.
 * @param shippedPlugins - whether the installer carried the plugin tree.
 * @returns a `package.json` document for the private Team profile directory.
 */
export function profileManifest(shippedPlugins: boolean): string {
  return `${JSON.stringify({
    name: 'dsh-profile-team',
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: [...RUNNER_BUNDLES, ...shippedPlugins ? SHIPPED_PLUGIN_BUNDLES : []],
      },
    },
  }, null, 2)}\n`
}

/** Application-owned plugins prepared outside the member's package-manager directory. */
export interface ShippedPlugins {
  /** Absolute path of the complete shipped node_modules tree. */
  readonly directory: string
  /** Packaging fingerprint identifying this tree's contents. */
  readonly fingerprint: string
}

/** Read package-manager ownership before replacing application-provided links. */
function managedPackages(manifestPath: string): Set<string> {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Invalid Team profile manifest: ${manifestPath}`)
  }
  const names = new Set<string>()
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (!(key in manifest)) continue
    const dependencies: unknown = Reflect.get(manifest, key)
    if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)
      || Object.values(dependencies).some(value => typeof value !== 'string')) {
      throw new Error(`Invalid Team profile ${key}: ${manifestPath}`)
    }
    for (const name of Object.keys(dependencies)) names.add(name)
  }
  return names
}

/** Whether an existing link belongs to the shell's private plugin cache. */
function ownedLink(path: string, cache: string): boolean {
  return lstatSync(path).isSymbolicLink()
    && resolve(dirname(path), readlinkSync(path)).startsWith(cache + sep)
}

/**
 * Initialize missing profile data and project shipped plugins without replacing installed packages.
 * Call only while this shell's Runner is stopped. Existing manifests and user patches are unchanged.
 * Complete generations are published by rename; a failed link replacement stops startup and is retried
 * on the next launch. Only undeclared, application-owned package entries can be replaced.
 * @param home - Private Harness home of this desktop installation.
 * @param plugins - Shipped plugins, or undefined when this build carries none.
 */
export function provisionProfile(home: string, plugins: ShippedPlugins | undefined): void {
  const profile = join(home, 'profiles', 'team')
  mkdirSync(profile, { recursive: true })
  const manifest = join(profile, 'package.json')
  if (!existsSync(manifest)) writeFileSync(manifest, profileManifest(plugins !== undefined), { flag: 'wx' })
  const managed = managedPackages(manifest)
  if (plugins === undefined) return
  for (const name of SHIPPED_PLUGIN_BUNDLES) {
    if (!existsSync(join(plugins.directory, name, 'package.json'))) {
      throw new Error(`The shipped plugin tree omits ${name}; rebuild the Team desktop installer`)
    }
  }
  const cache = join(home, 'desktop-plugins')
  mkdirSync(cache, { recursive: true })
  const generation = createHash('sha256').update(plugins.fingerprint).update('\0').update(plugins.directory).digest('hex')
  const destination = join(cache, generation)
  if (!existsSync(destination)) {
    const staging = mkdtempSync(join(cache, '.staging-'))
    try {
      cpSync(plugins.directory, join(staging, 'node_modules'), {
        recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
      })
      renameSync(staging, destination)
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }
  const legacy = existsSync(join(profile, '.dsh-plugin-tree'))
  for (const name of SHIPPED_PLUGIN_BUNDLES) {
    if (managed.has(name)) continue
    const path = join(profile, 'node_modules', name)
    const present = lstatSync(path, { throwIfNoEntry: false }) !== undefined
    if (present && !legacy && !ownedLink(path, cache)) continue
    const target = join(destination, 'node_modules', name)
    if (present && ownedLink(path, cache) && resolve(dirname(path), readlinkSync(path)) === target) continue
    mkdirSync(dirname(path), { recursive: true })
    const temporary = mkdtempSync(join(dirname(path), '.dsh-link-'))
    try {
      const link = join(temporary, 'plugin')
      symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
      rmSync(path, { recursive: true, force: true })
      renameSync(link, path)
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  }
  rmSync(join(profile, '.dsh-plugin-tree'), { force: true })
}
