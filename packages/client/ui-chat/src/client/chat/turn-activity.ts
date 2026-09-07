import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatNodeStore } from '../contract/snapshot.ts'
import { TURN_PROCESS_INDEPENDENT_KINDS, type TurnProcessSpec } from '../contract/turn-process.ts'

/** Disclosure facts derived from one content-revisioned Turn index. */
export interface TurnProcessLayout {
  readonly hasExternalProcess: boolean
  readonly compactAnswer: boolean
}

/** Rows that come before a Turn's assistant activity: the words it answers and the prompt it answers under. */
const PRECEDING_KINDS: ReadonlySet<string> = new Set(['system-prompt', 'user', 'steering'])

function turnProcessOpeningHumanAnchor(
  keys: readonly string[],
  nodes: ChatNodeStore,
  spec: TurnProcessSpec,
): number | undefined {
  let anchor: number | undefined
  for (const key of keys) {
    const node = nodes.get(key) as ChatNode | undefined
    if ((node?.kind === 'user' || node?.kind === 'steering')
      && node.anchorSeq < spec.controlAnchorSeq) {
      anchor = Math.min(anchor ?? node.anchorSeq, node.anchorSeq)
    }
  }
  return anchor
}

/**
 * Derive disclosure facts from one content-revisioned Turn index.
 * @param keys - the Turn's ordered Chat Node keys.
 * @param nodes - the live Chat Node store.
 * @param spec - the Turn's process specification.
 * @returns whether process rows exist outside the answer step, and whether the answer is compact.
 */
export function turnProcessLayout(
  keys: readonly string[],
  nodes: ChatNodeStore,
  spec: TurnProcessSpec,
): TurnProcessLayout {
  let hasExternalProcess = false
  let compactAnswer = true
  const openingHumanAnchor = turnProcessOpeningHumanAnchor(keys, nodes, spec)
  for (const key of keys) {
    const node = nodes.get(key) as ChatNode | undefined
    if (node === undefined || node.kind === 'turn-process') continue
    if ((node.kind === 'user' || node.kind === 'steering')
      && (openingHumanAnchor === undefined || node.anchorSeq > openingHumanAnchor)
      && (spec.answerAnchorSeq === null || node.anchorSeq < spec.answerAnchorSeq)) {
      compactAnswer = false
    }
    if (TURN_PROCESS_INDEPENDENT_KINDS.has(node.kind)
      || node.anchorSeq < spec.processStartSeq
      || (spec.answerAnchorSeq !== null && node.anchorSeq >= spec.answerAnchorSeq)) continue
    if (node.kind !== 'assistant-step' || spec.answerStep === null || node.data.step !== spec.answerStep) {
      hasExternalProcess = true
    }
  }
  return { hasExternalProcess, compactAnswer }
}

/**
 * Key of the row that opens a Turn's assistant activity: the first row after
 * the member's words that the reader sees. The Turn-process control anchors
 * before every process row, so it leads whenever it is shown; otherwise the
 * first other row leads, whether injected context, a retry, or the first
 * Assistant step. Under a shown control, the folded process rows below it are
 * not candidates.
 * @param keys - the Turn's ordered Chat Node keys.
 * @param nodes - the live Chat Node store.
 * @param spec - the Turn's process specification, passed only while its
 * process window is ready, so the control may be shown.
 * @returns the leading key, or undefined for a Turn with only the member's words so far.
 */
export function turnActivityLead(
  keys: readonly string[],
  nodes: ChatNodeStore,
  spec: TurnProcessSpec | undefined,
): string | undefined {
  const controlShown = spec !== undefined
    && (spec.inlineReasoning || turnProcessLayout(keys, nodes, spec).hasExternalProcess)
  for (const key of keys) {
    const node = nodes.get(key) as ChatNode | undefined
    if (node === undefined || PRECEDING_KINDS.has(node.kind)) continue
    if (node.kind !== 'turn-process') return key
    if (controlShown) return key
  }
  return undefined
}
