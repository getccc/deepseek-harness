/**
 * One release stream for the desktop shell and the Runner it carries. The
 * coordinator owns the phases a member sees; what may be installed is decided
 * by the release provider this updater is configured with, and stopping the
 * Runner belongs to the caller's `beforeRestart`.
 * @module @deepseek-ai/dsh-team-runner-desktop/update-coordinator
 */

import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { UpdateArtifact } from '@deepseek-ai/dsh-team-update'
import type { ReleaseGate } from './release-gate.ts'
import type { TeamUpdateState } from './update-state.ts'

const { autoUpdater } = electronUpdater

/** Checks, downloads, and installs one complete desktop release. */
export class TeamUpdateCoordinator {
  private offered: string | undefined
  private accepted: UpdateArtifact | undefined
  private checkOperation: Promise<TeamUpdateState> | undefined
  private installOperation: Promise<TeamUpdateState> | undefined

  /**
   * @param publish - state sink for the shell's window; returns what it was given.
   * @param beforeRestart - stops the Runner and waits for its port and executable to be released.
   * @param updater - the artifact updater; replaceable for tests.
   * @param enabled - whether this build carries a release stream to ask.
   * @param gate - the signed-manifest decision; without one nothing is verified beyond the updater's own hash.
   */
  constructor(
    private readonly publish: (state: TeamUpdateState) => TeamUpdateState,
    private readonly beforeRestart: () => Promise<void> = async () => {},
    private readonly updater: AppUpdater = autoUpdater,
    private readonly enabled: () => boolean = () => true,
    private readonly gate?: ReleaseGate,
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
      this.offered = undefined
      this.accepted = undefined
      if (version === undefined) return this.publish({ phase: 'idle' })
      if (this.gate !== undefined) {
        const verdict = await this.gate.accept(version)
        // The metadata beside the artifacts is not what this build trusts; a
        // release the signed manifest does not cover is never offered.
        if ('refused' in verdict) return this.publish({ phase: 'error', version, message: verdict.refused })
        this.accepted = verdict.accepted
        this.offered = version
        return this.publish({ phase: 'available', version, required: verdict.required })
      }
      this.offered = version
      return this.publish({ phase: 'available', version })
    } catch (error) {
      this.offered = undefined
      this.accepted = undefined
      return this.publish({ phase: 'error', message: reason(error) })
    }
  }

  private async doInstall(): Promise<TeamUpdateState> {
    const version = this.offered
    if (version === undefined) {
      return this.publish({ phase: 'error', message: 'no accepted release is available' })
    }
    this.publish({ phase: 'installing', version })
    // A 280 MB download over a company network is minutes long; the member
    // watches the percentage rather than a button that only looks busy.
    const progress = (info: { percent: number }): void => {
      this.publish({ phase: 'installing', version, percent: Math.round(info.percent) })
    }
    this.updater.on('download-progress', progress)
    try {
      const files = await this.updater.downloadUpdate()
      const accepted = this.accepted
      if (accepted !== undefined) {
        const artifact = files.find(path => !path.endsWith('.blockmap'))
        const problem = artifact === undefined
          ? 'the updater downloaded no artifact to verify'
          : await (this.gate?.verify(artifact, accepted) ?? Promise.resolve(undefined))
        if (problem !== undefined) return this.publish({ phase: 'error', version, message: problem })
      }
      this.offered = undefined
      this.accepted = undefined
      const ready = this.publish({ phase: 'ready', version })
      // The Runner holds the fixed port and, on Windows, files the installer
      // replaces; it has to be gone before the installer runs.
      await this.beforeRestart()
      this.updater.quitAndInstall(false, true)
      return ready
    } catch (error) {
      return this.publish({ phase: 'error', version, message: reason(error) })
    } finally {
      this.updater.off('download-progress', progress)
    }
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
