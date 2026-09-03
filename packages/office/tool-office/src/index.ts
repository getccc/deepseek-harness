/**
 * Office-deliverable choice, model-facing half: the prompt section the choice
 * folds into, and the projection a composer control reads.
 *
 * The choice reaches the model only as prompt text naming the document kind to
 * produce; a composer chip reads the same fold as a projection so the picker
 * and the model never disagree. Recording a choice is the Remote's job
 * (`@deepseek-ai/dsh-api-office-controller`), because the browser cannot append
 * a Session event directly.
 * @module @deepseek-ai/dsh-tool-office
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod, type ZodType } from 'zod'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import { DEFAULT_OFFICE_CHOICE, foldOfficeChoice, type OfficeChoice } from '@deepseek-ai/dsh-office'
// Type-only: pulls the section-context `agent` merge and the projection registry.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
// Value import loads the SessionProjectionMap merge this package owns.
import './types.ts'

/** Stable Cordis plugin name. */
export const name = 'tool-office'

/** Service the prompt section needs; the projection registers when a registry exists. */
export const inject = ['systemPrompt']

/** Deployment-varying office facts. */
export interface Config {
  /**
   * Absolute path to the AMEC PowerPoint template the `amec-ppt` kind builds
   * from. Absent when a build carries no template; the prompt section then
   * asks for the AMEC brand style instead of an import.
   */
  amecTemplatePath?: string
}

/** Config schema; the loader fills defaults before {@link apply} runs. */
export const Config: z<Config> = z.object({
  amecTemplatePath: z.string(),
})

/** The office prompt-section id. */
const OFFICE_SECTION = 'office:kind'

/** The choice value, validated before a persisted projection cache seeds a fold. */
const officeChoiceSchema: ZodType<OfficeChoice> = zod.object({
  version: zod.literal(1),
  kind: zod.union([
    zod.literal('none'), zod.literal('word'), zod.literal('excel'),
    zod.literal('ppt'), zod.literal('amec-ppt'), zod.literal('chart'),
  ]),
}).strict()

/**
 * The prompt text one folded choice contributes.
 * @param choice - the Session's folded office choice.
 * @param amecTemplatePath - the configured AMEC template, or undefined.
 * @returns the section text, empty when the Session imposes no format.
 */
export function renderOfficeSection(choice: OfficeChoice, amecTemplatePath?: string): string {
  switch (choice.kind) {
    case 'none':
      return ''
    case 'word':
      return 'Produce the deliverable as a Word document (.docx) with the univer office tools: create or import a .docx Unit, edit it there, and hand back the file.'
    case 'excel':
      return 'Produce the deliverable as an Excel workbook (.xlsx) with the univer office tools: create or import a .xlsx Unit, fill the sheets there, and hand back the file.'
    case 'ppt':
      return 'Produce the deliverable as a PowerPoint presentation (.pptx) with the univer office tools: create or import a .pptx Unit, build the slides there, and hand back the file.'
    case 'amec-ppt':
      return amecTemplatePath === undefined
        ? 'Produce the deliverable as a PowerPoint presentation in the AMEC company style — dark navy (#0A1E3A) with a tech-blue gradient (#0066CC to #00A3E0) and the Microsoft YaHei font — using the univer office tools. This build carries no AMEC template file, so build the deck to match that style.'
        : `Produce the deliverable as a PowerPoint presentation built from the AMEC company template at ${amecTemplatePath}: import it with the univer office tools as the starting Unit, keep its slide masters, layouts, fonts, and brand colours, and replace only the content. Hand back the .pptx.`
    case 'chart':
      return 'Produce the deliverable as interactive charts in the answer itself. Write one fenced code block per chart whose info string is exactly `echarts`, holding nothing but a strict-JSON Apache ECharts option: double-quoted keys and strings, no comments, no trailing commas, and no JavaScript functions, expressions, `renderItem`, or event handlers. String formatters such as "{value}%" are supported. Keep the explanation in prose outside the fence.'
  }
}

/**
 * Register the office prompt section and projection.
 * @param ctx - Host plugin context carrying the prompt registry.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: OFFICE_SECTION,
    // A deliverable-format instruction is deployment policy, like the Team
    // policy section it sits beside, not a tool description.
    order: FIRST_PARTY_SECTION_ORDER.TEAM_POLICY + 50,
    text: (context) => {
      if (context.agent === undefined) return ''
      return renderOfficeSection(foldOfficeChoice(context.agent.session.events), config.amecTemplatePath)
    },
  }), 'tool-office: kind prompt section')

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'office', OfficeChoice>({
      key: 'office',
      stateSchema: officeChoiceSchema,
      init: () => DEFAULT_OFFICE_CHOICE,
      apply: (state, event) => event.type === 'office/kind' ? event.data : state,
      wire: { viewSchema: officeChoiceSchema, view: state => state },
      stateVersion: 1,
    })
  })
}
