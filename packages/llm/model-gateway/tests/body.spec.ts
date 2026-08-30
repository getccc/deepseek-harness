/**
 * What the gateway overwrites before a body goes upstream.
 *
 * Two fields and no more. Each test here is one way a Runner could otherwise
 * spend an organization's budget on something nobody authorized.
 */

import { describe, expect, it } from 'vitest'
import { applyPlanToBody, type CallPlan } from '../src/index.ts'

describe('what reaches the provider', () => {
  const plan: CallPlan = {
    modelRef: 'company-v4',
    endpoint: 'https://api.deepseek.com',
    upstreamModel: 'deepseek-chat-20260801',
    credentialRef: 'COMPANY_DEEPSEEK_KEY',
    reservationId: 'reservation' as never,
    maxOutputTokens: 4_000,
    policyRevision: 1n,
  }

  it('overwrites the model a Runner wrote in the body', () => {
    // The Runner names one model to the gateway and writes another in the
    // body; the call reaches the one it was authorized for.
    const sent = applyPlanToBody({ model: 'some-other-model', messages: [] }, plan)
    expect(sent.model).toBe('deepseek-chat-20260801')
  })

  it('bounds an output limit the body already carries, in either spelling', () => {
    for (const field of ['max_tokens', 'max_completion_tokens']) {
      const sent = applyPlanToBody({ model: 'x', [field]: 100_000 }, plan)
      expect(sent[field], field).toBe(4_000)
    }
    // A smaller ask in the body is left alone.
    expect(applyPlanToBody({ model: 'x', max_tokens: 50 }, plan).max_tokens).toBe(50)
  })

  it('adds no output limit the body did not carry', () => {
    // Adding a field the adapter did not send would change a request it meant.
    const sent = applyPlanToBody({ model: 'x', messages: [] }, plan)
    expect('max_tokens' in sent).toBe(false)
    expect('max_completion_tokens' in sent).toBe(false)
  })

  it('leaves everything else the adapter built', () => {
    const sent = applyPlanToBody({
      model: 'x', messages: [{ role: 'user', content: 'hello' }], temperature: 0.2, stream: true,
    }, plan)
    expect(sent).toMatchObject({ messages: [{ role: 'user', content: 'hello' }], temperature: 0.2, stream: true })
  })

  it('bounds a limit that is not a number at all', () => {
    expect(applyPlanToBody({ model: 'x', max_tokens: 'lots' }, plan).max_tokens).toBe(4_000)
  })
})
