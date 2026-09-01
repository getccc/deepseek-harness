/**
 * DOM snapshot hygiene: a vitest snapshot serializer that keeps `.snap`
 * files structural. Three normalizations, all on a clone (the live DOM is
 * untouched, so class/tag queries keep working):
 *
 * - CSS-module scoped class names (`_frame_334d2d`, this repo's
 *   `_[local]_[hash]` shape) fold back to their semantic local (`frame`), so
 *   CSS edits do not churn snapshots.
 * - `<svg>` internals collapse to a `data-content` fingerprint on the svg
 *   element: path geometry is print noise, but the fingerprint still flips
 *   when an icon's artwork actually changes.
 * - `src`/`href` data URIs collapse to their media type plus a payload
 *   fingerprint (`data:image/png;base64#3f2a1c04`), on the same reasoning:
 *   an inlined asset is kilobytes of print noise whose fingerprint still
 *   flips when the asset changes.
 */
import { expect } from 'vitest'
import type { SnapshotSerializer } from 'vitest'

/** One scoped class token: `_<local>_<hash>` (local may itself contain underscores). */
const SCOPED_CLASS = /^_(.+)_[a-z0-9]+$/

/** Fold scoped tokens in one class attribute value; foreign tokens pass through. */
function normalizeClassValue(value: string): string {
  return value
    .split(/\s+/)
    .filter(token => token !== '')
    .map(token => token.replace(SCOPED_CLASS, '$1'))
    .join(' ')
}

/** FNV-1a 32-bit over the given text: deterministic, dependency-free fingerprint. */
function fingerprint(markup: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < markup.length; i++) {
    hash ^= markup.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** A data URI through its comma: `data:<mediatype>[;base64],`. */
const DATA_URI_PREFIX = /^data:[^,]*,/

/** Attribute names whose value can inline a whole asset. */
const ASSET_ATTRIBUTES = ['src', 'href'] as const

/** One inlined asset: where it sits and what replaces it. */
interface InlinedAsset {
  /** Element carrying the data URI (in the clone the serializer prints). */
  readonly el: Element
  /** Attribute name holding it. */
  readonly name: string
  /** Media type plus payload fingerprint, replacing the payload. */
  readonly folded: string
}

/** Data URIs in a subtree, the root included. */
function inlinedAssetsOf(root: Element): InlinedAsset[] {
  const found: InlinedAsset[] = []
  for (const el of [root, ...root.querySelectorAll('[src], [href]')]) {
    for (const name of ASSET_ATTRIBUTES) {
      const value = el.getAttribute(name)
      if (value === null) continue
      const prefix = DATA_URI_PREFIX.exec(value)?.[0]
      if (prefix === undefined) continue
      // The comma is dropped so the folded value no longer matches: the printer
      // re-tests the clone, and a fold that still looked like a data URI would
      // send the serializer through itself until the stack ran out.
      found.push({
        el,
        name,
        folded: `${prefix.slice(0, -1)}#${fingerprint(value.slice(prefix.length))}`,
      })
    }
  }
  return found
}

/** svg elements of a subtree, the root included when it is one. */
function svgsOf(root: Element): Element[] {
  const svgs: Element[] = [...root.querySelectorAll('svg')]
  if (root.tagName.toLowerCase() === 'svg') svgs.unshift(root)
  return svgs
}

/** Whether serializing this subtree needs a normalized clone. */
function needsNormalization(root: Element): boolean {
  const scoped = [root, ...root.querySelectorAll('[class]')].some((el) => {
    const value = el.getAttribute('class')
    return value !== null && value.split(/\s+/).some(token => SCOPED_CLASS.test(token))
  })
  return scoped
    || svgsOf(root).some(svg => svg.childNodes.length > 0)
    || inlinedAssetsOf(root).length > 0
}

/**
 * The serializer plugin. Matches DOM elements whose subtree carries a scoped
 * class, svg internals, or an inlined data URI; serializes a normalized clone,
 * which no longer matches, so printing falls through to the built-in DOM
 * element serializer.
 */
export const domSnapshotSerializer: SnapshotSerializer = {
  test(value: unknown): boolean {
    return typeof Element !== 'undefined' && value instanceof Element && needsNormalization(value)
  },
  serialize(value, config, indentation, depth, refs, printer): string {
    const clone = (value as Element).cloneNode(true) as Element
    for (const el of [clone, ...clone.querySelectorAll('[class]')]) {
      const raw = el.getAttribute('class')
      if (raw !== null) el.setAttribute('class', normalizeClassValue(raw))
    }
    for (const svg of svgsOf(clone)) {
      if (svg.childNodes.length === 0) continue
      svg.setAttribute('data-content', fingerprint(svg.innerHTML))
      svg.replaceChildren()
    }
    for (const asset of inlinedAssetsOf(clone)) asset.el.setAttribute(asset.name, asset.folded)
    return printer(clone, config, indentation, depth, refs)
  },
}

let registered = false

/**
 * Register {@link domSnapshotSerializer} with vitest's expect (idempotent).
 * SlotTestRuntime.create() calls this; specs that snapshot DOM outside the
 * runtime import and call it themselves.
 */
export function registerDomSnapshotSerializer(): void {
  if (registered) return
  registered = true
  expect.addSnapshotSerializer(domSnapshotSerializer)
}
