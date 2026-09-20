/** `team.update` namespace dictionaries (the sidebar update control's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'available.label': '更新到新版本',
  'available.title': '发现新版本 {version}，点击更新',
  'installing.label': '正在下载更新',
  'installing.title': '正在下载 {version}：{percent}%',
  'installing.title.unknown': '正在下载 {version}',
  'ready.label': '正在重启以完成更新',
  'ready.title': '{version} 已下载，正在重启',
  'error.label': '更新失败，点击重试',
  'error.title': '更新失败：{message}',
} satisfies Record<string, string>

/** The team.update namespace key union. */
export type DesktopUpdateKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'available.label': 'Update to the new version',
  'available.title': 'Version {version} is available; click to update',
  'installing.label': 'Downloading the update',
  'installing.title': 'Downloading {version}: {percent}%',
  'installing.title.unknown': 'Downloading {version}',
  'ready.label': 'Restarting to finish the update',
  'ready.title': '{version} is downloaded; restarting',
  'error.label': 'Update failed, click to retry',
  'error.title': 'Update failed: {message}',
} satisfies Record<DesktopUpdateKey, string>
