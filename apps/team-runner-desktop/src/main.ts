/** Electron lifecycle for the local Team Runner. */

import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
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
import { deploymentPatch, resolveDeployment } from './deployment.ts'

const RUNNER_URL = 'http://127.0.0.1:3090/team/open'
const RESTART_DELAY_MS = 10_000

const copy = {
  zh: {
    show: '打开 DeepSeek Team Runner',
    quit: '退出',
    failedTitle: 'Runner 无法启动',
    failedBody: '请联系管理员并提供 Runner 日志。',
  },
  en: {
    show: 'Open DeepSeek Team Runner',
    quit: 'Quit',
    failedTitle: 'Runner could not start',
    failedBody: 'Contact your administrator and provide the Runner log.',
  },
} as const

let window: BrowserWindow | undefined
let tray: Tray | undefined
let runner: ChildProcess | undefined
let restart: NodeJS.Timeout | undefined
let quitting = false

/** Show one localized startup failure without exposing deployment secrets. */
function reportRunnerFailure(error?: unknown): void {
  const language = app.getLocale().toLowerCase().startsWith('zh') ? copy.zh : copy.en
  const detail = error instanceof Error
    ? error.message
    : typeof error === 'string' ? error : undefined
  void dialog.showMessageBox({
    type: 'error',
    title: language.failedTitle,
    message: language.failedBody,
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
  return join(process.resourcesPath, 'runner', process.platform === 'win32' ? 'dsh.exe' : 'dsh')
}

/** Start the Runner and restart unexpected exits while the desktop app lives. */
function startRunner(): void {
  const data = join(app.getPath('userData'), 'runner')
  mkdirSync(data, { recursive: true })
  const patchPath = join(data, 'team-deployment.patch.yml')
  const deployment = resolveDeployment({
    controlPlaneUrl: app.isPackaged
      ? packagedControlPlaneUrl()
      : process.env['DSH_TEAM_CONTROL_PLANE_URL'] ?? '',
    runnerVersion: app.getVersion(),
    callbackUrl: 'http://127.0.0.1:3090/team/callback',
  })
  writeFileSync(patchPath, deploymentPatch(deployment), { encoding: 'utf8', mode: 0o600 })
  const log = openSync(join(data, 'runner.log'), 'a', 0o600)
  runner = spawn(runnerExecutable(), ['--profile', 'team', '--patch', patchPath, '--no-open'], {
    env: { ...process.env, DSH_HOME: join(data, 'home') },
    stdio: ['ignore', log, log],
    windowsHide: true,
  })
  closeSync(log)
  runner.once('exit', () => {
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

/** Show the local web surface when it becomes reachable. */
async function showRunner(): Promise<void> {
  if (window === undefined) return
  window.show()
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(RUNNER_URL, { redirect: 'manual' })
      if (response.status < 500) {
        await window.loadURL(RUNNER_URL)
        return
      }
    } catch {
      // Startup polling owns connection refusals; the next attempt retries.
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const language = app.getLocale().toLowerCase().startsWith('zh') ? copy.zh : copy.en
  await dialog.showMessageBox(window, {
    type: 'error', title: language.failedTitle, message: language.failedBody,
  })
}

/** Create the hidden-on-close window and the resident tray control. */
function createDesktop(): void {
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
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === new URL(RUNNER_URL).origin) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window?.hide()
  })

  const language = app.getLocale().toLowerCase().startsWith('zh') ? copy.zh : copy.en
  const icon = nativeImage.createFromDataURL(
    'data:image/svg+xml;charset=utf-8,'
    + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#1677ff"/><path d="M8 9h8c6 0 9 3 9 7s-3 7-9 7H8V9zm6 5v4h2c2 0 3-1 3-2s-1-2-3-2h-2z" fill="white"/></svg>'),
  )
  tray = new Tray(icon)
  tray.setToolTip('DeepSeek Team Runner')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: language.show, click: () => { void showRunner() } },
    { type: 'separator' },
    { label: language.quit, click: () => { app.quit() } },
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
    runner?.kill()
  })
  app.on('window-all-closed', () => {
    // The tray and Runner intentionally remain alive after the window closes.
  })
  void app.whenReady().then(() => {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--background'] })
    }
    createDesktop()
    launchRunner()
  })
}
