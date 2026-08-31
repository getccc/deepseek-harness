/** Account launcher copy owned by the Team local-login feature. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'menu': '账户菜单',
  'settings': '设置',
  'signOut': '退出登录',
  'memberFallback': '团队成员',
} satisfies Record<string, string>

/** The account launcher namespace key union. */
export type TeamAccountKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  'menu': 'Account menu',
  'settings': 'Settings',
  'signOut': 'Sign out',
  'memberFallback': 'Team member',
} satisfies Record<TeamAccountKey, string>
