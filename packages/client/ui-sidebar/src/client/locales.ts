/** `sidebar` namespace dictionaries for shell controls and global panels. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chat.new': '新对话',
  'chat.new.label': '新建对话',
  'work.new': '新工作任务',
  'work.new.label': '新建工作任务',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'panels.label': '全局面板',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chat.new': 'New chat',
  'chat.new.label': 'New chat',
  'work.new': 'New work task',
  'work.new.label': 'New work task',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'panels.label': 'Global panels',
} satisfies Record<SidebarKey, string>
