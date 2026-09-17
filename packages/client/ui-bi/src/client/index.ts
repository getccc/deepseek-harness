/**
 * BI analysis plugin, browser half — the chip the coming BI-analysis
 * capability will drive, in the composer tool row after the office chip.
 *
 * It is placed and inert. The seat, its order among the sibling chips, and the
 * copy are what this plugin settles now; the chip says through `aria-disabled`
 * and its tooltip that the capability is not built, so the row a member sees
 * is the row the feature will arrive into. It holds no state, reads no
 * projection, and calls no Remote.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { BiAnalysisChip } from './BiAnalysisChip.tsx'
import { en, zh, type BiKey } from './locales.ts'

export type { BiKey } from './locales.ts'
export type { BiAnalysisChipProps } from './BiAnalysisChip.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer BI-analysis chip's copy. */
    bi: BiKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'bi'

/** Required services: the chip's slot registry and the locale registry. */
export const inject = ['locale', 'slots']

/**
 * Client plugin body: register the BI-analysis chip.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-bi: dictionaries')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: NS,
    // After the office chip at 110: BI analysis is the next choice a Team
    // deployment adds to the work composer, and a member reads it where the
    // design puts it, to the right of 办公.
    order: 120,
    locale: NS,
  }, BiAnalysisChip))
}
