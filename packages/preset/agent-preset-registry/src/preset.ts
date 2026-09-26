import type { Volatile } from '@deepseek-ai/cordis'
import type { PresetWorkspace } from './types.ts'
/** Public preset roster and selection configuration. */
/** One declared preset and its current activation failure, if any. */
export interface AgentPreset {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  /** Whether its sessions own a working directory; `required` when the declaration states none. */
  readonly workspace: PresetWorkspace
  readonly broken?: string
}

/** Registry selection policy. */
export interface Config {
  /** Deployment default when the caller omits a preset. */
  default: string
  /** User-selected default; edited through Settings. */
  selectedDefault: Volatile<string | undefined>
  /**
   * Preset composed for a session created without a Workspace or cwd when
   * the caller names none; it must declare `workspace: none`. Absent means
   * the deployment composes no such session unless the caller names the
   * preset itself.
   */
  chatDefault?: string
}
