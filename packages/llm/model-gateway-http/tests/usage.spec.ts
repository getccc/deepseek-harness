/**
 * Reading a provider's usage out of a response nobody buffers.
 *
 * The scanner decides whether a call is settled against what the provider said
 * or against an estimate, so what matters is not that it finds usage in a
 * well-formed response, but that it does not invent one from a malformed one.
 */

import { describe, expect, it } from 'vitest'
import { UsageScanner, readUsage, settlementFor } from '../src/index.ts'

/** Feed a whole body through the scanner in one or many pieces. */
function scan(body: string, pieces = 1): ReturnType<UsageScanner['end']> {
  const scanner = new UsageScanner()
  const size = Math.ceil(body.length / pieces)
  for (let at = 0; at < body.length; at += size) {
    scanner.push(Buffer.from(body.slice(at, at + size), 'utf8'))
  }
  return scanner.end()
}

describe('reading a usage object', () => {
  it('accepts either spelling of the two counts', () => {
    expect(readUsage({ prompt_tokens: 10, completion_tokens: 20 })).toEqual({ inputTokens: 10, outputTokens: 20 })
    expect(readUsage({ input_tokens: 10, output_tokens: 20 })).toEqual({ inputTokens: 10, outputTokens: 20 })
  })

  it('refuses half a report rather than completing it', () => {
    // Charging an input count with an invented output would be an estimate
    // wearing a provider's authority.
    expect(readUsage({ prompt_tokens: 10 })).toBeUndefined()
    expect(readUsage({ completion_tokens: 20 })).toBeUndefined()
  })

  it('refuses counts that are not counts, and values that are not objects', () => {
    expect(readUsage({ prompt_tokens: -1, completion_tokens: 2 })).toBeUndefined()
    expect(readUsage({ prompt_tokens: 1.5, completion_tokens: 2 })).toBeUndefined()
    expect(readUsage({ prompt_tokens: '10', completion_tokens: 20 })).toBeUndefined()
    for (const value of [undefined, null, 'usage', 42, [1, 2]]) {
      expect(readUsage(value), JSON.stringify(value)).toBeUndefined()
    }
  })
})

describe('watching a response go past', () => {
  it('finds usage in a single JSON document', () => {
    expect(scan('{"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":11}}'))
      .toEqual({ inputTokens: 7, outputTokens: 11 })
  })

  it('finds usage in the final frame of a stream', () => {
    const stream = [
      'data: {"choices":[{"delta":{"content":"a"}}]}',
      '',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    expect(scan(stream)).toEqual({ inputTokens: 3, outputTokens: 4 })
  })

  it('reads the same answer however the bytes are split', () => {
    const stream = 'data: {"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\ndata: [DONE]\n\n'
    for (const pieces of [1, 2, 5, 17, stream.length]) {
      expect(scan(stream, pieces), String(pieces)).toEqual({ inputTokens: 3, outputTokens: 4 })
    }
  })

  it('keeps the last usage a stream reported, not the first', () => {
    const stream = [
      'data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}',
      'data: {"usage":{"prompt_tokens":9,"completion_tokens":9}}',
      '',
    ].join('\n')
    expect(scan(stream)).toEqual({ inputTokens: 9, outputTokens: 9 })
  })

  it('answers nothing for a response that reported nothing', () => {
    expect(scan('{"choices":[]}')).toBeUndefined()
    expect(scan('data: [DONE]\n\n')).toBeUndefined()
    expect(scan('')).toBeUndefined()
    expect(scan('not json at all\nnor this\n')).toBeUndefined()
    // A frame cut in half is not usage; a later whole one still would be.
    expect(scan('data: {"usage":{"prompt_to')).toBeUndefined()
  })
})

describe('choosing a settlement', () => {
  const plan = { maxOutputTokens: 4_000 }

  it('reports what the provider said, whatever the status', () => {
    expect(settlementFor(200, { inputTokens: 5, outputTokens: 6 }, plan))
      .toEqual({ kind: 'reported', inputTokens: 5, outputTokens: 6 })
    // A provider that failed partway and still reported usage generated those
    // tokens, and the organization owes for them.
    expect(settlementFor(500, { inputTokens: 5, outputTokens: 6 }, plan))
      .toEqual({ kind: 'reported', inputTokens: 5, outputTokens: 6 })
  })

  it('releases only a refusal that reported nothing', () => {
    expect(settlementFor(400, undefined, plan)).toEqual({ kind: 'released' })
    expect(settlementFor(429, undefined, plan)).toEqual({ kind: 'released' })
  })

  it('estimates a success that reported nothing', () => {
    // It may still have produced tokens, so it is charged the ceiling and
    // marked rather than released.
    expect(settlementFor(200, undefined, plan))
      .toEqual({ kind: 'estimated', inputTokens: 0, outputTokens: 4_000 })
  })
})
