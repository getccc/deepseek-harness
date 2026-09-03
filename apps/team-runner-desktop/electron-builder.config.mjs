import { existsSync } from 'node:fs'

const runner = process.env.DSH_TEAM_RUNNER_EXECUTABLE
const controlPlaneUrl = process.env.DSH_TEAM_CONTROL_PLANE_URL
const controlPlaneCa = process.env.DSH_TEAM_CONTROL_PLANE_CA
const pluginTree = process.env.DSH_TEAM_PLUGIN_TREE
const pptTemplate = process.env.DSH_TEAM_PPT_TEMPLATE
const appIcon = process.env.DSH_TEAM_APP_ICON
const trayIcon = process.env.DSH_TEAM_TRAY_ICON
// Apple Developer Team ID; when set (with APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD
// in the environment), the mac build is notarized. Signing itself needs a
// "Developer ID Application" identity in the login keychain.
const appleTeamId = process.env.DSH_TEAM_APPLE_TEAM_ID

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
// The AMEC PowerPoint template the office picker's `amec-ppt` kind builds from.
if (pptTemplate !== undefined && !existsSync(pptTemplate)) {
  throw new Error('DSH_TEAM_PPT_TEMPLATE must name the AMEC PowerPoint template file')
}
for (const [variable, path] of [['DSH_TEAM_APP_ICON', appIcon], ['DSH_TEAM_TRAY_ICON', trayIcon]]) {
  if (path !== undefined && !existsSync(path)) throw new Error(`${variable} must name an existing image`)
}

const windows = runner.endsWith('.exe')
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
  ...controlPlaneCa === undefined ? [] : [{ from: controlPlaneCa, to: 'runner/control-plane-ca.crt' }],
  ...pluginTree === undefined ? [] : [{ from: pluginTree, to: 'runner/plugins' }],
  ...pptTemplate === undefined ? [] : [{ from: pptTemplate, to: 'runner/templates/amec-ppt.pptx' }],
  ...trayVariants.map(path => ({ from: path, to: `runner/${path.split('/').pop()}` })),
]

export default {
  appId: process.env.DSH_TEAM_APP_ID ?? 'com.deepseek.dsh.runner',
  productName: process.env.DSH_TEAM_PRODUCT_NAME ?? 'DeepSeek Team Runner',
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  asar: true,
  files: ['dist/**/*', 'package.json'],
  // `app.getName()` reads `productName` from the packaged manifest, not from
  // the bundle's Info.plist; without it the window and tray show the package name.
  extraMetadata: {
    productName: process.env.DSH_TEAM_PRODUCT_NAME ?? 'DeepSeek Team Runner',
    teamControlPlaneUrl: controlPlaneUrl,
  },
  extraResources,
  directories: { output: 'release' },
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
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
  },
}
