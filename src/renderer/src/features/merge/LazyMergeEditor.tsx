import { lazy, Suspense, type ComponentProps } from 'react'
import { Loader2 } from 'lucide-react'
import type { MergeEditor as MergeEditorImpl } from './MergeEditor'

/** Loads Monaco with the first merge editor, not at startup (see LazyDiffViewer). */
const Impl = lazy(() => import('./MergeEditor').then((m) => ({ default: m.MergeEditor })))

export function MergeEditor(props: ComponentProps<typeof MergeEditorImpl>) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center gap-2 text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading merge editor…
        </div>
      }
    >
      <Impl {...props} />
    </Suspense>
  )
}
