/**
 * One release stream for the desktop shell and the Runner it carries. The
 * coordinator owns the phases a member sees; what may be installed is decided
 * by the release provider this updater is configured with, and stopping the
 * Runner belongs to the caller's `beforeRestart`.
 * @module @deepseek-ai/dsh-team-runner-desktop/update-coordinator
 */

import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { TeamUpdateState } from './update-state.ts'

const { autoUpdater } = electronUpdater

/** Checks, downloads, and installs one complete desktop release. */
export class TeamUpdateCoordinator {
  private offered: string | undefined
  private checkOperation: Promise<TeamUpdateState> | undefined
  private installOperation: Promise<TeamUpdateState> | undefined

  /**
   * @param publish - state sink for the shell's window; returns what it was given.
   * @param beforeRestart - stops the Runner and waits for its port and executable to be released.
   * @param updater - the artifact updater; replaceable for tests.
   * @param enabled - whether this build carries a release stream to ask.
   */
  constructor(
    private readonly publish: (state: TeamUpdateState) => TeamUpdateState,
    private readonly beforeRestart: () => Promise<void> = async () => {},
    private readonly updater: AppUpdater = autoUpdater,
    private readonly enabled: () => boolean = () => true,
  ) {
    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = false
  }

  /**
   * Ask the release stream for a newer version and retain what it offered.
   * A check that arrives during an install waits for that install instead.
   * @returns the state this check settled on.
   */
  async check(): Promise<TeamUpdateState> {
    if (this.installOperation !== undefined) return this.installOperation
    if (this.checkOperation !== undefined) return this.checkOperation
    this.checkOperation = this.doCheck().finally(() => { this.checkOperation = undefined })
    return this.checkOperation
  }

  /**
   * Wait for an in-flight check, then download the retained release and
   * restart into it.
   * @returns the last state published before the installer takes over.
   */
  async install(): Promise<TeamUpdateState> {
    if (this.installOperation !== undefined) return this.installOperation
    this.installOperation = (async () => {
      await this.checkOperation
      return this.doInstall()
    })().finally(() => { this.installOperation = undefined })
    return this.installOperation
  }

  private async doCheck(): Promise<TeamUpdateState> {
    this.publish({ phase: 'checking' })
    try {
      if (!this.enabled()) {
        this.offered = undefined
        return this.publish({ phase: 'idle' })
      }
      const result = await this.updater.checkForUpdates()
      const version = result?.isUpdateAvailable === true ? result.updateInfo.version : undefined
      this.offered = version
      return version === undefined
        ? this.publish({ phase: 'idle' })
        : this.publish({ phase: 'available', version })
    } catch (error) {
      this.offered = undefined
      return this.publish({ phase: 'error', message: reason(error) })
    }
  }

  private async doInstall(): Promise<TeamUpdateState> {
    const version = this.offered
    if (version === undefined) {
      return this.publish({ phase: 'error', message: 'no accepted release is available' })
    }
    this.publish({ phase: 'installing', version })
    try {
      await this.updater.downloadUpdate()
      this.offered = undefined
      const ready = this.publish({ phase: 'ready', version })
      // The Runner holds the fixed port and, on Windows, files the installer
      // replaces; it has to be gone before the installer runs.
      await this.beforeRestart()
      this.updater.quitAndInstall(false, true)
      return ready
    } catch (error) {
      return this.publish({ phase: 'error', version, message: reason(error) })
    }
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
