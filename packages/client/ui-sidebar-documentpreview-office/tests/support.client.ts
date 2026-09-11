/** Shared props and fixtures for the office body specs. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { OfficeBodyProps } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

export { minimalDocx, workbookBytes } from './fixtures.ts'

const translations: ReadonlyMap<string, string> = new Map(Object.entries(en))

/**
 * Standard document props over one byte array.
 * @param path - workspace file name the address names.
 * @param data - complete bytes, or undefined for text-page content.
 * @param signal - tab lifetime.
 * @returns props for a body component.
 */
export function bodyProps(path: string, data: Uint8Array<ArrayBuffer> | undefined, signal = new AbortController().signal): OfficeBodyProps {
  return {
    resourceAddress: `dsh-resource://file/session/office/${path}`,
    content: data === undefined ? { kind: 'text', text: '', pages: [], eof: true } : { kind: 'bytes', data },
    wrap: false,
    sessionId: 'office' as SessionId,
    useTabInfo: () => ({ tab: { signal } }),
    useResource: () => ({ value: undefined }),
    t: (key: string, params?: Record<string, unknown>) => {
      let value = translations.get(key) ?? key
      for (const [name, param] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(param))
      return value
    },
  } as unknown as OfficeBodyProps
}
