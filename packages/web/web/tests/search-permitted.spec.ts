/**
 * `searchPermitted()`: the deployment's decision, read from the provider a
 * search would use, without the usability check that a search itself applies.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime, { type WebSearchProvider } from '@deepseek-ai/dsh-web'

function provider(id: string, permitted?: (signal?: AbortSignal) => Promise<boolean>): WebSearchProvider {
  return {
    id,
    available: () => false,
    search: () => Promise.reject(new Error('unused')),
    ...(permitted === undefined ? {} : { permitted }),
  }
}

async function mount(config: ConstructorParameters<typeof WebRuntime>[1] = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, config).await()
  return ctx
}

describe('searchPermitted', () => {
  it('asks the configured provider, ignoring its usability, and forwards the signal', async () => {
    const ctx = await mount({ searchProvider: 'team' })
    const permitted = vi.fn((_signal?: AbortSignal) => Promise.resolve(false))
    ctx.web.registerSearchProvider(provider('team', permitted))
    ctx.web.registerSearchProvider(provider('other', () => Promise.resolve(true)))
    const signal = new AbortController().signal
    expect(await ctx.web.searchPermitted(signal)).toBe(false)
    expect(permitted).toHaveBeenCalledExactlyOnceWith(signal)
  })

  it('answers true for a provider that makes no decision of its own, and false for a configured id nobody registered', async () => {
    const ctx = await mount({ searchProvider: 'deepseek-official' })
    expect(await ctx.web.searchPermitted()).toBe(false)
    ctx.web.registerSearchProvider(provider('deepseek-official'))
    expect(await ctx.web.searchPermitted()).toBe(true)
  })

  it('reads the single registered provider when none is configured, and leaves an ambiguous set to search time', async () => {
    const ctx = await mount()
    expect(await ctx.web.searchPermitted()).toBe(false)
    ctx.web.registerSearchProvider(provider('a', () => Promise.resolve(false)))
    expect(await ctx.web.searchPermitted()).toBe(false)
    ctx.web.registerSearchProvider(provider('b', () => Promise.resolve(false)))
    expect(await ctx.web.searchPermitted()).toBe(true)
  })
})
