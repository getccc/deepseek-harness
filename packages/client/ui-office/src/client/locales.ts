/** `office` namespace dictionaries (the composer office-deliverable chip). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.label': '办公',
  'chip.aria': '办公文档：{state}',
  'chip.title': '本次对话要生成的办公文档',
  'chip.none': '未选择',
  'menu.failed': '未能保存这次更改',
  'kind.word': 'Word',
  'kind.ppt': 'PPT',
  'kind.amec-ppt': 'AMEC PPT 模版',
  'kind.excel': 'Excel',
} satisfies Record<string, string>

/** The office namespace key union. */
export type OfficeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.label': 'Office',
  'chip.aria': 'Office document: {state}',
  'chip.title': 'The office document this conversation should produce',
  'chip.none': 'None',
  'menu.failed': 'That change could not be saved',
  'kind.word': 'Word',
  'kind.ppt': 'PowerPoint',
  'kind.amec-ppt': 'AMEC PowerPoint template',
  'kind.excel': 'Excel',
} satisfies Record<OfficeKey, string>
