/** `sidebar` namespace dictionaries for shell controls and global panels. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'panels.unpinTooltip': '从左侧栏取消固定',
  'panels.unpin': '从侧边栏取消固定{name}',
  'chat.new': '新对话',
  'chat.new.label': '新建对话',
  'work.new': '新工作任务',
  'work.new.label': '新建工作任务',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'panels.label': '全局面板',
  'navigation.label': '导航',
  'panels.more': '更多',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'panels.unpinTooltip': 'Unpin from left sidebar',
  'panels.unpin': 'Unpin {name} from sidebar',
  'chat.new': 'New chat',
  'chat.new.label': 'New chat',
  'work.new': 'New work task',
  'work.new.label': 'New work task',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'panels.label': 'Global panels',
  'navigation.label': 'Navigation',
  'panels.more': 'More',
} satisfies Record<SidebarKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  'work.new': '新しい作業タスク',
  'work.new.label': '新しい作業タスク',
  'chat.new': '新しいチャット',
  'chat.new.label': '新しいチャット',
  'panels.unpinTooltip': '左サイドバーから固定解除',
  'panels.unpin': '{name}をサイドバーから固定解除',
  'toggle.open': 'サイドバーを開く',
  'toggle.collapse': 'サイドバーを折りたたむ',
  'panels.label': 'グローバルパネル',
  'navigation.label': 'ナビゲーション',
  'panels.more': 'その他',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  'work.new': 'Nueva tarea de trabajo',
  'work.new.label': 'Nueva tarea de trabajo',
  'chat.new': 'Nuevo chat',
  'chat.new.label': 'Nuevo chat',
  'panels.unpinTooltip': 'Desanclar de la barra lateral izquierda',
  'panels.unpin': 'Desfijar {name} de la barra lateral',
  'toggle.open': 'Abrir barra lateral',
  'toggle.collapse': 'Contraer barra lateral',
  'panels.label': 'Paneles globales',
  'navigation.label': 'Navegación',
  'panels.more': 'Más',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  'work.new': 'Nouvelle tâche',
  'work.new.label': 'Nouvelle tâche',
  'chat.new': 'Nouvelle discussion',
  'chat.new.label': 'Nouvelle discussion',
  'panels.unpinTooltip': "Retirer l'épingle de la barre latérale gauche",
  'panels.unpin': 'Désépingler {name} de la barre latérale',
  'toggle.open': 'Ouvrir la barre latérale',
  'toggle.collapse': 'Réduire la barre latérale',
  'panels.label': 'Panneaux globaux',
  'navigation.label': 'Navigation',
  'panels.more': 'Plus',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  'work.new': 'Neue Arbeitsaufgabe',
  'work.new.label': 'Neue Arbeitsaufgabe',
  'chat.new': 'Neuer Chat',
  'chat.new.label': 'Neuer Chat',
  'panels.unpinTooltip': 'Von der linken Seitenleiste lösen',
  'panels.unpin': '{name} von der Seitenleiste lösen',
  'toggle.open': 'Seitenleiste öffnen',
  'toggle.collapse': 'Seitenleiste einklappen',
  'panels.label': 'Globale Bereiche',
  'navigation.label': 'Navigation',
  'panels.more': 'Mehr',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  'work.new': 'Новая рабочая задача',
  'work.new.label': 'Новая рабочая задача',
  'chat.new': 'Новый чат',
  'chat.new.label': 'Новый чат',
  'panels.unpinTooltip': 'Открепить от левой боковой панели',
  'panels.unpin': 'Открепить {name} от боковой панели',
  'toggle.open': 'Открыть боковую панель',
  'toggle.collapse': 'Свернуть боковую панель',
  'panels.label': 'Глобальные панели',
  'navigation.label': 'Навигация',
  'panels.more': 'Ещё',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  'work.new': 'Nova tarefa de trabalho',
  'work.new.label': 'Nova tarefa de trabalho',
  'chat.new': 'Nova conversa',
  'chat.new.label': 'Nova conversa',
  'panels.unpinTooltip': 'Soltar da barra lateral esquerda',
  'panels.unpin': 'Desafixar {name} da barra lateral',
  'toggle.open': 'Abrir barra lateral',
  'toggle.collapse': 'Recolher barra lateral',
  'panels.label': 'Painéis globais',
  'navigation.label': 'Navegação',
  'panels.more': 'Mais',
} satisfies Record<keyof typeof en, string>
