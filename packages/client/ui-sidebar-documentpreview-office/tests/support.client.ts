/** Shared props and fixtures for the office body specs. */
import { vi, type Mock } from 'vitest'
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
 * @param overrides - framework seats a spec observes, such as the scrollport callback.
 * @returns props for a body component.
 */
export function bodyProps(
  path: string,
  data: Uint8Array<ArrayBuffer> | undefined,
  signal = new AbortController().signal,
  overrides: Partial<Pick<OfficeBodyProps, 'scrollportRef'>> = {},
): OfficeBodyProps {
  return {
    resourceAddress: `dsh-resource://file/session/office/${path}`,
    content: data === undefined ? { kind: 'text', text: '', pages: [], eof: true } : { kind: 'bytes', data },
    wrap: false,
    scrollportRef: () => {},
    sessionId: 'office' as SessionId,
    useTabInfo: () => ({ tab: { signal } }),
    useResource: () => ({ value: undefined }),
    t: (key: string, params?: Record<string, unknown>) => {
      let value = translations.get(key) ?? key
      for (const [name, param] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(param))
      return value
    },
    ...overrides,
  } as unknown as OfficeBodyProps
}

/** A ResizeObserver stand-in the spec fires by hand; jsdom ships none. */
export class FakeResizeObserver implements ResizeObserver {
  static latest: FakeResizeObserver | undefined
  static instances: FakeResizeObserver[] = []
  readonly observe: Mock<(target: Element) => void> = vi.fn()
  readonly unobserve: Mock<(target: Element) => void> = vi.fn()
  readonly disconnect: Mock<() => void> = vi.fn()
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.latest = this
    FakeResizeObserver.instances.push(this)
  }

  /** The observer watching `target`. */
  static watching(target: Element): FakeResizeObserver | undefined {
    return FakeResizeObserver.instances.find(observer => observer.observe.mock.calls.some(([observed]) => observed === target))
  }

  /** Report a size change to the observer's callback. */
  fire(): void {
    this.callback([], this)
  }
}

/** An IntersectionObserver stand-in whose entries the spec supplies; jsdom ships none. */
export class FakeIntersectionObserver {
  static latest: FakeIntersectionObserver | undefined
  readonly observed: Element[] = []
  readonly disconnect: Mock<() => void> = vi.fn()
  constructor(private readonly callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit | undefined) {
    FakeIntersectionObserver.latest = this
  }

  observe(target: Element): void { this.observed.push(target) }
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] { return [] }

  /** Report the visibility of one observed element. */
  fire(target: Element, isIntersecting: boolean): void {
    this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

/**
 * Give one element a layout width in jsdom, which lays nothing out.
 * @param element - element whose box is read.
 * @param widths - widths the element reports.
 */
export function layout(element: Element, widths: { readonly clientWidth?: () => number; readonly offsetWidth?: number }): void {
  if (widths.clientWidth !== undefined) Object.defineProperty(element, 'clientWidth', { configurable: true, get: widths.clientWidth })
  if (widths.offsetWidth !== undefined) Object.defineProperty(element, 'offsetWidth', { configurable: true, value: widths.offsetWidth })
}

/**
 * Give every element the same layout width until the returned restore runs;
 * jsdom keeps its own zero on the Element prototype underneath.
 * @param get - width every element reports.
 * @returns restore that removes the stub.
 */
export function stubClientWidth(get: () => number): () => void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get })
  return () => { delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth }
}
