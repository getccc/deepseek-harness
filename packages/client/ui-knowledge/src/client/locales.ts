/** `knowledge` namespace dictionaries (the /knowledge picker, the composer chip, and the documents dock). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'command.label': '知识库',
  'command.description': '选择本次对话可检索的知识库',
  'option.all': '全部已授权知识库',
  'option.all.detail': '包含之后新授权给你的知识库',
  'option.unavailable': '已不可用 — 取消勾选即从本次对话中移除',
  'chip.label': '知识库',
  'chip.all': '全部已授权知识库',
  'chip.count': '{count} 个知识库',
  'chip.documents': '{name} · {count} 篇文档',
  'chip.aria': '知识库：{state}',
  'chip.title': '本次对话可检索的知识库',
  'menu.failed': '未能保存这次更改',
  'dock.label': '本次对话基于 {name} 中的这些文档回答',
  'dock.untitled': '未命名文档',
  'dock.remove': '从本次对话中移除 {title}',
  'dock.failed': '未能移除这份文档',
} satisfies Record<string, string>

/** The knowledge namespace key union. */
export type KnowledgeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'command.label': 'Knowledge',
  'command.description': 'Choose the knowledge this conversation may search',
  'option.all': 'All authorized knowledge bases',
  'option.all.detail': 'Includes knowledge bases granted to you later',
  'option.unavailable': 'No longer available — unticking removes it from this conversation',
  'chip.label': 'Knowledge',
  'chip.all': 'All authorized knowledge bases',
  'chip.count': '{count} knowledge bases',
  'chip.documents': '{name} · {count} documents',
  'chip.aria': 'Knowledge: {state}',
  'chip.title': 'The knowledge this conversation may search',
  'menu.failed': 'That change could not be saved',
  'dock.label': 'This conversation answers from these documents in {name}',
  'dock.untitled': 'Untitled document',
  'dock.remove': 'Remove {title} from this conversation',
  'dock.failed': 'That document could not be removed',
} satisfies Record<KnowledgeKey, string>
