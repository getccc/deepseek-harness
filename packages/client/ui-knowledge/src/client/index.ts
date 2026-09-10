/**
 * Private knowledge plugin, browser half — the `/knowledge` picker and the
 * composer chip that reports what it chose.
 *
 * Both sit over one Host fold: the picker writes a `knowledge/scope` event
 * through the Team-only `knowledge` Remote, and the chip reads the projection
 * of that same event. Nothing about the choice is kept here, so a second
 * browser, a reload, and the model all see the same scope.
 *
 * The `knowledge` namespace is mounted here rather than in the shared Client
 * assembly because only a Team Host serves it: a build without private
 * knowledge does not mount this plugin, and never grows a namespace whose
 * every call would fail.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import knowledgeRemote from '@deepseek-ai/dsh-api-knowledge-controller/remote'
import type { KnowledgeScopeView } from '@deepseek-ai/dsh-api-knowledge-controller/types'
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: the assembled Client Remote face this plugin extends.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-knowledge-controller/remote'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { KnowledgeSelect, type KnowledgeSelectInjected } from './KnowledgeSelect.tsx'
import { choiceOf, optionsOf, toggleScope, type KnowledgeChoiceRequest } from './scope.ts'
import { en, zh, type KnowledgeKey } from './locales.ts'

export { ALL_ROW_ID, chipLabel, choiceOf, chosenRows, optionsOf, toggleScope } from './scope.ts'
export type { KnowledgeChoiceRequest } from './scope.ts'
export type { KnowledgeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The knowledge picker's and composer chip's copy. */
    knowledge: KnowledgeKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'knowledge'

/** Required services: the contribution registry, the chip's slot registry, locale, and the Remote mount. */
export const inject = ['commandUi', 'locale', 'remote', 'slots']

/**
 * Client plugin body: mount the knowledge Remote namespace, then register the
 * `/knowledge` picker and the composer chip over it.
 *
 * The mount is an effect like every other contribution, so the namespace is
 * taken back down by the fiber that raised it however that fiber ends. The
 * surfaces park on `remote.knowledge`, the service the mount provides, so
 * neither exists before the namespace it calls.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.remote.$mount(knowledgeRemote), 'ui-knowledge: knowledge Remote namespace')
  ctx.inject(['commandUi', 'locale', 'remote.knowledge', 'slots'], registerUi)
}

/** Register the picker and the chip over a live `knowledge` namespace. */
function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-knowledge: dictionaries')

  // The command description and the option rows are this plugin's own copy,
  // read through the bound translate; the chip reads the standard seat.
  const t = ctx.locale.bind(NS)

  /** What one Session may choose from, and what it has chosen. */
  const view = async (sessionId: SessionId): Promise<KnowledgeScopeView> => {
    const result = await ctx.remote.knowledge.scope(sessionId)
    // Failure strings stay English (error-surface policy: not localized).
    if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
    return result.value
  }

  /** Record one Session's choice, failing loud enough for a picker to show. */
  const record = async (sessionId: SessionId, choice: KnowledgeChoiceRequest): Promise<void> => {
    const result = await ctx.remote.knowledge.choose(sessionId, choice.mode, choice.knowledgeRefs)
    if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
  }

  ctx.effect(() => (ctx.get('commandUi') as CommandUiContract).register({
    name: NS,
    description: () => t('command.description'),
    available: () => true,
    ui: {
      kind: 'popupMultiSelect',
      options: async session => optionsOf(await view(session.sessionId), t),
      onApply: async (options, session) => { await record(session.sessionId, choiceOf(options)) },
    },
  }), 'ui-knowledge: /knowledge contribution')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: NS,
    // After the shipped composer controls, which every conversation has;
    // knowledge is the one a deployment adds.
    order: 100,
    locale: NS,
    inject: (sessionId: SessionId): KnowledgeSelectInjected => ({
      choices: async () => (await view(sessionId)).choices,
      // Read the choice in force from the same directory read, so a click
      // never rebuilds it from a projection this control has not seen yet.
      apply: async (clicked) => {
        await record(sessionId, toggleScope((await view(sessionId)).scope, clicked))
      },
    }),
  }, KnowledgeSelect))
}
