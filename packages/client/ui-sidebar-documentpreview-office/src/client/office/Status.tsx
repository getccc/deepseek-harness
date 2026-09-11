/** Status lines shared by the office bodies: loading, failure with retry, and unsupported content. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OfficeBodyProps } from './body.ts'
import css from './Status.module.css'

/** @param props - localized label. @returns an animated, accessible loading status. */
export function Loading({ t }: { readonly t: OfficeBodyProps['t'] }): ReactNode {
  return <span className={css.status} role="status" data-document-loading>
    <span className={css.icon} aria-hidden="true"><IconLoadingOutline16 /></span>
    <span>{t('loading')}</span>
  </span>
}

/** @param props - localized copy and the retry action. @returns the failure line with a retry button. */
export function Failed({ t, onRetry }: { readonly t: OfficeBodyProps['t']; readonly onRetry: () => void }): ReactNode {
  return <div className={clsx(css.status, css.failed)} role="alert">
    <span>{t('failed')}</span>
    <Button size="sm" onClick={onRetry}>{t('retry')}</Button>
  </div>
}

/** @param props - localized copy. @returns the line shown when the owner delivered text pages instead of bytes. */
export function Unsupported({ t }: { readonly t: OfficeBodyProps['t'] }): ReactNode {
  return <p className={css.status} role="alert">{t('unsupported')}</p>
}
