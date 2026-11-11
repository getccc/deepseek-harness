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

/** Optional company directory carried by an enterprise plugin tree. */
const COMPANY_PLUGIN_BUNDLE = '@wework/company-plugins'

/**
 * Render the initial Team profile manifest.
 * @param shippedPlugins - whether the installer carried the plugin tree.
 * @param companyPlugins - whether that tree carries the company plugin directory.
 * @returns a `package.json` document for the private Team profile directory.
 */
export function profileManifest(shippedPlugins: boolean, companyPlugins = false): string {
  return `${JSON.stringify({
    name: 'dsh-profile-team',
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: [...RUNNER_BUNDLES, ...shippedPlugins ? SHIPPED_PLUGIN_BUNDLES : [],
          ...shippedPlugins && companyPlugins ? [COMPANY_PLUGIN_BUNDLE] : []],
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

/** Whether a parsed JSON value contains named fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Select a newly carried company directory without replacing other profile settings. */
function selectCompanyDirectory(manifestPath: string): void {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!isRecord(manifest)) throw new Error(`Invalid Team profile manifest: ${manifestPath}`)
  const dsh = manifest.dsh ?? {}
  if (!isRecord(dsh)) throw new Error(`Invalid Team profile dsh: ${manifestPath}`)
  const profile = dsh.profile ?? {}
  if (!isRecord(profile)) throw new Error(`Invalid Team profile dsh.profile: ${manifestPath}`)
  const bundles = profile.bundles ?? []
  if (!Array.isArray(bundles) || bundles.some(value => typeof value !== 'string')) {
    throw new Error(`Invalid Team profile bundles: ${manifestPath}`)
  }
  if (bundles.includes(COMPANY_PLUGIN_BUNDLE)) return
  const staging = mkdtempSync(join(dirname(manifestPath), '.company-directory-'))
  try {
    const path = join(staging, 'package.json')
    writeFileSync(path, `${JSON.stringify({ ...manifest, dsh: { ...dsh,
      profile: { ...profile, bundles: [...bundles, COMPANY_PLUGIN_BUNDLE] },
    } }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    renameSync(path, manifestPath)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * Initialize missing profile data and project shipped plugins without replacing installed packages.
 * Call only while this shell's Runner is stopped. A newly carried company directory is selected once;
 * subsequent launches preserve its selection. Other bundles, dependencies, and user patches are retained.
 * Complete generations are published by rename; a failed link replacement stops startup and is retried
 * on the next launch. Only undeclared, application-owned package entries can be replaced.
 * @param home - Private Harness home of this desktop installation.
 * @param plugins - Shipped plugins, or undefined when this build carries none.
 */
export function provisionProfile(home: string, plugins: ShippedPlugins | undefined): void {
  const profile = join(home, 'profiles', 'team')
  mkdirSync(profile, { recursive: true })
  const manifest = join(profile, 'package.json')
  const companyPlugins = plugins !== undefined && existsSync(join(plugins.directory, COMPANY_PLUGIN_BUNDLE, 'package.json'))
  if (!existsSync(manifest)) writeFileSync(manifest, profileManifest(plugins !== undefined, companyPlugins), { flag: 'wx' })
  const managed = managedPackages(manifest)
  if (plugins === undefined) return
  const projectedBundles = [...SHIPPED_PLUGIN_BUNDLES, ...companyPlugins ? [COMPANY_PLUGIN_BUNDLE] : []]
  for (const name of projectedBundles) {
    if (!existsSync(join(plugins.directory, name, 'package.json'))) {
      throw new Error(`The shipped plugin tree omits ${name}; rebuild the Team desktop installer`)
    }
  }
  if (companyPlugins && !managed.has(COMPANY_PLUGIN_BUNDLE)
    && lstatSync(join(profile, 'node_modules', COMPANY_PLUGIN_BUNDLE), { throwIfNoEntry: false }) === undefined) {
    selectCompanyDirectory(manifest)
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
  for (const name of projectedBundles) {
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
