/** `knowledge` namespace dictionaries (the /knowledge picker and the composer chip). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.description': '选择本次对话可检索的知识库',
  'option.all': '全部已授权知识库',
  'option.all.detail': '包含之后新授权给你的知识库',
  'option.unavailable': '已不可用 — 取消勾选即从本次对话中移除',
  'chip.label': '知识库',
  'chip.all': '全部已授权知识库',
  'chip.aria': '知识库：{state}',
  'chip.title': '本次对话可检索的知识库',
  'menu.failed': '未能保存这次更改',
} satisfies Record<string, string>

/** The knowledge namespace key union. */
export type KnowledgeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.description': 'Choose the knowledge this conversation may search',
  'option.all': 'All authorized knowledge bases',
  'option.all.detail': 'Includes knowledge bases granted to you later',
  'option.unavailable': 'No longer available — unticking removes it from this conversation',
  'chip.label': 'Knowledge',
  'chip.all': 'All authorized knowledge bases',
  'chip.aria': 'Knowledge: {state}',
  'chip.title': 'The knowledge this conversation may search',
  'menu.failed': 'That change could not be saved',
} satisfies Record<KnowledgeKey, string>
