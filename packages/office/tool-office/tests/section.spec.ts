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

  it('names each ordinary office format', () => {
    expect(renderOfficeSection({ version: 1, kind: 'word' })).toMatch(/Word document \(\.docx\)/)
    expect(renderOfficeSection({ version: 1, kind: 'ppt' })).toMatch(/PowerPoint presentation \(\.pptx\)/)
    expect(renderOfficeSection({ version: 1, kind: 'excel' })).toMatch(/Excel workbook \(\.xlsx\)/)
  })

  it('names the AMEC template path when one is configured', () => {
    const text = renderOfficeSection({ version: 1, kind: 'amec-ppt' }, '/opt/amec/amec-ppt.pptx')
    expect(text).toContain('/opt/amec/amec-ppt.pptx')
    expect(text).toMatch(/keep its slide masters, layouts, fonts, and brand colours/)
  })

  it('names the echarts fence and its strict-JSON rule for the chart kind', () => {
    const text = renderOfficeSection({ version: 1, kind: 'chart' })
    expect(text).toMatch(/info string is exactly `echarts`/)
    expect(text).toMatch(/strict-JSON Apache ECharts option/)
    expect(text).toMatch(/no JavaScript functions/)
  })

  it('falls back to the AMEC brand style when no template is bundled', () => {
    const text = renderOfficeSection({ version: 1, kind: 'amec-ppt' })
    expect(text).toMatch(/#0A1E3A/)
    expect(text).toMatch(/no AMEC template file/)
  })
})

/** A minimal Host context capturing the section and projection an apply registers. */
function fakeCtx() {
  const sections: { name: string; order: number; text: (c: { agent?: { session: { events: SessionEvent[] } } }) => string }[] = []
  const projections: {
    key: string
    init: () => unknown
    apply: (s: unknown, e: SessionEvent) => unknown
    wire: { view: (s: unknown) => unknown }
  }[] = []
  const ctx = {
    effect: (fn: () => unknown) => { fn(); return () => {} },
    systemPrompt: { section: (s: unknown) => { sections.push(s as never); return () => {} } },
    inject: (_deps: string[], cb: (c: unknown) => void) => {
      cb({ sessionProjections: { register: (d: unknown) => { projections.push(d as never); return () => {} } } })
    },
  }
  return { ctx: ctx as never, sections, projections }
}

describe('apply', () => {
  it('registers a section that folds the log and a projection that mirrors it', () => {
    const { ctx, sections, projections } = fakeCtx()
    apply(ctx, { amecTemplatePath: '/opt/amec/amec-ppt.pptx' })

    const section = sections[0]!
    expect(section.name).toBe('office:kind')
    // No agent: nothing to fold, empty section.
    expect(section.text({})).toBe('')
    // A recorded amec-ppt choice reaches the model with the template path.
    const events = [{ type: 'office/kind', data: { version: 1, kind: 'amec-ppt' } }] as unknown as SessionEvent[]
    expect(section.text({ agent: { session: { events } } })).toContain('/opt/amec/amec-ppt.pptx')

    const projection = projections[0]!
    expect(projection.key).toBe('office')
    expect(projection.init()).toEqual(DEFAULT_OFFICE_CHOICE)
    const applied = projection.apply(DEFAULT_OFFICE_CHOICE, events[0]!)
    expect(applied).toEqual({ version: 1, kind: 'amec-ppt' })
    // An unrelated event leaves the state alone.
    expect(projection.apply(applied, { type: 'other' } as unknown as SessionEvent)).toBe(applied)
    // The wire view is the state itself.
    expect(projection.wire.view(applied)).toBe(applied)
  })

  it('asks for the AMEC brand style when no template path is configured', () => {
    const { ctx, sections } = fakeCtx()
    apply(ctx, {})
    const events = [{ type: 'office/kind', data: { version: 1, kind: 'amec-ppt' } }] as unknown as SessionEvent[]
    expect(sections[0]!.text({ agent: { session: { events } } })).toMatch(/no AMEC template file/)
  })
})
