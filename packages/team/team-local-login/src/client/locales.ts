/** Account launcher copy owned by the Team local-login feature. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'menu': '账户菜单',
  'settings': '设置',
  'signOut': '退出登录',
  'hero.lateNight.greeting': 'Hi {name}，深夜好！有什么我能帮你的吗？',
  'hero.lateNight.tagline': '夜色归于宁静，放下纷扰安然休憩，静待曙光！',
  'hero.earlyMorning.greeting': 'Hi {name}，早上好！有什么我能帮你的吗？',
  'hero.earlyMorning.tagline': '破晓微光洒落，拥抱清晨，满怀期待迎接崭新一日！',
  'hero.morningSong.greeting': 'Hi {name}，上午好！有什么我能帮你的吗？',
  'hero.morningSong.tagline': '晨光渐盛，齐聚此刻，唱响中微之歌，歌声传递信念，凝聚同向而行的力量！',
  'hero.morning.greeting': 'Hi {name}，上午好！今天有什么工作要处理？',
  'hero.morning.tagline': '晨光正好，保持专注，用心对待当下的每一刻！',
  'hero.noon.greeting': 'Hi {name}，中午好！有什么我能帮你的吗？',
  'hero.noon.tagline': '放慢脚步短暂放空，好好补给，为接下来积蓄能量！',
  'hero.afternoon.greeting': 'Hi {name}，下午好！今天有什么工作要处理？',
  'hero.afternoon.tagline': '时光缓缓向前，沉下心来，一步步向着目标靠近！',
  'hero.evening.greeting': 'Hi {name}，晚上好！有什么我能帮你的吗？',
  'hero.evening.tagline': '暮色降临，回望今日收获，在松弛中沉淀自我成长！',
  'memberFallback': '团队成员',
} satisfies Record<string, string>

/** The account launcher namespace key union. */
export type TeamAccountKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  'menu': 'Account menu',
  'settings': 'Settings',
  'signOut': 'Sign out',
  'hero.lateNight.greeting': 'Hi {name}, it is late! What can I help you with?',
  'hero.lateNight.tagline': 'The night has gone quiet — set the day down, rest, and wait for first light.',
  'hero.earlyMorning.greeting': 'Hi {name}, good morning! What can I help you with?',
  'hero.earlyMorning.tagline': 'Daybreak is here — take in the morning and meet a brand new day.',
  'hero.morningSong.greeting': 'Hi {name}, good morning! What can I help you with?',
  'hero.morningSong.tagline': 'The light is rising — gather now and sing the company song, one belief carrying everyone the same way.',
  'hero.morning.greeting': 'Hi {name}, good morning! What are you working on today?',
  'hero.morning.tagline': 'The morning is at its best — stay with what is in front of you.',
  'hero.noon.greeting': 'Hi {name}, good afternoon! What can I help you with?',
  'hero.noon.tagline': 'Slow down and empty your head for a moment — eat well and store up what comes next.',
  'hero.afternoon.greeting': 'Hi {name}, good afternoon! What are you working on today?',
  'hero.afternoon.tagline': 'The hours move on quietly — settle in and close on the goal one step at a time.',
  'hero.evening.greeting': 'Hi {name}, good evening! What can I help you with?',
  'hero.evening.tagline': 'Dusk is falling — look back on what today gave you and let it settle.',
  'memberFallback': 'Team member',
} satisfies Record<TeamAccountKey, string>
