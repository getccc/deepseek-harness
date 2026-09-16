/** Complete-document view slot: a document an owner already holds, drawn outside any Sidebar tab. */
import type { ChainSelect } from '@deepseek-ai/dsh-client-ui-slots'
import { documentFileName, matchedSuffixLength } from './suffix.ts'

/**
 * One complete document as its owner holds it. Text is the whole document;
 * bytes are the whole file. Byte arrays are transient UI input, never
 * persisted layout or Session data.
 */
export type DocumentViewContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bytes'; readonly data: Uint8Array<ArrayBuffer> }

/** What the owner of a `document.view` occurrence passes to every entry's selector. */
export interface DocumentViewOwnerProps {
  /** The document's file name; its suffix is what an entry's selector matches. */
  readonly fileName: string
  readonly content: DocumentViewContent
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One complete document drawn by whichever implementation claims its file
     * name and content kind. Entry selectors run in chain order; the first
     * non-null result renders that entry with the result as `matched`, and
     * with no claiming entry the owner's fallback renders.
     */
    'document.view': { kind: 'chain'; scope: 'root'; owner: DocumentViewOwnerProps }
  }
}

/**
 * Claim whole text documents whose file name ends in a declared suffix.
 * @param extensions - suffixes the implementation draws, as its preview metadata declares them.
 * @returns a pure selector answering the text, or null to pass the document on.
 */
export function selectViewText(extensions: readonly string[]): ChainSelect<DocumentViewOwnerProps, string> {
  return ({ fileName, content }) =>
    content.kind === 'text' && matchedSuffixLength(documentFileName(fileName), extensions) > 0 ? content.text : null
}

/**
 * Claim complete files whose file name ends in a declared suffix.
 * @param extensions - suffixes the implementation draws, as its preview metadata declares them.
 * @returns a pure selector answering the bytes, or null to pass the document on.
 */
export function selectViewBytes(extensions: readonly string[]): ChainSelect<DocumentViewOwnerProps, Uint8Array<ArrayBuffer>> {
  return ({ fileName, content }) =>
    content.kind === 'bytes' && matchedSuffixLength(documentFileName(fileName), extensions) > 0 ? content.data : null
}
