/** `team.update` namespace dictionaries (the sidebar update control's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'available.label': '更新到新版本',
  'available.title': '发现新版本 {version}，点击更新',
  'installing.label': '正在下载更新，点击暂停',
  'installing.title': '正在下载 {version}：{percent}%，点击暂停',
  'installing.title.unknown': '正在下载 {version}，点击暂停',
  'paused.label': '下载已暂停，点击继续',
  'paused.title': '{version} 的下载已暂停，点击重新开始（已下载的部分不保留）',
  'ready.label': '正在重启以完成更新',
  'ready.title': '{version} 已下载，正在重启',
  'error.label': '更新失败，点击重试',
  'error.title': '更新失败：{message}',
  'required.title': '需要更新',
  'required.body': '本部署不再支持当前版本。更新到 {version} 后才能继续使用。',
  'required.action': '立即更新',
  'required.working': '正在更新…',
} satisfies Record<string, string>

/** The team.update namespace key union. */
export type DesktopUpdateKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'available.label': 'Update to the new version',
  'available.title': 'Version {version} is available; click to update',
  'installing.label': 'Downloading the update, click to pause',
  'installing.title': 'Downloading {version}: {percent}%, click to pause',
  'installing.title.unknown': 'Downloading {version}, click to pause',
  'paused.label': 'Download paused, click to resume',
  'paused.title': 'The download of {version} is paused; clicking starts it again (what was fetched is not kept)',
  'ready.label': 'Restarting to finish the update',
  'ready.title': '{version} is downloaded; restarting',
  'error.label': 'Update failed, click to retry',
  'error.title': 'Update failed: {message}',
  'required.title': 'Update required',
  'required.body': 'This deployment no longer supports the installed version. Update to {version} to keep working.',
  'required.action': 'Update now',
  'required.working': 'Updating…',
} satisfies Record<DesktopUpdateKey, string>
