/** Shared projection of the live LLM registry into the browser model catalog. */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ModelCatalog,
  ModelProviderGroup,
  ModelReasoning,
  ModelSelection,
} from './types.ts'

/**
 * Build the browser model catalog without requiring a Session.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a model.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),
): Promise<ModelCatalog> {
  const providers = ctx.llm.listProviders()
  const catalog = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort }),
          }
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
        }
      }))
      return {
        kind: 'group' as const,
        group: {
          id: provider.id,
          name: provider.name,
          ...provider.category === undefined ? {} : { category: provider.category },
          models: entries,
        },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  const groups = catalog.flatMap(item => item.kind === 'group' ? [item.group] : [])
    .filter(group => group.models.length > 0)
  return {
    default: resolveDefault(groups, defaultSelection),
    routableProviders: providers.map(provider => provider.id),
    groups,
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}

/**
 * The default a reader of this catalog can actually use.
 *
 * The deployment's default is one setting for everyone, while the groups are
 * what this caller may reach — a company route lists what its member is
 * granted. A default outside those groups would name a model in the composer
 * that the first request is refused for, so it gives way to the first model
 * the catalog does list. Membership stays advisory everywhere else: a
 * selection already made is left alone, because a route may serve a model it
 * has stopped advertising.
 * @param groups - the non-empty provider groups this catalog reports.
 * @param preferred - the deployment default.
 * @returns the deployment default, or the first listed model when it is not listed.
 */
function resolveDefault(
  groups: readonly ModelProviderGroup[],
  preferred: ModelSelection,
): ModelSelection {
  const listed = groups.some(group => group.id === preferred.provider
    && group.models.some(model => model.id === preferred.model))
  const first = groups[0]
  const model = first?.models[0]
  if (listed || first === undefined || model === undefined) return { ...preferred }
  const effort = model.reasoning?.defaultEffort
  return {
    provider: first.id,
    model: model.id,
    ...effort === undefined ? {} : { reasoningEffort: effort },
  }
}
