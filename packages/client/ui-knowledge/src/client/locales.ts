/** `knowledge` namespace dictionaries (the /knowledge picker and the composer chip). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.description': '选择本次对话可检索的知识库',
  'option.all': '全部已授权知识库',
  'option.all.detail': '包含之后新授权给你的知识库',
  'option.unavailable': '已不可用 — 应用后将从本次对话中移除',
  'submit': '应用',
  'chip.off': '知识库：关闭',
  'chip.all': '知识库：全部',
  'chip.selected': '知识库：{names}',
  'chip.title': '本次对话可检索的知识库 — 用 /knowledge 更改',
} satisfies Record<string, string>

/** The knowledge namespace key union. */
export type KnowledgeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.description': 'Choose the knowledge this conversation may search',
  'option.all': 'All authorized knowledge bases',
  'option.all.detail': 'Includes knowledge bases granted to you later',
  'option.unavailable': 'No longer available — applying removes it from this conversation',
  'submit': 'Apply',
  'chip.off': 'Knowledge: off',
  'chip.all': 'Knowledge: all',
  'chip.selected': 'Knowledge: {names}',
  'chip.title': 'The knowledge this conversation may search — change it with /knowledge',
} satisfies Record<KnowledgeKey, string>
