/**
 * The office prompt section and projection: what the model is told to produce,
 * and the projection a composer chip reads.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { apply, renderOfficeSection } from '@deepseek-ai/dsh-tool-office'
import { DEFAULT_OFFICE_CHOICE } from '@deepseek-ai/dsh-office'

describe('renderOfficeSection', () => {
  it('is empty when the Session imposes no format', () => {
    expect(renderOfficeSection({ version: 1, kind: 'none' })).toBe('')
  })

  it('builds each ordinary office format with the univer office tools', () => {
    const word = renderOfficeSection({ version: 1, kind: 'word' })
    expect(word).toMatch(/Word document \(\.docx\) with the univer office tools/)
    expect(word).toMatch(/create or import a \.docx Unit/)
    const excel = renderOfficeSection({ version: 1, kind: 'excel' })
    expect(excel).toMatch(/Excel workbook \(\.xlsx\) with the univer office tools/)
    expect(excel).toMatch(/real cell values and formulas/)
    for (const text of [word, excel]) {
      expect(text).toMatch(/export the finished file under the working directory, then declare it with the present tool/)
    }
  })

  it('builds every deck from the configured template, with no second PowerPoint kind to pick', () => {
    const text = renderOfficeSection({ version: 1, kind: 'ppt' }, { welinkinTemplatePath: '/opt/welinkin/welinkin-ppt.pptx' })
    expect(text).toContain('/opt/welinkin/welinkin-ppt.pptx')
    expect(text).toMatch(/import it with the univer office tools as the starting Unit/)
    expect(text).toMatch(/keep its slide masters, layouts, fonts, and brand colours/)
    expect(text).not.toMatch(/skill tool/)
  })

  it('starts every deck from the configured skill, which outranks the template path', () => {
    const text = renderOfficeSection({ version: 1, kind: 'ppt' }, { pptSkill: 'amec-ppt', welinkinTemplatePath: '/opt/welinkin/welinkin-ppt.pptx' })
    expect(text).toMatch(/Before anything else, load the skill named amec-ppt with the skill tool and follow it/)
    expect(text).toMatch(/univer office tools/)
    expect(text).not.toContain('/opt/welinkin/welinkin-ppt.pptx')
    expect(text).toMatch(/only the present call does\.$/)
  })

  it('asks for SVG chart files declared through the present tool for the chart kind', () => {
    const text = renderOfficeSection({ version: 1, kind: 'chart' })
    expect(text).toMatch(/SVG file under the working directory/)
    expect(text).toMatch(/declare every file with the present tool/)
    expect(text).not.toMatch(/echarts/)
  })

  it('ends every file-producing kind with the present-tool delivery rule', () => {
    for (const kind of ['word', 'excel', 'ppt', 'chart'] as const) {
      const text = renderOfficeSection({ version: 1, kind }, kind === 'ppt' ? { welinkinTemplatePath: '/opt/welinkin/welinkin-ppt.pptx' } : {})
      expect(text).toMatch(/present tool/)
      expect(text).toMatch(/only the present call does\.$/)
    }
    expect(renderOfficeSection({ version: 1, kind: 'ppt' })).toMatch(/only the present call does\.$/)
  })

  it('sends the model to a template skill when neither a skill nor a template path is configured', () => {
    const text = renderOfficeSection({ version: 1, kind: 'ppt' })
    expect(text).toMatch(/using the univer office tools/)
    expect(text).toMatch(/No template path is configured here/)
    expect(text).toMatch(/PowerPoint template skill, load that skill first/)
    expect(text).toMatch(/keeping its slide masters, layouts, fonts, and brand colours/)
    expect(text).toMatch(/building a plain \.pptx/)
    // The section asserts nothing about the environment and invents no palette.
    expect(text).not.toMatch(/carries no .* template/)
    expect(text).not.toMatch(/#[0-9A-Fa-f]{6}/)
    // The deployment names the catalog entry, so the section names no brand.
    expect(text).not.toMatch(/Welinkin/)
  })
})

/** A minimal Host context capturing the section and projection an apply registers. */
function fakeCtx() {
  type SectionAgent = { session: { snapshotEvents: () => SessionEvent[] } }
  const sections: { name: string; order: number; text: (c: { agent?: SectionAgent }) => string }[] = []
  const projections: {
    key: string
    init: () => unknown
    apply: (s: unknown, e: SessionEvent) => unknown
    wire: { view: (s: unknown) => unknown }
  }[] = []
  const ctx = {
    effect: (fn: () => unknown) => { fn(); return () => {} },
    systemPrompt: { section: (s: unknown) => { sections.push(s as never); return () => {} }, getSectionOrder: () => 600 },
    inject: (_deps: string[], cb: (c: unknown) => void) => {
      cb({ sessionProjections: { register: (d: unknown) => { projections.push(d as never); return () => {} } } })
    },
  }
  return { ctx: ctx as never, sections, projections }
}

describe('apply', () => {
  it('registers a section that folds the log and a projection that mirrors it', () => {
    const { ctx, sections, projections } = fakeCtx()
    apply(ctx, { welinkinTemplatePath: '/opt/welinkin/welinkin-ppt.pptx' })

    const section = sections[0]!
    expect(section.name).toBe('office:kind')
    // No agent: nothing to fold, empty section.
    expect(section.text({})).toBe('')
    // A recorded ppt choice reaches the model with the template path.
    const events = [{ type: 'office/kind', data: { version: 1, kind: 'ppt' } }] as unknown as SessionEvent[]
    expect(section.text({ agent: { session: { snapshotEvents: () => events } } })).toContain('/opt/welinkin/welinkin-ppt.pptx')

    const projection = projections[0]!
    expect(projection.key).toBe('office')
    expect(projection.init()).toEqual(DEFAULT_OFFICE_CHOICE)
    const applied = projection.apply(DEFAULT_OFFICE_CHOICE, events[0]!)
    expect(applied).toEqual({ version: 1, kind: 'ppt' })
    // An unrelated event leaves the state alone.
    expect(projection.apply(applied, { type: 'other' } as unknown as SessionEvent)).toBe(applied)
    // The wire view is the state itself.
    expect(projection.wire.view(applied)).toBe(applied)
  })

  it('sends the model to a template skill when no template path is configured', () => {
    const { ctx, sections } = fakeCtx()
    apply(ctx, {})
    const events = [{ type: 'office/kind', data: { version: 1, kind: 'ppt' } }] as unknown as SessionEvent[]
    expect(sections[0]!.text({ agent: { session: { snapshotEvents: () => events } } })).toMatch(/PowerPoint template skill/)
  })

  it('names the configured skill for every deck', () => {
    const { ctx, sections } = fakeCtx()
    apply(ctx, { pptSkill: 'amec-ppt' })
    const events = [{ type: 'office/kind', data: { version: 1, kind: 'ppt' } }] as unknown as SessionEvent[]
    expect(sections[0]!.text({ agent: { session: { snapshotEvents: () => events } } })).toMatch(/load the skill named amec-ppt/)
  })

  it('reads a retired kind out of both the section and the projection', () => {
    const { ctx, sections, projections } = fakeCtx()
    apply(ctx, {})
    const retired = { type: 'office/kind', data: { version: 1, kind: 'welinkin-ppt' } } as unknown as SessionEvent
    expect(sections[0]!.text({ agent: { session: { snapshotEvents: () => [retired] } } })).toBe('')
    expect(projections[0]!.apply({ version: 1, kind: 'word' }, retired)).toEqual(DEFAULT_OFFICE_CHOICE)
  })
})
