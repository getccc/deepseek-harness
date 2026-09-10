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
import { DEFAULT_OFFICE_CHOICE, foldOfficeChoice, parseOfficeChoice, type OfficeChoice } from '@deepseek-ai/dsh-office'
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
   * Absolute path to the PowerPoint template every `ppt` deliverable is built
   * from. Absent when the installation stages no template; the prompt section
   * then sends the model to a template skill in the session catalog instead of
   * naming a path.
   */
  welinkinTemplatePath?: string
}

/** Config schema; the loader fills defaults before {@link apply} runs. */
export const Config: z<Config> = z.object({
  welinkinTemplatePath: z.string(),
})

/**
 * Delivery sentence shared by every file-producing kind: the Web deliverables
 * row lists only files the present tool declared, so a file written by a
 * shell command is invisible until the model declares it.
 */
const DELIVERY = ' Mentioning the path in the reply does not deliver the file; only the present call does.'

/** The office prompt-section id. */
const OFFICE_SECTION = 'office:kind'

/** The choice value, validated before a persisted projection cache seeds a fold. */
const officeChoiceSchema: ZodType<OfficeChoice> = zod.object({
  version: zod.literal(1),
  kind: zod.union([
    zod.literal('none'), zod.literal('word'), zod.literal('excel'),
    zod.literal('ppt'), zod.literal('chart'),
  ]),
}).strict()

/**
 * The prompt text one folded choice contributes.
 * @param choice - the Session's folded office choice.
 * @param welinkinTemplatePath - the configured PowerPoint template, or undefined.
 * @returns the section text, empty when the Session imposes no format.
 */
export function renderOfficeSection(choice: OfficeChoice, welinkinTemplatePath?: string): string {
  switch (choice.kind) {
    case 'none':
      return ''
    case 'word':
      return `Produce the deliverable as a Word document (.docx): write the file under the working directory with a script or command available here (python-docx, docx for Node, or a converter such as pandoc), then declare it with the present tool so the reader receives it.${DELIVERY}`
    case 'excel':
      return `Produce the deliverable as an Excel workbook (.xlsx): write the file under the working directory with a script or command available here (openpyxl, xlsx for Node, or a converter), with real cell values and formulas rather than pasted text, then declare it with the present tool so the reader receives it.${DELIVERY}`
    case 'ppt':
      // The company template is the default deck, so this kind carries it
      // rather than offering a second PowerPoint row. The skill route names
      // no brand, because the deployment names the catalog entry.
      return welinkinTemplatePath === undefined
        ? `Produce the deliverable as a PowerPoint presentation (.pptx) built from the company template. No template path is configured here, so find the template through the session skill catalog: if it lists a PowerPoint template skill, load that skill first, copy the template it names into the working directory, and edit the copy with a script available here (python-pptx or pptxgenjs), keeping its slide masters, layouts, fonts, and brand colours and replacing only the content. If the catalog lists no such skill, say that the company template is not reachable before building a plain .pptx. Declare the finished file with the present tool.${DELIVERY}`
        : `Produce the deliverable as a PowerPoint presentation (.pptx) built from the company template at ${welinkinTemplatePath}: copy the template into the working directory and edit the copy with a script available here (python-pptx or pptxgenjs), keep its slide masters, layouts, fonts, and brand colours, and replace only the content. Declare the finished file with the present tool.${DELIVERY}`
    case 'chart':
      return `Produce the deliverable as charts the reader can open from the Sidebar: render each chart to its own SVG file under the working directory with a script available here (matplotlib, plotly's static export, or hand-written SVG for simple charts), with the data embedded, axis labels, and a legend, then declare every file with the present tool. Keep the explanation in prose; do not paste chart markup or data tables into the reply.${DELIVERY}`
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
    order: ctx.systemPrompt.getSectionOrder('TEAM_POLICY') + 50,
    text: (context) => {
      if (context.agent === undefined) return ''
      return renderOfficeSection(foldOfficeChoice(context.agent.session.snapshotEvents()), config.welinkinTemplatePath)
    },
  }), 'tool-office: kind prompt section')

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'office', OfficeChoice>({
      key: 'office',
      stateSchema: officeChoiceSchema,
      init: () => DEFAULT_OFFICE_CHOICE,
      // Reads the recorded value the way the fold does, so the chip and the
      // section never disagree about a kind this build does not know.
      apply: (state, event) => event.type === 'office/kind' ? parseOfficeChoice(event.data) ?? DEFAULT_OFFICE_CHOICE : state,
      wire: { viewSchema: officeChoiceSchema, view: state => state },
      stateVersion: 1,
    })
  })
}
