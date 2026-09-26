import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatNodeStore } from '../contract/snapshot.ts'

/**
 * Rows that come before a Turn's assistant activity: the words it answers, the
 * notice that woke it, and the prompt it answers under.
 */
const PRECEDING_KINDS: ReadonlySet<string> = new Set(['system-prompt', 'user', 'steering', 'turn-trigger'])

/**
 * Key of the row that opens a Turn's assistant activity: the first row after
 * the member's words that the reader sees. The Turn-process control anchors
 * before every process row, so it leads whenever it is shown; otherwise the
 * first other row leads, whether injected context, a retry, or the first
 * Assistant step. Under a shown control, the folded process rows below it are
 * not candidates.
 * @param keys - the Turn's ordered Chat Node keys.
 * @param nodes - the live Chat Node store.
 * @param controlShown - whether the Turn-process control is rendered for this
 * Turn: the loaded window holds the Turn's start or its end.
 * @returns the leading key, or undefined for a Turn with only the member's words so far.
 */
export function turnActivityLead(
  keys: readonly string[],
  nodes: ChatNodeStore,
  controlShown: boolean,
): string | undefined {
  for (const key of keys) {
    const node = nodes.get(key) as ChatNode | undefined
    if (node === undefined || PRECEDING_KINDS.has(node.kind)) continue
    if (node.kind !== 'turn-process') return key
    if (controlShown) return key
  }
  return undefined
}

/**
 * Whether one seat of a leading Chat Node draws the Turn's identity header.
 * An Assistant step with non-blank reasoning and a reply renders twice: a
 * `reasoning` seat inside its process group, then a `response` seat after it.
 * The header belongs to the first seat, so a Node never draws it twice.
 * @param node - the leading Node.
 * @param groupPart - the seat's part of that Node, when it is split.
 * @returns whether this seat renders the header.
 */
export function leadsFromSeat(node: ChatNode | undefined, groupPart: string | undefined): boolean {
  if (groupPart !== 'response' || node?.kind !== 'assistant-step') return true
  return !node.data.blocks.some(block => block.kind === 'reasoning' && block.text.trim() !== '')
}
