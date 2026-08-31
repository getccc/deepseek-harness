import { existsSync } from 'node:fs'

const runner = process.env.DSH_TEAM_RUNNER_EXECUTABLE
const controlPlaneUrl = process.env.DSH_TEAM_CONTROL_PLANE_URL

if (runner === undefined || !existsSync(runner)) {
  throw new Error('DSH_TEAM_RUNNER_EXECUTABLE must name the built Team Runner executable')
}
if (controlPlaneUrl === undefined || !URL.canParse(controlPlaneUrl)) {
  throw new Error('DSH_TEAM_CONTROL_PLANE_URL must be an absolute Control Plane URL')
}

const windows = runner.endsWith('.exe')
const extraResources = windows
  ? [
      { from: runner, to: 'runner/dsh.exe' },
      { from: runner.slice(0, -4) + '-rg.exe', to: 'runner/dsh-rg.exe' },
    ]
  : [
      { from: runner, to: 'runner/dsh' },
      { from: runner + '-rg', to: 'runner/dsh-rg' },
      { from: runner + '-spawn-helper', to: 'runner/dsh-spawn-helper' },
    ]

export default {
  appId: 'com.deepseek.dsh.runner',
  productName: 'DeepSeek Team Runner',
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  asar: true,
  files: ['dist/**/*', 'package.json'],
  extraMetadata: { teamControlPlaneUrl: controlPlaneUrl },
  extraResources,
  directories: { output: 'release' },
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    category: 'public.app-category.developer-tools',
    minimumSystemVersion: '12.0',
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    perMachine: false,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
}
