/** Shared Host wiring for the DeepSeek protocol adapters. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-fs'
import { resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { DeepSeekAdapter } from './adapter.ts'
import { ChatCompletionsAdapter, type ChatCompletionsAdapterOptions } from './chat-completions/adapter.ts'
import type { DeepSeekAdapterOptions, DeepSeekConnectionOptions } from './types.ts'

/** The Host services both adapters read per request: attachments, image access, and request extensions. */
function hostServices(ctx: Context): Pick<DeepSeekAdapterOptions,
  'onExtensionsOmitted' | 'resolveAttachments' | 'resolveImageAccess' | 'prepareExtensions'> {
  return {
    onExtensionsOmitted: ({ provider, model, fields, error }) => {
      ctx.logger.warn(`llm-deepseek: sending route "${provider}/${model}" without request extension fields ${fields.join(', ')} because they failed to serialize: %o`, error)
    },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref,
    ),
    prepareExtensions: request => ctx.get('deepseekLlmApiExtensions')?.prepare(request)
      ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
  }
}

/**
 * Build the Messages adapter with request-local Host services, without registering it.
 * @param ctx - provider plugin lifetime.
 * @param dependencies - provider-owned discovery, credential, and configuration callbacks.
 * @returns an adapter the caller registers under the routes it owns.
 */
export function createDeepSeekAdapter<C extends DeepSeekConnectionOptions>(
  ctx: Context, dependencies: Pick<DeepSeekAdapterOptions<C>,
  'options' | 'resolveAuth' | 'providerName' | 'discoverModels'>): DeepSeekAdapter<C> {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  let userId: AnonymousUserId | undefined
  return new DeepSeekAdapter({
    ...dependencies,
    ...hostServices(ctx),
    resolveUserId: () => userId ??= getOrCreateAnonymousUserId(),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(`llm-deepseek: unusable Messages replay state on assistant history for route "${provider}/${model}"; sending provider-neutral content (${reason})`)
    },
  })
}

/**
 * Build the transport-carried Chat Completions adapter for the `built-in`
 * route with the same request-local Host services, without registering it.
 * @param ctx - provider plugin lifetime.
 * @param dependencies - configuration and the mounted transport.
 * @returns an adapter the caller registers under the `built-in` route.
 */
export function createBuiltInAdapter(
  ctx: Context, dependencies: Pick<ChatCompletionsAdapterOptions, 'options' | 'transport'>,
): ChatCompletionsAdapter {
  return new ChatCompletionsAdapter({ ...dependencies, ...hostServices(ctx) })
}

/**
 * Register one provider with request-local transport services and live retry policy.
 * @param ctx - provider plugin lifetime with the LLM registry injected.
 * @param provider - exact route owned by this plugin.
 * @param dependencies - provider-owned discovery, credential, and configuration callbacks.
 */
export function registerDeepSeekProvider<C extends DeepSeekConnectionOptions>(
  ctx: Context, provider: string, dependencies: Pick<DeepSeekAdapterOptions<C>,
  'options' | 'resolveAuth' | 'providerName' | 'discoverModels'>): void {
  const adapter = createDeepSeekAdapter(ctx, dependencies)
  const registration = ctx.llm.registerAdapter([provider], adapter)
  let registeredPolicy = dependencies.options().retryPolicy
  ctx.on('loader/volatile-update', () => {
    let policy: typeof registeredPolicy
    try { policy = dependencies.options().retryPolicy }
    catch (error) { ctx.logger.warn(error); return }
    if (deepEqualJson(policy, registeredPolicy)) return
    registration.replace([provider])
    registeredPolicy = policy
  })
}
