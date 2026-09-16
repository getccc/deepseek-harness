/** The two navigation rows' glyphs: the sidebar owns the row, each entry owns its icon. */

import { IconDataOutline16, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the sidebar SlotMap merge (the panel-row list seat).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/**
 * The knowledge-base row's glyph: the one the composer's knowledge chip wears,
 * so the row and the control name the same knowledge.
 * @param props - the sidebar row's requested icon size.
 * @returns the icon element.
 */
export function KnowledgeBasesGlyph({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconDataOutline16 size={size} />
}

/**
 * The retrieval row's glyph.
 * @param props - the sidebar row's requested icon size.
 * @returns the icon element.
 */
export function KnowledgeSearchGlyph({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconSearchOutline16 size={size} />
}
