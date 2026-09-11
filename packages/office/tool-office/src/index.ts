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
  /**
   * Name of the session-catalog skill every `ppt` deliverable starts by
   * loading. Set when the installation ships a skill that owns the template
   * workflow; it outranks {@link welinkinTemplatePath}, because the skill
   * names the template itself. Absent when no such skill is installed.
   */
  pptSkill?: string
}

/** Config schema; the loader fills defaults before {@link apply} runs. */
export const Config: z<Config> = z.object({
  welinkinTemplatePath: z.string(),
  pptSkill: z.string(),
})

/**
 * Delivery sentence shared by every file-producing kind: the Web deliverables
 * row lists only files the present tool declared, so a file the univer office
 * tools exported is invisible until the model declares it.
 */
const DELIVERY = ' Mentioning the path in the reply does not deliver the file; only the present call does.'

/** Export-and-declare tail shared by the univer-built kinds. */
const EXPORT = 'export the finished file under the working directory, then declare it with the present tool so the reader receives it.'

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

/** The PowerPoint facts the section reads from config. */
export interface PowerPointRoute {
  /** See {@link Config.welinkinTemplatePath}. */
  readonly welinkinTemplatePath?: string | undefined
  /** See {@link Config.pptSkill}. */
  readonly pptSkill?: string | undefined
}

/**
 * The prompt text one folded choice contributes.
 * @param choice - the Session's folded office choice.
 * @param route - the configured PowerPoint skill and template, each possibly absent.
 * @returns the section text, empty when the Session imposes no format.
 */
export function renderOfficeSection(choice: OfficeChoice, route: PowerPointRoute = {}): string {
  switch (choice.kind) {
    case 'none':
      return ''
    case 'word':
      return `Produce the deliverable as a Word document (.docx) with the univer office tools: create or import a .docx Unit, write and lay the document out there, ${EXPORT}${DELIVERY}`
    case 'excel':
      return `Produce the deliverable as an Excel workbook (.xlsx) with the univer office tools: create or import a .xlsx Unit, fill the sheets there with real cell values and formulas rather than pasted text, ${EXPORT}${DELIVERY}`
    case 'ppt':
      // The company template is the default deck, so this kind carries it
      // rather than offering a second PowerPoint row. A configured skill owns
      // the template workflow and outranks the bare path; the catalog route
      // names no brand, because the deployment names the catalog entry.
      if (route.pptSkill !== undefined) {
        return `Produce the deliverable as a PowerPoint presentation (.pptx) built from the company template. Before anything else, load the skill named ${route.pptSkill} with the skill tool and follow it: it names the template to import as the starting Unit with the univer office tools and the layouts, colours, and type sizes to keep. Then ${EXPORT}${DELIVERY}`
      }
      return route.welinkinTemplatePath === undefined
        ? `Produce the deliverable as a PowerPoint presentation (.pptx) built from the company template, using the univer office tools. No template path is configured here, so find the template through the session skill catalog: if it lists a PowerPoint template skill, load that skill first and import the template it names as the starting Unit, keeping its slide masters, layouts, fonts, and brand colours and replacing only the content. If the catalog lists no such skill, say that the company template is not reachable before building a plain .pptx. Then ${EXPORT}${DELIVERY}`
        : `Produce the deliverable as a PowerPoint presentation (.pptx) built from the company template at ${route.welinkinTemplatePath}: import it with the univer office tools as the starting Unit, keep its slide masters, layouts, fonts, and brand colours, and replace only the content. Then ${EXPORT}${DELIVERY}`
    case 'chart':
      // The fences are drawn by the ECharts plugin the Team deployment installs;
      // nothing is written to disk, so the delivery rule does not apply.
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
    order: ctx.systemPrompt.getSectionOrder('TEAM_POLICY') + 50,
    text: (context) => {
      if (context.agent === undefined) return ''
      return renderOfficeSection(foldOfficeChoice(context.agent.session.snapshotEvents()), config)
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
