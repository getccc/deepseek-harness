import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Resolve a provider heading without exposing product-owned English copy in another locale.
 * @param group - Provider identity and optional catalog presentation metadata.
 * @param t - Model-selection namespace translator.
 * @returns Locale-owned built-in copy for the canonical route, otherwise the adapter-owned name.
 */
export function modelProviderName(
  group: Pick<ModelProviderGroup, 'id' | 'name' | 'category'>,
  t: TranslateNS<'model'>,
): string {
  return group.id === 'built-in' || group.category === 'built-in'
    ? t('group.builtIn')
    : group.name
}
