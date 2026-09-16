/** `bi` namespace dictionaries (the composer's BI-analysis chip). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.label': 'BI分析',
  'chip.pending': 'BI分析功能开发中',
} satisfies Record<string, string>

/** The bi namespace key union. */
export type BiKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.label': 'BI analysis',
  'chip.pending': 'BI analysis is not built yet',
} satisfies Record<BiKey, string>
