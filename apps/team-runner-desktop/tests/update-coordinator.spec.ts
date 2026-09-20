import { describe, expect, it, vi } from 'vitest'
import type { AppUpdater } from 'electron-updater'
import type { TeamUpdateState } from '../src/update-state.ts'

vi.mock('electron-updater', () => ({
  default: { autoUpdater: { autoDownload: true, autoInstallOnAppQuit: true } },
}))

const { TeamUpdateCoordinator } = await import('../src/update-coordinator.ts')

/**
 * One release stream and one state recorder.
 * @param options - the version the stream offers, the download outcome, and the order sink.
 * @returns the updater stub, its calls, the recorded states, and the state sink.
 */
function harness(options: {
  offers?: string
  download?: () => Promise<unknown>
  order?: string[]
} = {}) {
  const states: TeamUpdateState[] = []
  const order = options.order ?? []
  const checkForUpdates = vi.fn(async () => (options.offers === undefined
    ? { isUpdateAvailable: false, updateInfo: { version: '2.3.0' } }
    : { isUpdateAvailable: true, updateInfo: { version: options.offers } }))
  const downloadUpdate = vi.fn(async () => {
    order.push('download')
    return options.download === undefined ? [] : options.download()
  })
  const quitAndInstall = vi.fn(() => { order.push('quitAndInstall') })
  const listeners = new Map<string, (info: { percent: number }) => void>()
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    on: (event: string, listener: (info: { percent: number }) => void) => { listeners.set(event, listener) },
    off: (event: string) => { listeners.delete(event) },
  } as unknown as AppUpdater
  return {
    states,
    order,
    listeners,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    updater,
    publish: (state: TeamUpdateState): TeamUpdateState => {
      states.push(state)
      return state
    },
  }
}

describe('team update coordinator', () => {
  it('stops the Runner between the download and the installer', async () => {
    const stream = harness({ offers: '2.4.0' })
    const coordinator = new TeamUpdateCoordinator(
      stream.publish,
      async () => { stream.order.push('stopRunner') },
      stream.updater,
      () => true,
    )
    await coordinator.check()
    await coordinator.install()
    expect(stream.order).toEqual(['download', 'stopRunner', 'quitAndInstall'])
    expect(stream.states.map(state => state.phase)).toEqual(['checking', 'available', 'installing', 'ready'])
    expect(stream.states.at(-1)?.version).toBe('2.4.0')
  })

  it('publishes the download percentage and stops listening afterwards', async () => {
    const stream = harness({ offers: '2.4.0' })
    stream.downloadUpdate.mockImplementationOnce(async () => {
      stream.listeners.get('download-progress')?.({ percent: 41.6 })
      return []
    })
    const coordinator = new TeamUpdateCoordinator(stream.publish, undefined, stream.updater, () => true)
    await coordinator.check()
    await coordinator.install()
    expect(stream.states).toContainEqual({ phase: 'installing', version: '2.4.0', percent: 42 })
    expect(stream.listeners.has('download-progress')).toBe(false)
  })

  it('turns off the updater defaults that would install without the member', () => {
    const stream = harness()
    new TeamUpdateCoordinator(stream.publish, undefined, stream.updater, () => true)
    expect(stream.updater.autoDownload).toBe(false)
    expect(stream.updater.autoInstallOnAppQuit).toBe(false)
  })

  it('reports idle without asking when the build carries no release stream', async () => {
    const stream = harness({ offers: '2.4.0' })
    await new TeamUpdateCoordinator(stream.publish, undefined, stream.updater, () => false).check()
    expect(stream.checkForUpdates).not.toHaveBeenCalled()
    expect(stream.states.map(state => state.phase)).toEqual(['checking', 'idle'])
  })

  it('publishes the reason a check failed and installs nothing after it', async () => {
    const stream = harness()
    stream.checkForUpdates.mockRejectedValueOnce(new Error('unreachable release stream'))
    const coordinator = new TeamUpdateCoordinator(stream.publish, undefined, stream.updater, () => true)
    await coordinator.check()
    expect(stream.states.at(-1)).toEqual({ phase: 'error', message: 'unreachable release stream' })
    await coordinator.install()
    expect(stream.downloadUpdate).not.toHaveBeenCalled()
    expect(stream.states.at(-1)?.message).toBe('no accepted release is available')
  })

  it('keeps the installed build running when a download fails', async () => {
    const stream = harness({
      offers: '2.4.0',
      download: () => Promise.reject(new Error('digest mismatch')),
    })
    const coordinator = new TeamUpdateCoordinator(stream.publish, undefined, stream.updater, () => true)
    await coordinator.check()
    await coordinator.install()
    expect(stream.quitAndInstall).not.toHaveBeenCalled()
    expect(stream.states.at(-1)).toEqual({ phase: 'error', version: '2.4.0', message: 'digest mismatch' })
  })

  it('answers concurrent checks from one request to the release stream', async () => {
    const stream = harness()
    const coordinator = new TeamUpdateCoordinator(stream.publish, undefined, stream.updater, () => true)
    await Promise.all([coordinator.check(), coordinator.check(), coordinator.check()])
    expect(stream.checkForUpdates).toHaveBeenCalledTimes(1)
  })
})
