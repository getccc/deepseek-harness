/**
 * Turn-scoped produced-file Definition and readers. Client-only and
 * model-free: the vocabulary comes from successful first-party mutation
 * calls and from the tools other plugins teach it, never presentation data
 * or the closing prose.
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationMatch, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'

interface ProducedPath {
  readonly seq: number
  readonly path: string
}

/** Immutable produced-file facts published against one Turn. */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this Turn. */
    deliverables: DeliverablesTurnData
  }
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, string | null>
}

/** One tool the deliverables vocabulary reads beyond the first-party mutation tools. */
export interface ProducedFileRecognizer {
  /** Wire tool name whose successful calls produce a file. */
  readonly tool: string
  /**
   * The path one call produced, read from its parsed JSON arguments.
   * @param args - the call's arguments, already parsed into an object.
   * @returns the produced path, or null when this call produced no file.
   */
  path(args: Readonly<Record<string, unknown>>): string | null
}

/** The recognizers the Definition consults at fold time, keyed by tool name. */
export type ProducedFileRecognizers = ReadonlyMap<string, ProducedFileRecognizer>

/** Tools the first-party vocabulary reads itself; a recognizer may not claim one. */
export const FIRST_PARTY_MUTATION_TOOLS: ReadonlySet<string> = new Set(['write', 'edit', 'str_replace_editor'])

/**
 * Extract the path from a supported mutation call: a first-party mutation
 * tool, or a tool a registered recognizer reads. Session `tool/call` events
 * are root calls; Code Dispatch children do not enter this Definition
 * independently.
 * @param name - wire tool name.
 * @param argsRaw - model-produced JSON arguments.
 * @param recognizers - the tools other plugins taught the vocabulary.
 * @returns the mutation path, or null when the call is not a supported mutation.
 */
function mutationPath(name: string, argsRaw: string, recognizers: ProducedFileRecognizers): string | null {
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    return null
  }
  if (!isRecord(args)) return null
  switch (name) {
    case 'write':
      return typeof args.content === 'string' ? pathValue(args.file_path) : null
    case 'edit':
      return validEditArgs(args) ? pathValue(args.file_path) : null
    case 'str_replace_editor':
      return editorMutationPath(args)
    default: {
      // A recognizer's answer passes the same blank-path test as a first-party
      // argument: the vocabulary never lists a file nothing can open.
      const recognized = recognizers.get(name)?.path(args)
      return recognized === undefined ? null : pathValue(recognized)
    }
  }
}

/** Validate the fields that an `edit` execution requires. */
function validEditArgs(args: Readonly<Record<string, unknown>>): boolean {
  return typeof args.old_string === 'string'
    && args.old_string.length > 0
    && typeof args.new_string === 'string'
    && args.old_string !== args.new_string
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')
}

/** Extract a path only from a complete mutating editor command. */
function editorMutationPath(args: Readonly<Record<string, unknown>>): string | null {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string' ? path : null
    case 'str_replace':
      return typeof args.old_str === 'string'
        && args.old_str.length > 0
        && (args.new_str === undefined || typeof args.new_str === 'string')
        ? path
        : null
    case 'insert':
      return typeof args.insert_line === 'number'
        && Number.isInteger(args.insert_line)
        && args.insert_line >= 0
        && typeof args.new_str === 'string'
        ? path
        : null
    default:
      return null
  }
}

/** A non-blank path preserves the exact spelling supplied to the tool. */
function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** Narrow parsed JSON to an argument object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Files produced by one Turn data value.
 *
 * The source is the arguments of successful `write`, `edit`, and mutating
 * `str_replace_editor` calls, not the closing prose: a produced file must be
 * listed whether or not the model remembered to name it. Reads, unsupported
 * tools, malformed calls, and failed results contribute nothing. Paths keep
 * first-seen order and appear once, so a file written and then edited in the
 * same turn is one entry.
 *
 * The Conversation Location index owns turn membership before this function
 * runs, so paths cannot spill across turns and this derivation does not infer
 * boundaries from neighboring presentation Nodes.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
 */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/**
 * Claim the turn-tail chain only when its closing turn produced files.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced paths as the component's match, or null to decline before mount.
 */
export function selectProducedFiles(owner: TurnTailOwnerProps): readonly string[] | null {
  const paths = producedForClosing(owner.turn.data.get('deliverables'), owner.seq)
  return paths.length === 0 ? null : paths
}

/**
 * Turn-local successful mutation accumulator; it publishes no view Node.
 * @param recognizers - live recognizer set; the Definition reads it on every fold.
 * @returns the Definition to register with the Conversation event registry.
 */
export function createDeliverablesDefinition(
  recognizers: ProducedFileRecognizers,
): ConversationNodeDefinition<DeliverablesState> {
  return {
    ...deliverablesDefinitionBase,
    update: (context, match) => {
      if (match.event.type === 'tool/call') {
        const calls = new Map(context.state.calls)
        calls.set(
          String(match.event.data.callId),
          mutationPath(match.event.data.name, match.event.data.arguments, recognizers),
        )
        return { ...context.state, calls }
      }
      return settleResult(context.state, match)
    },
  }
}

/** Record a successful settlement's path against the call that produced it. */
function settleResult(state: DeliverablesState, match: ConversationMatch): DeliverablesState {
  if (match.event.type !== 'tool/result') return state
  const result = match.event.data.message.content[0]
  if (result.isError === true) return state
  const callId = String(match.event.data.message.source.callId)
  const path = state.calls.get(callId)
  return path === null || path === undefined
    ? state
    : { ...state, produced: [...state.produced, { seq: match.event.seq, path }] }
}

/** The recognizer-independent half of the Definition. */
const deliverablesDefinitionBase: Omit<ConversationNodeDefinition<DeliverablesState>, 'update'> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [] }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
      kind: 'turn',
      turn: context.state.turn,
      key: 'deliverables',
      value: { produced: context.state.produced },
    },
}

/**
 * Trailing path segment, the part that identifies the file at a glance.
 * @param path - Slash- or backslash-separated path.
 * @returns The final segment, or the whole string when separator-free.
 */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * Lowercase extension of a path, without its dot.
 * @param path - Slash- or backslash-separated path.
 * @returns The extension, or an empty string when the basename has none.
 */
export function extensionOf(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** The document families a produced file can read as; each gets its own card tile. */
export type DocumentKind = 'text' | 'word' | 'sheet' | 'slides' | 'pdf'

/** Extensions that read as a document a person opens to review, and the family each names. */
const DOCUMENT_KINDS: ReadonlyMap<string, DocumentKind> = new Map([
  ['md', 'text'], ['markdown', 'text'],
  ['docx', 'word'], ['doc', 'word'],
  ['xlsx', 'sheet'], ['xls', 'sheet'], ['csv', 'sheet'],
  ['pptx', 'slides'], ['ppt', 'slides'],
  ['pdf', 'pdf'],
])

/**
 * The document family a path's extension names.
 *
 * Documents are what a turn hands back to be read — a report, a workbook, a
 * deck — and each is shown as a card that opens its preview; every other
 * produced file stays a chip in the one-line lane.
 * @param path - Slash- or backslash-separated path.
 * @returns The family, or undefined for a file that is not a document.
 */
export function documentKind(path: string): DocumentKind | undefined {
  return DOCUMENT_KINDS.get(extensionOf(path))
}

/**
 * File-mention vocabulary over one turn's produced paths, for the closing
 * message's prose: an inline-code token opens the file it names. A token
 * resolves by exact path, or by being exactly the basename of exactly one
 * produced path — a basename two paths share stays inert rather than
 * guessing, so a mention link can never open the wrong file or 404.
 * @param paths - The turn's produced paths (tool order, already deduped).
 * @param openFile - The chat view's file opener.
 * @param label - Localizes the accessible open-label for a resolved path.
 * @returns The resolver MarkdownText consumes; the full path rides `title`,
 * the same disambiguator the row's chips carry.
 */
export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): MarkdownFileMentions {
  return {
    resolve(value) {
      const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value)
      if (path === undefined) return undefined
      return { open: () => { openFile(path) }, label: label(path), title: path }
    },
  }
}

/** The single produced path whose basename is exactly `value`, else undefined. */
function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}
