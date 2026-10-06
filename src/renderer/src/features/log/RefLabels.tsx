import { Cloud, GitBranch, Tag } from 'lucide-react'
import type { Ref } from '@shared/types'
import { cn } from '@/lib/utils'

/** Branch / remote / tag chips, styled per kind. */
export function RefLabels({ refs, detachedHead, max = 3 }: { refs: Ref[]; detachedHead?: boolean; max?: number }) {
  if (refs.length === 0 && !detachedHead) return null
  const sorted = [...refs].sort((a, b) => Number(b.isHead) - Number(a.isHead) || order(a) - order(b))
  const shown = sorted.slice(0, max)
  const rest = sorted.length - shown.length
  return (
    <span className="flex shrink-0 items-center gap-1" title={sorted.map((r) => r.short).join(', ')}>
      {detachedHead && <span className="rounded border border-accent px-1 text-[11px] font-semibold text-accent">HEAD</span>}
      {shown.map((r) => (
        <span
          key={r.name}
          className={cn(
            'flex max-w-44 items-center gap-0.5 truncate rounded px-1 text-[11px] leading-4',
            r.kind === 'local' && 'bg-[color-mix(in_srgb,var(--ref-local)_18%,transparent)] text-[var(--ref-local)]',
            r.kind === 'remote' && 'bg-[color-mix(in_srgb,var(--ref-remote)_18%,transparent)] text-[var(--ref-remote)]',
            r.kind === 'tag' && 'bg-[color-mix(in_srgb,var(--ref-tag)_18%,transparent)] text-[var(--ref-tag)]',
            r.isHead && 'font-semibold ring-1 ring-current'
          )}
        >
          {r.kind === 'local' && <GitBranch className="size-3 shrink-0" />}
          {r.kind === 'remote' && <Cloud className="size-3 shrink-0" />}
          {r.kind === 'tag' && <Tag className="size-3 shrink-0" />}
          <span className="truncate">{r.short}</span>
        </span>
      ))}
      {rest > 0 && <span className="text-[11px] text-muted">+{rest}</span>}
    </span>
  )
}

function order(r: Ref): number {
  return r.kind === 'local' ? 0 : r.kind === 'remote' ? 1 : 2
}
