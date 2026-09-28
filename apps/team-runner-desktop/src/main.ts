/** Electron lifecycle for the local Team Runner. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  appendFileSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  session,
  shell,
  Tray,
} from 'electron'
import {
  CERTIFICATE_VERDICT, pinnedCertificateVerdict, pinnedHost, type CertificateVerdict,
} from './control-plane-certificate.ts'
import { acceptRelease, readManifest, verifyDownload, type ReleaseGate } from './release-gate.ts'
import { deploymentPatch, resolveDeployment, type LoginLocale, type OfficeSkills } from './deployment.ts'
import { profileManifest } from './profile.ts'
import { runnerReady } from './readiness.ts'
import { TeamUpdateCoordinator } from './update-coordinator.ts'
import { UPDATE_IPC, type TeamUpdateState } from './update-state.ts'

const RUNNER_URL = 'http://127.0.0.1:3090/team/open'
const RESTART_DELAY_MS = 10_000
/** Poll cadence and budget for the Runner's first answer: five minutes. */
const CONNECT_INTERVAL_MS = 500
const CONNECT_ATTEMPTS = 600
/** One probe may not outlive the poll cadence by much, or a hung socket stalls the loop. */
const PROBE_TIMEOUT_MS = 2_000
/** How long a previous instance's Runner gets to leave the port after SIGTERM. */
const STALE_RUNNER_EXIT_MS = 3_000
/** Resource subdirectory holding the Runner executable and everything it reads. */
const RUNNER_RESOURCES = 'runner'
/** The Control Plane's signing certificate, staged by the packaging configuration. */
const CONTROL_PLANE_CA = 'control-plane-ca.crt'
/** The out-of-tree plugin tree linked into the private profile's node_modules. */
const PLUGIN_TREE = 'plugins'
/** The PowerPoint template the office picker's `ppt` kind builds from. */
const PPT_TEMPLATE = 'templates/welinkin-ppt.pptx'
/** The skill directory the office kinds' skills load from. */
const SKILL_DIR = 'skills'
/** Records which plugin tree the profile's `node_modules` was materialized from. */
const PLUGIN_TREE_STAMP = '.dsh-plugin-tree'
/** The deployment's menu bar mark, drawn in the bar's own colour. */
const TRAY_ICON = 'trayTemplate.png'
/** The live Runner's process id, so the next launch can retire a survivor. */
const RUNNER_PID_FILE = 'runner.pid'
/** Timestamped shell events, beside the Runner's own log. */
const SHELL_LOG = 'shell.log'
/** Update metadata electron-builder writes when the build carries a release stream. */
const UPDATE_CONFIG = 'app-update.yml'
/**
 * Where the shell reads the release manifest: the Runner beside it, which
 * holds the device credential this shell does not. The Runner asks the
 * Control Plane with it and hands the signed document back unchanged, so the
 * release key's signature is still what this shell decides on.
 */
const MANIFEST_URL = 'http://127.0.0.1:3090/team/update/manifest'
/**
 * The session partition `electron-updater` requests through.
 *
 * It does not use the default session, so a certificate rule set only there
 * never reaches a check or a download. The name is that package's own
 * constant, which it does not export.
 */
const UPDATER_SESSION = 'electron-updater'
/** How long after launch the first update check runs; startup owns the first minute. */
const FIRST_UPDATE_CHECK_MS = 60_000
/** Cadence of later update checks. */
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
/** Spread added to every check, so a deployment's members do not all ask at once. */
const UPDATE_CHECK_JITTER_MS = 30 * 60 * 1000
/** How long the Runner gets to exit before an installer replaces its files. */
const RUNNER_STOP_MS = 10_000

const copy = {
  zh: {
    show: (name: string): string => `打开 ${name}`,
    quit: '退出',
    starting: (name: string): string => `正在启动 ${name}…`,
    failedTitle: 'Runner 无法启动',
    failedBody: '请联系管理员并提供 Runner 日志。',
  },
  en: {
    show: (name: string): string => `Open ${name}`,
    quit: 'Quit',
    starting: (name: string): string => `Starting ${name}…`,
    failedTitle: 'Runner could not start',
    failedBody: 'Contact your administrator and provide the Runner log.',
  },
} as const

let window: BrowserWindow | undefined
let tray: Tray | undefined
let runner: ChildProcess | undefined
let restart: NodeJS.Timeout | undefined
let quitting = false
let updates: TeamUpdateCoordinator | undefined
let updateState: TeamUpdateState = { phase: 'idle' }

/** The per-user directory holding the Runner's home, logs, and deployment patch. */
function runnerData(): string {
  return join(app.getPath('userData'), 'runner')
}

/** Append one timestamped line to the shell log; support tooling collects it with the Runner log. */
function log(line: string): void {
  try {
    appendFileSync(join(runnerData(), SHELL_LOG), `${new Date().toISOString()} ${line}\n`, { mode: 0o600 })
  } catch {
    // The log is diagnostic only; a full or read-only disk must not stop the launch.
  }
}

function language(): typeof copy.zh | typeof copy.en {
  return app.getLocale().toLowerCase().startsWith('zh') ? copy.zh : copy.en
}

/** Show one localized startup failure without exposing deployment secrets. */
function reportRunnerFailure(error?: unknown): void {
  const detail = error instanceof Error
    ? error.message
    : typeof error === 'string' ? error : undefined
  log(`runner failure: ${detail ?? 'unknown'}`)
  void dialog.showMessageBox({
    type: 'error',
    title: language().failedTitle,
    message: language().failedBody,
    ...(detail === undefined ? {} : { detail }),
  })
}

/** Queue one restart after an unexpected exit or failed launch. */
function scheduleRunnerRestart(): void {
  if (quitting || restart !== undefined) return
  restart = setTimeout(() => {
    restart = undefined
    launchRunner()
  }, RESTART_DELAY_MS)
}

/** Read enterprise metadata added by the packaging configuration. */
function packagedControlPlaneUrl(): string {
  const manifest = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as {
    teamControlPlaneUrl?: unknown
  }
  if (typeof manifest.teamControlPlaneUrl !== 'string') {
    throw new Error('this desktop build has no Team Control Plane address')
  }
  return manifest.teamControlPlaneUrl
}

/**
 * The office skill names this build records, read from packaged metadata or,
 * in a development launch, from the packaging environment variables.
 * @returns the skill each office kind starts from; kinds without one are absent.
 */
function officeSkills(): OfficeSkills {
  if (!app.isPackaged) {
    const development = {
      ppt: process.env['DSH_TEAM_PPT_SKILL'],
      word: process.env['DSH_TEAM_WORD_SKILL'],
      excel: process.env['DSH_TEAM_EXCEL_SKILL'],
    }
    return Object.fromEntries(Object.entries(development).filter(([, skill]) => skill !== undefined))
  }
  const manifest = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as {
    teamOfficeSkills?: OfficeSkills
  }
  return manifest.teamOfficeSkills ?? {}
}

/**
 * What identifies the shipped plugin tree in the profile's stamp. A packaged
 * build carries the fingerprint the packaging step computed from the tree's
 * contents, so an upgrade that ships the same plugins keeps the copy it
 * already materialized — on Windows that is 959 MB of real copying at first
 * launch. A build without one, such as a development launch, falls back to
 * the application version and recopies once per upgrade.
 * @returns the generation token recorded beside the materialized tree.
 */
function pluginTreeGeneration(): string {
  if (!app.isPackaged) return app.getVersion()
  const manifest = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as {
    teamPluginTreeFingerprint?: unknown
  }
  return typeof manifest.teamPluginTreeFingerprint === 'string'
    ? manifest.teamPluginTreeFingerprint
    : app.getVersion()
}

/** Executable bundled beside Electron, or an explicit development Runner. */
function runnerExecutable(): string {
  const development = process.env['DSH_TEAM_RUNNER_EXECUTABLE']
  if (!app.isPackaged && development !== undefined) return development
  return join(process.resourcesPath, RUNNER_RESOURCES, process.platform === 'win32' ? 'dsh.exe' : 'dsh')
}

/**
 * Locate one file the packaging configuration staged beside the Runner. A
 * development launch reads the same name from the build environment, so both
 * launches exercise the packaged layout.
 * @param name - the staged resource's name under the Runner resource directory.
 * @param developmentVariable - the environment variable an unpackaged launch reads.
 * @returns the absolute path, or `undefined` when this build did not carry it.
 */
function stagedResource(name: string, developmentVariable: string): string | undefined {
  const path = app.isPackaged
    ? join(process.resourcesPath, RUNNER_RESOURCES, name)
    : process.env[developmentVariable]
  return path !== undefined && existsSync(path) ? path : undefined
}

/** The login locale this computer's operating-system language selects. */
function loginLocale(): LoginLocale {
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

/**
 * Materialize the shipped plugin tree as the profile's own `node_modules`.
 *
 * The packages have to be real files in that directory rather than links into
 * application resources, for two reasons that both come from how Node resolves.
 * A plugin reaches its dependencies through its own real location, so a linked
 * package would look for them inside the read-only resource directory instead
 * of beside itself; and `dsh` adds links there for the packages these plugins
 * take as peers from the Runner installation, which needs the directory
 * writable. macOS clones the tree on a copy-on-write volume, so the duplicate
 * costs neither the time nor the disk space its size suggests.
 * @param source - the shipped tree staged in application resources.
 * @param target - the private profile's `node_modules` directory.
 */
function materializePluginTree(source: string, target: string): void {
  rmSync(target, { recursive: true, force: true })
  const cloned = process.platform === 'darwin'
    && spawnSync('/bin/cp', ['-Rc', source, target]).status === 0
  if (!cloned) cpSync(source, target, { recursive: true, verbatimSymlinks: true })
}

/**
 * Write the deployment's own Team profile into the private Harness home. The
 * manifest is rewritten on every launch so an application upgrade that changes
 * the layer list takes effect; the member's `cordis.patch.yml` is never touched.
 * The plugin tree is materialized once per shipped tree, because a member
 * cannot change it and `dsh` heals its own links there on every boot.
 * @param home - the private `DSH_HOME` given to the Runner.
 */
function provisionProfile(home: string): void {
  const dir = join(home, 'profiles', 'team')
  mkdirSync(dir, { recursive: true })
  const plugins = stagedResource(PLUGIN_TREE, 'DSH_TEAM_PLUGIN_TREE')
  writeFileSync(join(dir, 'package.json'), profileManifest(plugins !== undefined))
  if (plugins === undefined) return
  const stamp = join(dir, PLUGIN_TREE_STAMP)
  const generation = `${pluginTreeGeneration()} ${plugins}\n`
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === generation) return
  log('materializing plugin tree')
  materializePluginTree(plugins, join(dir, 'node_modules'))
  writeFileSync(stamp, generation)
}

/**
 * Retire a Runner left by a previous instance of this application. Its port
 * is fixed, so a survivor — the application was replaced while running, or
 * force-quit — makes the new Runner fail to bind and restart every ten
 * seconds until the survivor exits. The recorded process id is trusted only
 * when that process still runs this build's own executable, so a reused id
 * belonging to something else is never signalled.
 * @param executable - the Runner executable this launch will start.
 */
function retireStaleRunner(executable: string): void {
  const pidFile = join(runnerData(), RUNNER_PID_FILE)
  if (!existsSync(pidFile) || process.platform === 'win32') return
  const pid = Number.parseInt(readFileSync(pidFile, 'utf8'), 10)
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return
  const listed = spawnSync('/bin/ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' })
  if (listed.status !== 0 || !listed.stdout.startsWith(executable)) return
  log(`retiring stale runner pid ${String(pid)}`)
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // The process ended between the listing and the signal; nothing holds the port.
    return
  }
  const deadline = Date.now() + STALE_RUNNER_EXIT_MS
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    spawnSync('/bin/sleep', ['0.1'])
  }
}

/** Start the Runner and restart unexpected exits while the desktop app lives. */
function startRunner(): void {
  const data = runnerData()
  mkdirSync(data, { recursive: true })
  const patchPath = join(data, 'team-deployment.patch.yml')
  const certificateAuthority = stagedResource(CONTROL_PLANE_CA, 'DSH_TEAM_CONTROL_PLANE_CA')
  const pptTemplate = stagedResource(PPT_TEMPLATE, 'DSH_TEAM_PPT_TEMPLATE')
  const skillDir = stagedResource(SKILL_DIR, 'DSH_TEAM_SKILLS')
  const skills = officeSkills()
  const deployment = resolveDeployment({
    controlPlaneUrl: app.isPackaged
      ? packagedControlPlaneUrl()
      : process.env['DSH_TEAM_CONTROL_PLANE_URL'] ?? '',
    ...certificateAuthority === undefined ? {} : { controlPlaneCa: certificateAuthority },
    runnerVersion: app.getVersion(),
    callbackUrl: 'http://127.0.0.1:3090/team/callback',
    locale: loginLocale(),
    ...pptTemplate === undefined ? {} : { welinkinTemplatePath: pptTemplate },
    ...skillDir === undefined ? {} : { skillDir },
    ...Object.keys(skills).length === 0 ? {} : { officeSkills: skills },
  })
  writeFileSync(patchPath, deploymentPatch(deployment), { encoding: 'utf8', mode: 0o600 })
  const home = join(data, 'home')
  provisionProfile(home)
  const executable = runnerExecutable()
  retireStaleRunner(executable)
  const logFd = openSync(join(data, 'runner.log'), 'a', 0o600)
  runner = spawn(executable, ['--profile', 'team', '--patch', patchPath, '--no-open'], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  })
  closeSync(logFd)
  if (runner.pid !== undefined) writeFileSync(join(data, RUNNER_PID_FILE), `${String(runner.pid)}\n`, { mode: 0o600 })
  log(`runner spawned pid ${String(runner.pid)}`)
  runner.once('exit', (code, signal) => {
    log(`runner exited code=${String(code)} signal=${String(signal)}`)
    runner = undefined
    scheduleRunnerRestart()
  })
  runner.once('error', (error) => {
    reportRunnerFailure(error)
  })
}

/**
 * Stop the Runner and wait for it to leave, so its port is free and the files
 * an installer replaces are closed. A Runner that ignores the signal is killed
 * outright at the deadline; the shell is about to be replaced either way.
 * @returns when the Runner has exited, or when the deadline passed.
 */
async function stopRunner(): Promise<void> {
  quitting = true
  if (restart !== undefined) {
    clearTimeout(restart)
    restart = undefined
  }
  const child = runner
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
  log('stopping runner before replacement')
  const exited = new Promise<boolean>((resolve) => { child.once('exit', () => { resolve(false) }) })
  const deadline = new Promise<boolean>((resolve) => { setTimeout(() => { resolve(true) }, RUNNER_STOP_MS).unref() })
  child.kill()
  if (await Promise.race([exited, deadline])) {
    log('runner outlived its stop deadline; killing')
    child.kill('SIGKILL')
  }
}

/**
 * Trust the deployment's own authority for the Control Plane host alone.
 * Electron's network stack, which the updater requests through, reads the
 * operating system's trust store and would otherwise reject a privately
 * signed Control Plane; every other host keeps Chromium's own verdict.
 * @param controlPlaneUrl - the deployment's Control Plane origin.
 */
function pinControlPlaneAuthority(controlPlaneUrl: string): void {
  const authority = stagedResource(CONTROL_PLANE_CA, 'DSH_TEAM_CONTROL_PLANE_CA')
  if (authority === undefined) return
  const host = pinnedHost(new URL(controlPlaneUrl).hostname)
  const authorities = new Map([[host, readFileSync(authority, 'utf8')]])
  // One line per host, not per request: support needs to tell "the pin was
  // never consulted" from "the pin refused this certificate", and an update
  // check makes several requests to the same host.
  const reported = new Set<string>()
  const pin = (target: Electron.Session, label: string): void => {
    target.setCertificateVerifyProc((request, callback) => {
      let verdict: CertificateVerdict = CERTIFICATE_VERDICT.chromium
      try {
        verdict = pinnedCertificateVerdict(request, authorities)
      } catch (error) {
        log(`certificate verification failed for ${request.hostname}: ${String(error)}`)
      }
      const seen = `${label} ${request.hostname}`
      if (!reported.has(seen)) {
        reported.add(seen)
        log(`certificate ${seen} verdict ${String(verdict)}`)
      }
      callback(verdict)
    })
  }
  pin(session.defaultSession, 'default')
  pin(session.fromPartition(UPDATER_SESSION, { cache: false }), UPDATER_SESSION)
  log(`pinned the deployment authority for ${host}`)
}

/**
 * The release public key this build checks an offered manifest against, or
 * undefined when it carries none.
 * @returns the packaged key, or undefined in a development launch or an
 * unsigned deployment.
 */
function packagedReleaseKey(): string | undefined {
  if (!app.isPackaged) return process.env['DSH_TEAM_RELEASE_KEY']
  const manifest = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as {
    teamReleaseKey?: unknown
  }
  return typeof manifest.teamReleaseKey === 'string' ? manifest.teamReleaseKey : undefined
}

/**
 * The signed-manifest decision for this computer, or undefined when this build
 * carries no release key and therefore never offers an update.
 *
 * The manifest comes from the Runner; the artifact it describes is fetched
 * from the Control Plane directly, which is why the deployment authority is
 * still pinned for that host.
 * @returns the gate, or undefined when this build has no trust root for an update.
 */
function releaseGate(): ReleaseGate | undefined {
  const releaseKey = packagedReleaseKey()
  if (releaseKey === undefined) return undefined
  const target = {
    releaseKey,
    installedVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
  }
  return {
    accept: async offered => acceptRelease(offered, target, async () => readManifest(MANIFEST_URL, url => net.fetch(url))),
    verify: verifyDownload,
  }
}

/**
 * Publish one update state to the window and retain it, so a page that asks
 * before subscribing is answered with the state the shell is actually in.
 * @param state - the state the coordinator reached.
 * @returns the same state.
 */
function publishUpdateState(state: TeamUpdateState): TeamUpdateState {
  // Phase changes only: a download publishes a state per percent, and support
  // reads this log to tell "never checked" from "checked and refused".
  if (state.phase !== updateState.phase || state.version !== updateState.version) {
    const version = state.version === undefined ? '' : ` ${state.version}`
    const message = state.message === undefined ? '' : `: ${state.message}`
    log(`update ${state.phase}${version}${message}`)
  }
  updateState = state
  window?.webContents.send(UPDATE_IPC.state, state)
  return state
}

/** Ask the release stream once after startup, then on a jittered cadence. */
function scheduleUpdateChecks(): void {
  const later = (delay: number): void => {
    setTimeout(() => {
      void updates?.check()
      later(UPDATE_CHECK_INTERVAL_MS)
    }, delay + Math.random() * UPDATE_CHECK_JITTER_MS).unref()
  }
  later(FIRST_UPDATE_CHECK_MS)
}

/** Launch the Runner and keep the resident shell alive when startup fails. */
function launchRunner(): void {
  try {
    startRunner()
  } catch (error) {
    reportRunnerFailure(error)
    scheduleRunnerRestart()
  }
}

/** The one in-flight attempt to put the Runner's page into the window. */
let connecting: Promise<void> | undefined

/**
 * Show the local web surface when it becomes reachable. One attempt runs at a
 * time; a second request while it polls only re-shows the window. The first
 * launch materializes the plugin tree and the Runner heals a few hundred
 * module links before it listens, and a Runner that lost its port to an
 * earlier instance restarts every ten seconds, so the wait is minutes, not
 * the half minute a warm start needs. A navigation that fails after the poll
 * succeeded — the Runner exited between the two — goes back to polling
 * instead of leaving an empty window behind.
 */
function showRunner(): Promise<void> {
  if (window === undefined) return Promise.resolve()
  window.show()
  connecting ??= connectWindow().finally(() => { connecting = undefined })
  return connecting
}

async function connectWindow(): Promise<void> {
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
    if (window === undefined || quitting) return
    try {
      const response = await fetch(RUNNER_URL, { redirect: 'manual', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      if (runnerReady(response.status)) {
        log(`runner ready (status ${String(response.status)}) after ${String(attempt + 1)} probes`)
        await window.loadURL(RUNNER_URL)
        return
      }
    } catch {
      // A refused connection, a probe that outlived its timeout, or a failed
      // navigation all mean the Runner is not serving yet; the next attempt asks again.
    }
    await new Promise(resolve => setTimeout(resolve, CONNECT_INTERVAL_MS))
  }
  if (window === undefined) return
  log('runner never became ready')
  await dialog.showMessageBox(window, {
    type: 'error', title: language().failedTitle, message: language().failedBody,
  })
}

/** The page shown while the Runner starts, so the window is never an empty surface. */
function startingPage(): string {
  const text = language().starting(app.getName())
  const html = `<!doctype html><meta charset="utf-8"><title>${app.getName()}</title>`
    + '<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;'
    + 'font:15px -apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#697586;background:#fff">'
    + `<p>${text}</p></body>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/**
 * The deployment's menu bar mark, or the shipped fallback. A template image is
 * drawn in the menu bar's own colour, so the mark stays legible when the
 * member switches between the light and dark appearance.
 * @returns the image the tray control displays.
 */
function trayIcon(): Electron.NativeImage {
  const staged = stagedResource(TRAY_ICON, 'DSH_TEAM_TRAY_ICON')
  if (staged === undefined) {
    return nativeImage.createFromDataURL(
      'data:image/svg+xml;charset=utf-8,'
      + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#1677ff"/><path d="M8 9h8c6 0 9 3 9 7s-3 7-9 7H8V9zm6 5v4h2c2 0 3-1 3-2s-1-2-3-2h-2z" fill="white"/></svg>'),
    )
  }
  const image = nativeImage.createFromPath(staged)
  image.setTemplateImage(true)
  return image
}

/** Create the hidden-on-close window and the resident tray control. */
function createDesktop(): void {
  // Windows and Linux draw Electron's default menu as a bar inside the window.
  // This shell contributes no menu commands, so the bar is removed; Chromium
  // keeps the clipboard and undo accelerators in the page itself. macOS keeps
  // the default menu, which owns Quit, Hide, and the same accelerators there.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  const background = process.argv.includes('--background')
    || app.getLoginItemSettings().wasOpenedAtLogin
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
    },
  })
  void window.loadURL(startingPage())
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === new URL(RUNNER_URL).origin) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    // The Runner went away under the page (a restart after an unexpected
    // exit); polling brings the page back when it listens again.
    if (!isMainFrame) return
    log(`page failed to load: ${String(code)} ${description}`)
    void showRunner()
  })
  window.webContents.on('did-navigate', (_event, url, status) => {
    // A Runner answer the readiness probe accepted can still be gone by the
    // time the page asks; an error page in the window is never the surface.
    if (!url.startsWith(new URL(RUNNER_URL).origin) || status < 400) return
    log(`page answered ${String(status)}; polling again`)
    void showRunner()
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window?.hide()
  })

  tray = new Tray(trayIcon())
  tray.setToolTip(app.getName())
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: language().show(app.getName()), click: () => { void showRunner() } },
    { type: 'separator' },
    { label: language().quit, click: () => { app.quit() } },
  ]))
  tray.on('click', () => { void showRunner() })
  if (!background) void showRunner()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { void showRunner() })
  app.on('activate', () => { void showRunner() })
  app.on('before-quit', () => {
    quitting = true
    if (restart !== undefined) clearTimeout(restart)
    log('quitting; stopping runner')
    runner?.kill()
  })
  app.on('window-all-closed', () => {
    // The tray and Runner intentionally remain alive after the window closes.
  })
  void app.whenReady().then(() => {
    mkdirSync(runnerData(), { recursive: true })
    log(`launch ${app.getVersion()} packaged=${String(app.isPackaged)} argv=${process.argv.slice(1).join(' ')}`)
    // The Runner's boot is the critical path to the first screen; it starts
    // before the window exists and before the login item is touched.
    launchRunner()
    const controlPlaneUrl = app.isPackaged
      ? packagedControlPlaneUrl()
      : process.env['DSH_TEAM_CONTROL_PLANE_URL']
    if (controlPlaneUrl !== undefined && controlPlaneUrl !== '') pinControlPlaneAuthority(controlPlaneUrl)
    const gate = releaseGate()
    if (gate === undefined) log('no release key; this build does not check for updates')
    updates = new TeamUpdateCoordinator(
      publishUpdateState,
      stopRunner,
      undefined,
      () => gate !== undefined && app.isPackaged && existsSync(join(process.resourcesPath, UPDATE_CONFIG)),
      gate,
      log,
    )
    ipcMain.handle(UPDATE_IPC.check, async () => updates?.check() ?? updateState)
    ipcMain.handle(UPDATE_IPC.install, async () => { await updates?.install() })
    ipcMain.handle(UPDATE_IPC.pause, () => { updates?.pause() })
    scheduleUpdateChecks()
    createDesktop()
    // Registering is slow and announces itself with a system notification, so
    // it happens once, not on every launch.
    if (app.isPackaged && !app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--background'] })
      log('login item registered')
    }
  })
}
