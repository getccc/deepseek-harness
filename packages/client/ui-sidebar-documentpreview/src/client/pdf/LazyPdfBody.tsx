/** Load the PDF renderer only after a PDF body or complete-document view is mounted. */
import { lazy, Suspense, type ReactNode } from 'react'
import { LoadingIndicator } from '../LoadingIndicator.tsx'
import css from '../TextPreview.module.css'
import type { PdfBodyProps, PdfViewProps } from './pdf.tsx'

const LoadedPdfBody = lazy(async () => ({ default: (await import('./pdf.tsx')).PdfBody }))

const LoadedPdfView = lazy(async () => ({ default: (await import('./pdf.tsx')).PdfView }))

/**
 * Suspend while the package-local PDF chunk arrives.
 * @param props - PDF body props supplied by the document slot.
 * @returns the deferred PDF renderer.
 */
export function LazyPdfBody(props: PdfBodyProps): ReactNode {
  return <Suspense fallback={<LoadingIndicator className={css.status} label={props.t('loading')} />}>
    <LoadedPdfBody {...props} />
  </Suspense>
}

/**
 * Suspend while the package-local PDF chunk arrives for a complete-document view.
 * @param props - view props supplied by the `document.view` chain.
 * @returns the deferred PDF reader.
 */
export function LazyPdfView(props: PdfViewProps): ReactNode {
  return <Suspense fallback={<LoadingIndicator className={css.status} label={props.t('loading')} />}>
    <LoadedPdfView {...props} />
  </Suspense>
}
