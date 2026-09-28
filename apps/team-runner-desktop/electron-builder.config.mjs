import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  pluginTreeFingerprint, resolveAppVersion, resolveReleaseKey, resolveUpdateOrigin,
} from './scripts/packaging-inputs.mjs'

const runner = process.env.DSH_TEAM_RUNNER_EXECUTABLE
const controlPlaneUrl = process.env.DSH_TEAM_CONTROL_PLANE_URL
const controlPlaneCa = process.env.DSH_TEAM_CONTROL_PLANE_CA
const pluginTree = process.env.DSH_TEAM_PLUGIN_TREE
const pptTemplate = process.env.DSH_TEAM_PPT_TEMPLATE
const skillDir = process.env.DSH_TEAM_SKILLS
const officeSkills = Object.fromEntries([
  ['ppt', process.env.DSH_TEAM_PPT_SKILL],
  ['word', process.env.DSH_TEAM_WORD_SKILL],
  ['excel', process.env.DSH_TEAM_EXCEL_SKILL],
].filter(([, skill]) => skill !== undefined))
const appIcon = process.env.DSH_TEAM_APP_ICON
const trayIcon = process.env.DSH_TEAM_TRAY_ICON
// Apple Developer Team ID; when set (with APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD
// in the environment), the mac build is notarized. Signing itself needs a
// "Developer ID Application" identity in the login keychain.
const appleTeamId = process.env.DSH_TEAM_APPLE_TEAM_ID
// The release this build is. It decides every update: both the updater's
// comparison and the shipped decision kernel read it, so it is validated here
// rather than discovered when an installed application refuses to upgrade.
const appVersion = resolveAppVersion(process.env)
// The release public key this build checks an offered manifest against. A
// build without one never checks for an update at all: with no trust root,
// there is nothing an installed application may safely replace itself with.
const releaseKey = resolveReleaseKey(process.env)

if (runner === undefined || !existsSync(runner)) {
  throw new Error('DSH_TEAM_RUNNER_EXECUTABLE must name the built Team Runner executable')
}
if (controlPlaneUrl === undefined || !URL.canParse(controlPlaneUrl)) {
  throw new Error('DSH_TEAM_CONTROL_PLANE_URL must be an absolute Control Plane URL')
}
// A deployment behind a private certificate authority is unreachable without
// its signing certificate: the Runner is a Node process and ignores the
// operating-system trust store. A publicly trusted Control Plane omits it.
if (controlPlaneCa !== undefined && !existsSync(controlPlaneCa)) {
  throw new Error('DSH_TEAM_CONTROL_PLANE_CA must name the Control Plane signing certificate')
}
// Out-of-tree plugins carry native addons and copy their own dependencies at
// runtime, neither of which can read a packaged executable's virtual
// filesystem, so they ship as a real directory: an installed profile's
// `node_modules`, staged whole beside the Runner.
if (pluginTree !== undefined && !existsSync(pluginTree)) {
  throw new Error('DSH_TEAM_PLUGIN_TREE must name the installed plugin tree directory')
}
// The Welinkin PowerPoint template the office picker's `welinkin-ppt` kind builds from.
if (pptTemplate !== undefined && !existsSync(pptTemplate)) {
  throw new Error('DSH_TEAM_PPT_TEMPLATE must name the Welinkin PowerPoint template file')
}
// Skills the office kinds start from ship as a directory of skill folders the
// Runner scans; each named office skill must be one of those folders.
if (skillDir !== undefined && !existsSync(skillDir)) {
  throw new Error('DSH_TEAM_SKILLS must name the directory of skill folders to ship')
}
for (const [kind, skill] of Object.entries(officeSkills)) {
  if (skillDir === undefined || !existsSync(join(skillDir, skill, 'SKILL.md'))) {
    throw new Error(`the ${kind} office skill ${skill} must be a skill folder inside DSH_TEAM_SKILLS`)
  }
}
for (const [variable, path] of [['DSH_TEAM_APP_ICON', appIcon], ['DSH_TEAM_TRAY_ICON', trayIcon]]) {
  if (path !== undefined && !existsSync(path)) throw new Error(`${variable} must name an existing image`)
}

const windows = runner.endsWith('.exe')
// Office conversion spawns LibreOffice helpers that cannot run from the
// executable's virtual filesystem. The executable resolves them from the
// `-office` directory beside its own path, so the staged name follows `dsh`.
const officeSidecar = `${windows ? runner.slice(0, -4) : runner}-office`
if (!existsSync(join(officeSidecar, 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'package.json'))) {
  throw new Error(`the Runner executable's Office directory ${officeSidecar} must carry @deepseek-ai/libreoffice-kit`)
}
// A menu bar template image is drawn at the bar's own scale, so macOS reads
// the doubled variant from the same directory under the conventional name.
const trayVariants = trayIcon === undefined
  ? []
  : [trayIcon, trayIcon.replace(/\.png$/u, '@2x.png')].filter(path => existsSync(path))

const extraResources = [
  ...windows
    ? [
        { from: runner, to: 'runner/dsh.exe' },
        { from: runner.slice(0, -4) + '-rg.exe', to: 'runner/dsh-rg.exe' },
      ]
    : [
        { from: runner, to: 'runner/dsh' },
        { from: runner + '-rg', to: 'runner/dsh-rg' },
        { from: runner + '-spawn-helper', to: 'runner/dsh-spawn-helper' },
      ],
  // electron-builder drops a `node_modules` directory nested under `from`, so
  // the Office directory's only entry is staged as the source itself.
  { from: join(officeSidecar, 'node_modules'), to: 'runner/dsh-office/node_modules' },
  ...controlPlaneCa === undefined ? [] : [{ from: controlPlaneCa, to: 'runner/control-plane-ca.crt' }],
  ...pluginTree === undefined ? [] : [{ from: pluginTree, to: 'runner/plugins' }],
  ...pptTemplate === undefined ? [] : [{ from: pptTemplate, to: 'runner/templates/welinkin-ppt.pptx' }],
  ...skillDir === undefined ? [] : [{ from: skillDir, to: 'runner/skills' }],
  ...trayVariants.map(path => ({ from: path, to: `runner/${path.split('/').pop()}` })),
]

export default {
  appId: process.env.DSH_TEAM_APP_ID ?? 'com.deepseek.dsh.runner',
  productName: process.env.DSH_TEAM_PRODUCT_NAME ?? 'DeepSeek Team Runner',
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  asar: true,
  // `dist/types` is tsc output that tsdown already bundled into dist/main.js.
  files: ['dist/**/*', '!dist/types', 'package.json'],
  // `app.getName()` reads `productName` from the packaged manifest, not from
  // the bundle's Info.plist; without it the window and tray show the package name.
  extraMetadata: {
    version: appVersion,
    productName: process.env.DSH_TEAM_PRODUCT_NAME ?? 'DeepSeek Team Runner',
    teamControlPlaneUrl: controlPlaneUrl,
    // Identifies the shipped plugin tree, so an upgrade recopies it only when
    // the plugins actually changed.
    ...pluginTree === undefined ? {} : { teamPluginTreeFingerprint: pluginTreeFingerprint(pluginTree) },
    ...releaseKey === undefined ? {} : { teamReleaseKey: releaseKey },
    ...Object.keys(officeSkills).length === 0 ? {} : { teamOfficeSkills: officeSkills },
  },
  extraResources,
  directories: { output: 'release' },
  mac: {
    // Squirrel.Mac replaces an installed application from a zip; the disk
    // image is the manual download and is never what an update reads.
    target: [{ target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }],
    ...appIcon === undefined ? {} : { icon: appIcon },
    category: 'public.app-category.productivity',
    minimumSystemVersion: '12.0',
    // Applied only when a "Developer ID Application" identity is in the
    // keychain; without one, electron-builder produces the ad-hoc build as
    // before. The hardened runtime and these entitlements are what a notarized
    // Electron app that spawns a native-addon child requires.
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    ...appleTeamId === undefined ? {} : { notarize: { teamId: appleTeamId } },
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    ...appIcon === undefined ? {} : { icon: appIcon },
  },
  nsis: {
    perMachine: false,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    differentialPackage: true,
  },
  // The deployment's own Control Plane serves the release unless a deployment
  // points DSH_TEAM_UPDATE_ORIGIN elsewhere. What may be installed is decided
  // by the signed manifest either way; this only says where the bytes are.
  publish: [{ provider: 'generic', url: resolveUpdateOrigin(process.env, controlPlaneUrl), channel: 'latest' }],
}
