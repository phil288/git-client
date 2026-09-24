import { lazy, Suspense, type ComponentProps } from 'react'
import { Loader2 } from 'lucide-react'
import type { DiffViewer as DiffViewerImpl } from './DiffViewer'

export type { DiffSide } from './DiffViewer'

/**
 * Monaco is most of the renderer bundle (~2.5 MB of JS). Loading it with the
 * first diff instead of at startup keeps it off the launch path; later diffs
 * reuse the loaded chunk.
 */
const Impl = lazy(() => import('./DiffViewer').then((m) => ({ default: m.DiffViewer })))

export function DiffViewer(props: ComponentProps<typeof DiffViewerImpl>) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center gap-2 text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading diff…
        </div>
      }
    >
      <Impl {...props} />
    </Suspense>
  )
}
