/** `office` namespace dictionaries (the composer office-deliverable chip). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.label': '办公',
  'chip.aria': '办公交付物：{state}',
  'chip.title': '本次对话要生成的办公交付物',
  'chip.none': '未选择',
  'menu.failed': '未能保存这次更改',
  'kind.word': 'Word',
  'kind.excel': 'Excel',
  'kind.ppt': 'PPT',
  'kind.amec-ppt': 'AMEC PPT 模版',
  'kind.chart': '可视化',
} satisfies Record<string, string>

/** The office namespace key union. */
export type OfficeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.label': 'Office',
  'chip.aria': 'Office deliverable: {state}',
  'chip.title': 'The office deliverable this conversation should produce',
  'chip.none': 'None',
  'menu.failed': 'That change could not be saved',
  'kind.word': 'Word',
  'kind.excel': 'Excel',
  'kind.ppt': 'PowerPoint',
  'kind.amec-ppt': 'AMEC PowerPoint template',
  'kind.chart': 'Visualization',
} satisfies Record<OfficeKey, string>
