/** `gmo` namespace dictionaries (the composer's GMO supply-chain control). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.label': 'GMO供应链',
  'chip.aria': 'GMO供应链：{state}',
  'chip.title': '本次对话查询的 GMO供应链分类',
  'chip.none': '未选择',
  'menu.failed': '未能保存这次更改',
  'menu.empty': '没有可查询的 GMO供应链分类',
  'menu.unavailable': '当前分类已不可用，请重新选择',
} satisfies Record<string, string>

/** The gmo namespace key union. */
export type GmoKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.label': 'GMO supply chain',
  'chip.aria': 'GMO supply chain: {state}',
  'chip.title': 'The GMO supply-chain category this conversation asks about',
  'chip.none': 'None',
  'menu.failed': 'That change could not be saved',
  'menu.empty': 'No GMO supply-chain category to ask about',
  'menu.unavailable': 'The chosen category is no longer available; choose another',
} satisfies Record<GmoKey, string>
