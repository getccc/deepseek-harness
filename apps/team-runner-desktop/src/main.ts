/** Electron lifecycle for the local Team Runner. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  appendFileSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  shell,
  Tray,
} from 'electron'
import { deploymentPatch, resolveDeployment, type LoginLocale } from './deployment.ts'
import { profileManifest } from './profile.ts'
import { runnerReady } from './readiness.ts'

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
/** The AMEC PowerPoint template the office picker's `amec-ppt` kind builds from. */
const PPT_TEMPLATE = 'templates/amec-ppt.pptx'
/** Records which application version materialized the profile's plugin tree. */
const PLUGIN_TREE_STAMP = '.dsh-plugin-tree'
/**
 * The welcome-notice version this build treats as already acknowledged, so the
 * beta-disclaimer modal never opens for a member. Mirrors
 * `WELCOME_NOTICE_VERSION` in `@deepseek-ai/dsh-client-ui-settings-models`
 * (`onboarding-copy.ts`); bump both together if that notice is reissued.
 */
const ACKNOWLEDGED_WELCOME_NOTICE = '2026-08-13.1'
/** The deployment's menu bar mark, drawn in the bar's own colour. */
const TRAY_ICON = 'trayTemplate.png'
/** The live Runner's process id, so the next launch can retire a survivor. */
const RUNNER_PID_FILE = 'runner.pid'
/** Timestamped shell events, beside the Runner's own log. */
const SHELL_LOG = 'shell.log'

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
 * The plugin tree is materialized once per application version, because a
 * member cannot change it and `dsh` heals its own links there on every boot.
 * @param home - the private `DSH_HOME` given to the Runner.
 */
function provisionProfile(home: string): void {
  const dir = join(home, 'profiles', 'team')
  mkdirSync(dir, { recursive: true })
  const plugins = stagedResource(PLUGIN_TREE, 'DSH_TEAM_PLUGIN_TREE')
  writeFileSync(join(dir, 'package.json'), profileManifest(plugins !== undefined))
  if (plugins === undefined) return
  const stamp = join(dir, PLUGIN_TREE_STAMP)
  const generation = `${app.getVersion()} ${plugins}\n`
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

/**
 * Seed the member's durable settings so the beta-disclaimer welcome notice is
 * already acknowledged. Only the first launch writes the file; a member who
 * has settings keeps them, so this never overwrites a real settings document.
 * @param home - the private `DSH_HOME` given to the Runner.
 */
function suppressWelcomeNotice(home: string): void {
  const settings = join(home, 'settings.yaml')
  if (existsSync(settings)) return
  mkdirSync(home, { recursive: true })
  writeFileSync(settings, `ui-onboarding:\n  welcomeNoticeVersion: ${JSON.stringify(ACKNOWLEDGED_WELCOME_NOTICE)}\n`, { mode: 0o600 })
}

/** Start the Runner and restart unexpected exits while the desktop app lives. */
function startRunner(): void {
  const data = runnerData()
  mkdirSync(data, { recursive: true })
  const patchPath = join(data, 'team-deployment.patch.yml')
  const certificateAuthority = stagedResource(CONTROL_PLANE_CA, 'DSH_TEAM_CONTROL_PLANE_CA')
  const pptTemplate = stagedResource(PPT_TEMPLATE, 'DSH_TEAM_PPT_TEMPLATE')
  const deployment = resolveDeployment({
    controlPlaneUrl: app.isPackaged
      ? packagedControlPlaneUrl()
      : process.env['DSH_TEAM_CONTROL_PLANE_URL'] ?? '',
    ...certificateAuthority === undefined ? {} : { controlPlaneCa: certificateAuthority },
    runnerVersion: app.getVersion(),
    callbackUrl: 'http://127.0.0.1:3090/team/callback',
    locale: loginLocale(),
    ...pptTemplate === undefined ? {} : { amecTemplatePath: pptTemplate },
  })
  writeFileSync(patchPath, deploymentPatch(deployment), { encoding: 'utf8', mode: 0o600 })
  const home = join(data, 'home')
  provisionProfile(home)
  suppressWelcomeNotice(home)
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
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
    createDesktop()
    // Registering is slow and announces itself with a system notification, so
    // it happens once, not on every launch.
    if (app.isPackaged && !app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--background'] })
      log('login item registered')
    }
  })
}
