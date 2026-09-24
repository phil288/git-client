import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Cloud, Crosshair, GitBranch, Tag } from 'lucide-react'
import { fuzzyFilter } from '@shared/fuzzy'
import type { Ref, RefKind } from '@shared/types'
import { compareVersionNames } from '@shared/versions'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { useRefs } from '../log/LogView'

/** A revision picked in a RefSelect: `rev` is passed to git, `label` is shown. */
export interface RefChoice {
  rev: string
  label: string
}

type Item = { kind: 'head' | RefKind; rev: string; label: string }

const SECTION: Record<Item['kind'], string> = { head: '', local: 'Local', remote: 'Remote', tag: 'Tags' }

function icon(kind: Item['kind']) {
  if (kind === 'head') return <Crosshair className="size-3.5 shrink-0 opacity-70" />
  if (kind === 'remote') return <Cloud className="size-3.5 shrink-0 opacity-70" />
  if (kind === 'tag') return <Tag className="size-3.5 shrink-0 opacity-70" />
  return <GitBranch className="size-3.5 shrink-0 opacity-70" />
}

/** Searchable picker over HEAD, local and remote branches and tags (full ref names, so a branch and a tag may share a name). */
export function RefSelect({
  root,
  value,
  onChange,
  headLabel,
  testId
}: {
  root: string
  value: RefChoice
  onChange(v: RefChoice): void
  /** Current branch shown next to HEAD. */
  headLabel?: string | null
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const refs = useRefs(root)

  const items = useMemo<Item[]>(() => {
    const all = refs.data ?? []
    const by = (k: RefKind) => all.filter((r) => r.kind === k)
    const toItem = (r: Ref): Item => ({ kind: r.kind, rev: r.name, label: r.short })
    const list: Item[] = [
      { kind: 'head', rev: 'HEAD', label: headLabel ? `HEAD (${headLabel})` : 'HEAD' },
      ...by('local').sort((a, b) => Number(b.isHead) - Number(a.isHead) || b.date - a.date).map(toItem),
      ...by('remote').sort((a, b) => b.date - a.date).map(toItem),
      ...by('tag').sort((a, b) => compareVersionNames(b.short, a.short)).map(toItem)
    ]
    return fuzzyFilter(list, query, (i) => [i.label])
  }, [refs.data, query, headLabel])

  useEffect(() => setIndex(0), [query, open])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const pick = (item: Item | undefined) => {
    if (!item) return
    setOpen(false)
    setQuery('')
    onChange({ rev: item.rev, label: item.kind === 'head' ? (headLabel ?? 'HEAD') : item.label })
  }
  const current = items.find((i) => i.rev === value.rev)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex h-7 min-w-0 max-w-72 items-center gap-1.5 rounded-md border border-border-strong bg-bg px-2 text-[13px] hover:bg-hover"
          data-testid={testId}
        >
          {icon(current?.kind ?? (value.rev.startsWith('refs/tags/') ? 'tag' : 'local'))}
          <span className="truncate">{value.label}</span>
          <ChevronDown className="ml-auto size-3 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-2">
          <Input
            autoFocus
            placeholder="Search branches and tags"
            value={query}
            data-testid={testId && `${testId}-search`}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(items.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                pick(items[index])
              }
            }}
          />
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto px-1 pb-1">
          {refs.isLoading && <div className="px-3 py-2 text-muted">Loading…</div>}
          {refs.data && items.length === 0 && <div className="px-3 py-2 text-muted">No matching branches or tags</div>}
          {items.map((item, i) => {
            const section = !query.trim() && item.kind !== items[i - 1]?.kind ? SECTION[item.kind] : ''
            return (
              <div key={item.rev}>
                {section && <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase text-muted">{section}</div>}
                <div
                  data-index={i}
                  data-testid="ref-select-item"
                  onMouseMove={() => setIndex(i)}
                  onClick={() => pick(item)}
                  className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px]', i === index && 'bg-accent text-accent-fg')}
                >
                  {icon(item.kind)}
                  <span className={cn('truncate', item.rev === value.rev && 'font-semibold')}>{item.label}</span>
                </div>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
