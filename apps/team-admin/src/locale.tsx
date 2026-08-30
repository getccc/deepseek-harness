/**
 * Which language the console speaks, and how a component asks for copy.
 *
 * The preference is this browser's, kept in `localStorage`: it is a display
 * choice on one machine, not something the organization decides for a member,
 * and the Control Plane has no business storing it. A browser that has never
 * chosen follows its own `navigator.language`.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Locale } from 'antd/es/locale'
import enUS from 'antd/es/locale/en_US'
import zhCN from 'antd/es/locale/zh_CN'
import { en, zh, type CopyKey } from './locales.ts'

/** The languages this build ships, matching the browser client's own list. */
export const LOCALE_IDS = ['zh', 'en'] as const

/** One shipped language. */
export type LocaleId = typeof LOCALE_IDS[number]

/** Where this browser's choice is kept. */
const STORAGE_KEY = 'dsh-team-admin-locale'

const DICTIONARIES: Record<LocaleId, Record<CopyKey, string>> = { zh, en }
const ANTD_LOCALES: Record<LocaleId, Locale> = { zh: zhCN, en: enUS }

/** What a component reads to render text. */
export interface LocaleState {
  readonly locale: LocaleId
  /** Ant Design's own dictionary, for the copy its components render themselves. */
  readonly antd: Locale
  /** Read one piece of copy, filling `{name}` placeholders from `values`. */
  readonly t: (key: CopyKey, values?: Readonly<Record<string, string | number>>) => string
  readonly setLocale: (next: LocaleId) => void
}

const LocaleContext = createContext<LocaleState | undefined>(undefined)

/**
 * The language to start in: this browser's stored choice, then what it asks
 * for, then Chinese.
 * @returns the locale to render first.
 */
function initialLocale(): LocaleId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'zh' || stored === 'en') return stored
  } catch {
    // A browser that refuses storage still gets a language; it just does not
    // remember the choice between visits.
  }
  return navigator.language.startsWith('zh') ? 'zh' : 'en'
}

/**
 * Provide the language the console renders in.
 * @param props.children - the console.
 * @returns the provider element.
 */
export function LocaleProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [locale, setStored] = useState<LocaleId>(initialLocale)

  const setLocale = useCallback((next: LocaleId) => {
    setStored(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Remembering is a convenience; refusing to store it must not stop the
      // language from changing for this visit.
    }
  }, [])

  const value = useMemo<LocaleState>(() => ({
    locale,
    antd: ANTD_LOCALES[locale],
    t: (key, values) => {
      const copy = DICTIONARIES[locale][key]
      return values === undefined
        ? copy
        : copy.replace(/\{(\w+)\}/gu, (whole, name: string) => {
          const supplied = values[name]
          return supplied === undefined ? whole : String(supplied)
        })
    },
    setLocale,
  }), [locale, setLocale])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

/**
 * Read the language state.
 * @returns the current locale, its Ant Design dictionary, `t`, and the setter.
 */
export function useLocale(): LocaleState {
  const state = useContext(LocaleContext)
  if (state === undefined) throw new Error('useLocale outside LocaleProvider')
  return state
}
