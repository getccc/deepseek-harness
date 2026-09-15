/** `webAccess` namespace dictionaries (the composer web switch's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.label': '联网',
  'chip.on.aria': '联网已开启，按下关闭',
  'chip.on.title': '联网已开启：点击关闭（/web off）',
  'chip.off.aria': '联网已关闭，按下开启',
  'chip.off.title': '联网已关闭：点击开启（/web on）',
  'chip.failed': '切换联网失败',
} satisfies Record<string, string>

/** The webAccess namespace key union. */
export type WebAccessKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.label': 'Web',
  'chip.on.aria': 'Web access on, press to turn off',
  'chip.on.title': 'Web access on: click to turn off (/web off)',
  'chip.off.aria': 'Web access off, press to turn on',
  'chip.off.title': 'Web access off: click to turn on (/web on)',
  'chip.failed': 'Failed to switch web access',
} satisfies Record<WebAccessKey, string>
