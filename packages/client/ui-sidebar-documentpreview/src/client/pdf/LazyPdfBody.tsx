/** Load the PDF renderer only after a PDF body or complete-document view is mounted. */
import { lazy, Suspense, type ReactNode } from 'react'
import { LoadingIndicator } from '../LoadingIndicator.tsx'
import { ZoomViewport, zoomSurfaceClass } from '../zoom/ZoomViewport.tsx'
import type { PdfBodyProps, PdfViewProps } from './pdf.tsx'

const LoadedPdfBody = lazy(async () => ({ default: (await import('./pdf.tsx')).PdfBody }))

const LoadedPdfView = lazy(async () => ({ default: (await import('./pdf.tsx')).PdfView }))

/**
 * Suspend while the package-local PDF chunk arrives.
 * @param props - PDF body props supplied by the document slot.
 * @returns the deferred PDF renderer.
 */
export function LazyPdfBody(props: PdfBodyProps): ReactNode {
  const loading = <LoadingIndicator label={props.t('loading')} />
  return <Suspense fallback={loading}>
    <LoadedPdfBody {...props} loading={loading} />
  </Suspense>
}

/**
 * Suspend while the package-local PDF chunk arrives for a complete-document
 * view, handing the chunk this bundle's zoom viewport.
 * @param props - view props supplied by the `document.view` chain.
 * @returns the deferred PDF reader.
 */
export function LazyPdfView(props: PdfViewProps): ReactNode {
  const loading = <LoadingIndicator label={props.t('loading')} />
  return <Suspense fallback={loading}>
    <LoadedPdfView {...props} loading={loading} ZoomViewport={ZoomViewport} zoomSurfaceClass={zoomSurfaceClass} />
  </Suspense>
}
