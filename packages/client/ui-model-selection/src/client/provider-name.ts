import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Resolve a provider heading without exposing product-owned English copy in another locale.
 * @param group - Provider identity and optional catalog presentation metadata; a catalog failure carries the same identity.
 * @param t - Model-selection namespace translator.
 * @returns Locale-owned copy for the DeepSeek account route and for the canonical or
 * categorized built-in route, otherwise the adapter-owned name.
 */
export function modelProviderName(
  group: Pick<ModelProviderGroup, 'id' | 'name' | 'category'>,
  t: TranslateNS<'model'>,
): string {
  if (group.id === 'deepseek-account') return t('provider.account')
  return group.id === 'built-in' || group.category === 'built-in'
    ? t('group.builtIn')
    : group.name
}
