/** `bi` namespace dictionaries (the composer's BI-analysis control). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.label': 'BI分析',
  'chip.aria': 'BI 分析：{state}',
  'chip.title': '本次对话分析的 BI 项目',
  'chip.none': '未选择',
  'menu.failed': '未能保存这次更改',
  'menu.empty': '没有可分析的 BI 项目',
  'menu.unavailable': '当前项目已不可用，请重新选择',
} satisfies Record<string, string>

/** The bi namespace key union. */
export type BiKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.label': 'BI analysis',
  'chip.aria': 'BI analysis: {state}',
  'chip.title': 'The BI project this conversation analyzes',
  'chip.none': 'None',
  'menu.failed': 'That change could not be saved',
  'menu.empty': 'No BI project to analyze',
  'menu.unavailable': 'The chosen project is no longer available; choose another',
} satisfies Record<BiKey, string>
