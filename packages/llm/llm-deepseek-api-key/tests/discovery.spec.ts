/** The configured model catalog follows the key's presence, not whether a request could use the key. */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import * as ApiKey from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllEnvs()
})

async function boot(key: string): Promise<Context> {
  vi.stubEnv('DEEPSEEK_API_KEY', key)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ApiKey, {})
  return ctx
}

it.each(['sk-test', 'invalid\nheader'])('advertises configured models for a present API key: %j', async (key) => {
  const ctx = await boot(key)
  // A key no header can carry still registers the route; the request reports it.
  expect(await ctx.llm.listModels('deepseek-official')).toEqual(expect.arrayContaining([
    expect.objectContaining({ provider: 'deepseek-official', id: 'deepseek-flash' }),
  ]))
})

it('advertises no models while the API key is empty', async () => {
  const ctx = await boot('')
  await expect(ctx.llm.listModels('deepseek-official')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
})
