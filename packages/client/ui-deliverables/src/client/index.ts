/**
 * Deliverables plugin, browser half: registers the produced-files row into
 * the chat view's turn-tail chain, provides the `chatFileMentions` service
 * that links inline-code mentions of produced files in the closing prose,
 * and provides the `deliverables` service through which another plugin
 * teaches the vocabulary a tool of its own. All policy lives here — the
 * first-party mutation calls, mention matching, the document card set, chip
 * cap, and copy — so composing this plugin out of cordis.yml removes every
 * surface; the owning view renders an empty chain and inert prose at zero
 * cost.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ProducedFiles } from './ProducedFiles.tsx'
import { en, NS, zh, type DeliverablesKey } from './locales.ts'
import {
  createDeliverablesDefinition, FIRST_PARTY_MUTATION_TOOLS, producedFileMentions, selectProducedFiles,
  type ProducedFileRecognizer,
} from './turn-deliverables.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Produced-files row copy. */
    'deliverables': DeliverablesKey
  }
}

/** The face another plugin uses to add a tool to the produced-files vocabulary. */
export interface DeliverablesService {
  /**
   * Teach the vocabulary one more tool: every successful call whose arguments
   * the recognizer reads as a path lists that path in the turn's row, exactly
   * as a first-party `write` does.
   * @param recognizer - the tool and how one call names the file it produced.
   * @returns the disposer that forgets the tool again.
   * @throws {Error} when the tool is a first-party mutation tool or already recognized.
   */
  recognize(recognizer: ProducedFileRecognizer): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Produced-files vocabulary extension face. */
    deliverables: DeliverablesService
  }
}

export { ProducedFiles, type ProducedFilesProps } from './ProducedFiles.tsx'
export {
  documentKind, extensionOf, producedForClosing,
  type DocumentKind, type ProducedFileRecognizer,
} from './turn-deliverables.ts'

/**
 * Chain rank of the produced-files entry. A plugin that renders its own row
 * twin registers below the default `0`; this entry sits lower still so the
 * document cards are what a member sees, while every click still leaves
 * through the Workspace opener that such a plugin wraps.
 */
export const TURN_TAIL_PRIORITY = -10

/** Required services for the tail-slot registration and its dictionaries. */
export const inject = ['slots', 'locale', 'uiConversation', 'remote', 'remote.session']

/**
 * Client plugin body: register the dictionaries and the turn-tail entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const workspacePathOpen = createSnapshotStore<boolean | undefined>(undefined)
  let requestedWorkspacePathOpen = false
  let capabilityRevision = 0
  let pendingCapability: Promise<void> | undefined
  const loadWorkspacePathOpen = (): void => {
    if (pendingCapability !== undefined) return
    const revision = capabilityRevision
    const pending = ctx.remote.session.canOpenWorkspacePath()
      .then((result) => {
        if (revision === capabilityRevision) workspacePathOpen.set(result.ok && result.value)
      })
      .finally(() => {
        if (pendingCapability === pending) pendingCapability = undefined
      })
    pendingCapability = pending
  }
  const ensureWorkspacePathOpen = (): void => {
    requestedWorkspacePathOpen = true
    if (workspacePathOpen.getSnapshot() === undefined) loadWorkspacePathOpen()
  }
  ctx.on('connection/reset', () => {
    capabilityRevision++
    pendingCapability = undefined
    workspacePathOpen.set(undefined)
    if (requestedWorkspacePathOpen) loadWorkspacePathOpen()
  })
  // The Definition reads the live recognizer set on every fold, and is
  // re-registered whenever that set changes so an already-assembled
  // conversation folds again with the tool it just learned.
  const recognizers = new Map<string, ProducedFileRecognizer>()
  let disposeDefinition = registerDefinition()
  function registerDefinition(): () => void {
    return ctx.uiConversation.events.register(createDeliverablesDefinition(recognizers))
  }
  const refold = (): void => {
    disposeDefinition()
    disposeDefinition = registerDefinition()
  }
  ctx.effect(() => () => { disposeDefinition() }, 'ui-deliverables: definition')
  const service: DeliverablesService = {
    recognize(recognizer) {
      if (FIRST_PARTY_MUTATION_TOOLS.has(recognizer.tool) || recognizers.has(recognizer.tool)) {
        throw new Error(`ui-deliverables: tool "${recognizer.tool}" is already recognized`)
      }
      const dispose = ctx.effect(() => {
        recognizers.set(recognizer.tool, recognizer)
        refold()
        return () => {
          recognizers.delete(recognizer.tool)
          refold()
        }
      }, `ui-deliverables: recognize ${recognizer.tool}`)
      return () => { void dispose() }
    },
  }
  ctx.provide('deliverables', service)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-deliverables: dictionaries')
  ctx.slots.inject(
    'conversation.chat.turnTail',
    () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: selectProducedFiles,
      priority: TURN_TAIL_PRIORITY,
      registrant: '@deepseek-ai/dsh-client-ui-deliverables',
      locale: NS,
      inject: () => ({
        isLoopback: ctx.remote.$host.isLoopback,
        ensureWorkspacePathOpen,
        hooks: { workspacePathOpen },
      }),
    }, ProducedFiles),
  )
  // The prose side of the same vocabulary: the chat view reaches this face
  // via ctx.get, so its absence — this plugin composed out — is the off state.
  const t = ctx.locale.bind(NS)
  const mentions: ChatFileMentions = {
    forClosing(owner) {
      // Same claim test the turn-tail chain entry runs: no produced files,
      // no vocabulary — the two surfaces agree by construction.
      const paths = selectProducedFiles(owner)
      if (paths === null) return undefined
      return producedFileMentions(paths, owner.openFile, path => t('produced.open', { name: path }))
    },
  }
  ctx.provide('chatFileMentions', mentions)
}
