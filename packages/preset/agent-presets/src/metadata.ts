/**
 * A preset's metadata: the name and description a picker shows, and the one
 * fact about its sessions the composition cannot state, whether they own a
 * working directory.
 *
 * It lives in its own file because the composition is a top-level list of
 * plugin rows — YAML cannot carry sibling keys beside it, and faking a
 * metadata row would hand the Loader something to load. Keeping it separate
 * also keeps the composition exactly what its name says: a Cordis file the
 * loader owns and the cordis preset can author.
 *
 * `id` is the directory name and `trust` comes from the root a preset was
 * discovered under, so neither is writable here — otherwise a locally
 * authored preset could claim to be a shipped one.
 *
 * Every read failure degrades to no metadata. A preset whose file is missing,
 * malformed, or unreadable still mounts as a `required`-workspace preset:
 * presentation is not a capability, and a broken name must never become an
 * agent that cannot start. A `workspace` value outside the vocabulary is the
 * one exception, reported as a problem discovery marks the preset broken
 * with: a declaration that was made and cannot be read must not silently
 * become the default.
 * @module @deepseek-ai/dsh-agent-presets/metadata
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'

/** The optional display-metadata file beside a preset's composition. */
export const METADATA_FILE = 'preset.yml'

/** Whether sessions on a preset own a working directory. */
export type PresetWorkspace = 'required' | 'none'

/** Every `workspace` value a preset may declare. */
export const PRESET_WORKSPACES: readonly PresetWorkspace[] = ['required', 'none']

/** Display text and workspace requirement a preset may publish about itself. */
export interface PresetMetadata {
  /** Human-facing name; falls back to the preset id when absent. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /**
   * Position within its group; lower comes first. A preset that declares
   * none sorts after every preset that does, then by id — so the shipped set
   * can read in capability order while authored ones stay alphabetical.
   */
  readonly order?: number
  /**
   * Whether a session on this preset owns a working directory. `required`,
   * the value an absent key means, composes only sessions created inside a
   * Workspace or at an explicit cwd; `none` composes only sessions created
   * without either, whose header records no cwd.
   */
  readonly workspace?: PresetWorkspace
}

/** One metadata file as discovery reads it. */
export interface PresetMetadataRead {
  /** The metadata the preset published, possibly empty. */
  readonly metadata: PresetMetadata
  /** A declared `workspace` outside {@link PRESET_WORKSPACES}; the preset must not compose until it is fixed. */
  readonly problem?: string
}

/** A non-empty trimmed string, or undefined for anything else. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read one preset directory's metadata.
 *
 * Absent, unparsable, and wrongly-shaped files are all the same answer —
 * empty metadata — because the caller renders a picker, not a diagnostic.
 * @param directory - the preset directory.
 * @returns the metadata the preset published, possibly empty, beside the
 * problem an unreadable `workspace` declaration raises.
 */
export async function readPresetMetadata(directory: string): Promise<PresetMetadataRead> {
  let raw: string
  try {
    raw = await readFile(join(directory, METADATA_FILE), 'utf8')
  } catch {
    // Absent is the common case: metadata is optional and most presets,
    // including every one authored by duplicating another, carry none.
    return { metadata: {} }
  }
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch {
    // Malformed display text is not worth failing discovery over; the picker
    // falls back to the id, and the composition still mounts.
    return { metadata: {} }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { metadata: {} }
  const record = parsed as Record<string, unknown>
  const name = text(record.name)
  const description = text(record.description)
  const order = typeof record.order === 'number' && Number.isFinite(record.order)
    ? record.order
    : undefined
  const workspace = record.workspace
  if (workspace !== undefined && !PRESET_WORKSPACES.includes(workspace as PresetWorkspace)) {
    return {
      metadata: {},
      problem: `${METADATA_FILE} declares workspace ${JSON.stringify(workspace)}; `
        + `a preset declares ${PRESET_WORKSPACES.join(' or ')}, or omits the key for required`,
    }
  }
  return {
    metadata: {
      ...name === undefined ? {} : { name },
      ...description === undefined ? {} : { description },
      ...order === undefined ? {} : { order },
      ...workspace === undefined ? {} : { workspace: workspace as PresetWorkspace },
    },
  }
}

/**
 * Render display metadata as the file's contents.
 *
 * Absent fields are omitted rather than written empty, so a preset with no
 * description does not ship a key that reads as an intentional blank.
 * @param metadata - the display text to store.
 * @returns the YAML document, or undefined when there is nothing to store.
 */
export function renderPresetMetadata(metadata: PresetMetadata): string | undefined {
  const name = text(metadata.name)
  const description = text(metadata.description)
  const { order, workspace } = metadata
  if (name === undefined && description === undefined && order === undefined && workspace === undefined) {
    return undefined
  }
  return yaml.dump({
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
    ...order === undefined ? {} : { order },
    ...workspace === undefined ? {} : { workspace },
  }, { lineWidth: -1 })
}
