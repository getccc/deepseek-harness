/** What every office body shares: its props, its load states, the bytes it renders, and size observation. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '../locales.ts'

/** Standard document props plus the office renderers' dictionary. */
export type OfficeBodyProps = DocumentPreviewProps & PropsLocale<'sidebarOffice'>

/** Outcome of rendering one byte array; a state for other bytes is stale. */
export type RenderState =
  | { readonly kind: 'loading'; readonly data: Uint8Array<ArrayBuffer> }
  | { readonly kind: 'ready'; readonly data: Uint8Array<ArrayBuffer> }
  | { readonly kind: 'failed'; readonly data: Uint8Array<ArrayBuffer> }

/**
 * The complete bytes a body may render, or undefined for content the owner
 * delivered as text pages.
 * @param props - standard document props.
 * @returns the byte array, or undefined.
 */
export function bytesOf(props: DocumentPreviewProps): Uint8Array<ArrayBuffer> | undefined {
  return props.content.kind === 'bytes' ? props.content.data : undefined
}

/**
 * A standalone copy of the bytes as an ArrayBuffer, for parsers that take
 * ownership of the buffer they receive.
 * @param data - the owner's byte view, possibly a window onto a larger buffer.
 * @returns a fresh buffer holding exactly those bytes.
 */
export function bufferOf(data: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return data.slice().buffer
}

/**
 * Run `onResize` whenever the element's box changes, where the browser reports
 * resizes; a browser without ResizeObserver keeps the layout measured at mount.
 * @param target - element whose box is watched.
 * @param onResize - called after each size change.
 * @returns disposer that stops watching.
 */
export function observeResize(target: Element, onResize: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  const observer = new ResizeObserver(onResize)
  observer.observe(target)
  return () => { observer.disconnect() }
}
