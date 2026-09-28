/** The installed product's release version in General Settings. */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings.general.item slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './ProductVersionRow.module.css'

/** Registration-side operation for the version row. */
export interface ProductVersionRowInjected {
  /**
   * Read the installed product version from the Runner-local endpoint.
   * @returns the version, or undefined when this deployment names none.
   */
  loadProductVersion: () => Promise<string | undefined>
}

/** Complete slot props for the version row. */
export type ProductVersionRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'team.account'>
  & InjectFace<ProductVersionRowInjected>

/** What the row knows about the version to show. */
type VersionState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly version: string | undefined }

/**
 * Render the product version, falling back to the client build's DSH version
 * when the deployment names no product version or the Runner cannot answer.
 * Nothing renders until the Runner has answered, so the row never shows one
 * version and then another.
 * @param props - composed slot props and the version read.
 * @returns the version label, or nothing while loading or without any version.
 */
export function ProductVersionRow({ loadProductVersion, t }: ProductVersionRowProps) {
  const [state, setState] = useState<VersionState>({ status: 'loading' })

  useEffect(() => {
    let live = true
    const settle = (version: string | undefined): void => { if (live) setState({ status: 'ready', version }) }
    void loadProductVersion().then(settle, () => { settle(undefined) })
    return () => { live = false }
  }, [loadProductVersion])

  if (state.status === 'loading') return null
  const version = state.version ?? process.env.DSH_CLIENT_VERSION
  if (version === undefined) return null
  return <div className={css.row}>{t('version.current', { version })}</div>
}
