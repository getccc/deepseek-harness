/**
 * Context-isolated bridge that gives the Runner page the shell's update
 * controls. The page is served by the local Runner and also runs in a plain
 * browser, where no bridge exists and the update control is absent; nothing
 * here exposes Node or Electron itself.
 * @module @deepseek-ai/dsh-team-runner-desktop/preload
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { UPDATE_IPC, type TeamDesktopUpdateApi, type TeamUpdateState } from './update-state.ts'

const api: TeamDesktopUpdateApi = {
  protocolVersion: 1,
  check: () => ipcRenderer.invoke(UPDATE_IPC.check) as Promise<TeamUpdateState>,
  install: () => ipcRenderer.invoke(UPDATE_IPC.install) as Promise<void>,
  pause: () => ipcRenderer.invoke(UPDATE_IPC.pause) as Promise<void>,
  subscribe: (listener) => {
    const handle = (_event: IpcRendererEvent, state: TeamUpdateState): void => { listener(state) }
    ipcRenderer.on(UPDATE_IPC.state, handle)
    return () => { ipcRenderer.off(UPDATE_IPC.state, handle) }
  },
}

contextBridge.exposeInMainWorld('dshTeamDesktop', api)
