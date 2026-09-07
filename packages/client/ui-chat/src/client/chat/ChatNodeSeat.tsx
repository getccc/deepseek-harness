import { memo, useCallback, useMemo } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps, RenderAssistantIdentity } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import {
  decodeTurnProcess, TURN_PROCESS_INDEPENDENT_KINDS, turnProcessGeneration,
} from '../contract/turn-process.ts'
import { storedTurnProcessEntry } from '../stores.ts'
import { useSearchableHidden } from './searchable-hidden.ts'
import { turnActivityLead, turnProcessLayout } from './turn-activity.ts'
import { TurnActivityHeader } from './TurnActivityHeader.tsx'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly nodeKey: string
  readonly historyIncomplete: boolean
  readonly compactTranscript: boolean
  /** The identity header, rendered once per Turn by the seat of its leading activity row. */
  readonly renderIdentity: RenderAssistantIdentity
  readonly useChat: ChatViewSlotProps['useChat']
  readonly useStore: ChatViewSlotProps['useStore']
  readonly actions: ChatViewSlotProps['actions']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

const EMPTY_PROCESS_KEYS: readonly string[] = []

/** Subscribe, apply Turn-process visibility, and dispatch one stable Context key. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, historyIncomplete, compactTranscript,
  selectedCallId, cwd, openFile, inspectCall, forkAt,
  renderMessageImages, renderIdentity, fileMentions, useChat, useStore, actions, renderSlot, t,
}: ChatNodeSeatProps) {
  const node = useChat(snapshot => snapshot.nodes.get(nodeKey))
  const processSignature = useChat((snapshot) => {
    const current = snapshot.nodes.get(nodeKey)
    const location = current?.location
    return location?.kind === 'turn' || location?.kind === 'step'
      ? location.turn.data.get('turn-process')
      : undefined
  })
  const processSpec = useMemo(
    () => processSignature === undefined ? undefined : decodeTurnProcess(processSignature),
    [processSignature],
  )
  const nodeStore = useChat(snapshot => snapshot.nodes)
  const processLayoutKeys = useChat((snapshot) => {
    if (!compactTranscript || historyIncomplete || processSpec === undefined) return EMPTY_PROCESS_KEYS
    const current = snapshot.nodes.get(nodeKey) as ChatNode | undefined
    const location = current?.location
    if (current === undefined
      || (location?.kind !== 'turn' && location?.kind !== 'step')
      || location.turn.status !== 'closed'
      || location.turn.turn !== processSpec.turn) return EMPTY_PROCESS_KEYS
    const ownsLayout = current.kind === 'turn-process'
      || (current.kind === 'assistant-step' && current.data.step === processSpec.answerStep)
    return ownsLayout ? snapshot.locations.getTurn(processSpec.turn) : EMPTY_PROCESS_KEYS
  })
  const processLayout = useMemo(
    () => processSpec === undefined || processLayoutKeys.length === 0
      ? undefined
      : turnProcessLayout(processLayoutKeys, nodeStore, processSpec),
    [nodeStore, processLayoutKeys, processSpec],
  )
  const processGeneration = useMemo(
    () => processSpec === undefined ? undefined : turnProcessGeneration(processSpec),
    [processSpec],
  )
  // Only the Turn's leading seat renders the identity header. The selector
  // yields the Turn for this seat alone (the resolved Turn is reference-stable),
  // so a Turn's other seats do not re-render as the Turn grows.
  const leadTurn = useChat((snapshot) => {
    const location = (snapshot.nodes.get(nodeKey) as ChatNode | undefined)?.location
    if (location?.kind !== 'turn' && location?.kind !== 'step') return undefined
    const signature = location.turn.data.get('turn-process')
    const spec = signature === undefined ? undefined : decodeTurnProcess(signature)
    const windowReady = spec !== undefined
      && compactTranscript
      && !historyIncomplete
      && location.turn.status === 'closed'
      && spec.answerAnchorSeq !== null
    const lead = turnActivityLead(
      snapshot.locations.getTurn(location.turn.turn), snapshot.nodes, windowReady ? spec : undefined,
    )
    return lead === nodeKey ? location.turn : undefined
  })
  const storedEntry = useStore(state => processSpec === undefined
    ? undefined
    : storedTurnProcessEntry(state, processSpec.turn))
  const processEntry = storedEntry?.generation === processGeneration ? storedEntry : undefined
  const processOpen = processEntry !== undefined
  const setOpen = useCallback((open: boolean) => {
    if (processGeneration !== undefined && processSpec !== undefined) {
      actions.setTurnProcessOpen(processSpec.turn, processGeneration, open)
    }
  }, [actions, processGeneration, processSpec])
  const routedNode = node as ChatNode | undefined
  const sameTurn = routedNode !== undefined
    && processSpec !== undefined
    && (routedNode.location.kind === 'turn' || routedNode.location.kind === 'step')
    && routedNode.location.turn.turn === processSpec.turn
  const turnClosed = sameTurn
    && routedNode.location.turn.status === 'closed'
  const processWindowReady = processSpec !== undefined
    && compactTranscript
    && processSpec.answerAnchorSeq !== null
    && turnClosed
    && !historyIncomplete
  const processMember = sameTurn
    && processWindowReady
    && !TURN_PROCESS_INDEPENDENT_KINDS.has(routedNode.kind)
    && routedNode.anchorSeq >= processSpec.processStartSeq
    && routedNode.anchorSeq < processSpec.answerAnchorSeq
  const processAnswer = sameTurn
    && processWindowReady
    && routedNode.kind === 'assistant-step'
    && routedNode.data.step === processSpec.answerStep
  const ownsDisclosure = routedNode?.kind === 'turn-process' || processAnswer
  const foldable = processWindowReady
    && (processMember || (ownsDisclosure
      && ((processLayout?.hasExternalProcess ?? false) || processSpec.inlineReasoning)))
  const turnProcess = useMemo(() => processGeneration === undefined || processSpec === undefined
    ? undefined
    : {
      spec: processSpec,
      foldable,
      open: processOpen,
      setOpen,
    }, [
    foldable, processGeneration, processOpen, processSpec, setOpen,
  ])
  const controllerInactive = routedNode?.kind === 'turn-process'
    && !foldable
  const compactAnswer = processAnswer
    && foldable
    && processLayout?.compactAnswer === true
    && !processOpen
  const processHidden = controllerInactive || (foldable && processMember && !processOpen)
  const revealProcess = useCallback(() => {
    if (processMember) setOpen(true)
  }, [processMember, setOpen])
  const wrapperRef = useSearchableHidden(processHidden, revealProcess)
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      selectedCallId,
      cwd,
      openFile,
      inspectCall,
      forkAt,
      renderMessageImages,
      fileMentions,
      turnProcess,
    }, [
    node, selectedCallId, cwd, openFile, inspectCall, forkAt,
    renderMessageImages, fileMentions, turnProcess,
  ])
  if (routedNode === undefined || owner === null) return null
  const location = routedNode.location
  const turn = location.kind === 'turn' || location.kind === 'step'
    ? location.turn.turn
    : undefined
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  return (
    <div
      ref={wrapperRef}
      className={css.flowItem}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
      data-chat-turn={turn}
      data-turn-process-member={processMember || undefined}
      data-turn-process-hidden={processHidden || undefined}
      data-turn-process-answer={compactAnswer || undefined}
    >
      {leadTurn !== undefined && (
        <TurnActivityHeader
          turn={leadTurn}
          stepTime={routedNode.kind === 'assistant-step' ? routedNode.data.time : undefined}
          renderIdentity={renderIdentity}
          t={t}
        />
      )}
      {renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: nodeKey,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routedNode.kind })}
            payload={routedNode.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      })}
    </div>
  )
})
