import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CaseSensitive, ChevronDown, Crosshair, Regex, Search, X } from 'lucide-react'
import { fuzzyFilter } from '@shared/fuzzy'
import type { LogQuery, Ref } from '@shared/types'
import { api } from '@/lib/api'
import { notifyError } from '@/lib/notify'
import { cn, isPrimaryModifier } from '@/lib/utils'
import { prompt } from '@/stores/dialogs'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface Props {
  root: string
  query: LogQuery
  setQuery(q: LogQuery): void
  goTo(hash: string): Promise<void>
  refs: Ref[]
  /** Authors seen in the loaded commits, most frequent first. */
  authors: string[]
}

function FilterButton({ label, value, active, onClear, children, open, onOpenChange }: {
  label: string
  value: string
  active: boolean
  onClear(): void
  children: React.ReactNode
  open?: boolean
  onOpenChange?(o: boolean): void
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div className={cn('flex h-6 items-center rounded text-xs', active ? 'bg-selected text-fg' : 'text-muted hover:bg-hover')}>
        <PopoverTrigger asChild>
          <button className="flex h-full items-center gap-1 px-2" data-testid={`filter-${label.toLowerCase()}`}>
            {label}
            {active && <span className="max-w-40 truncate font-medium">: {value}</span>}
            {!active && <ChevronDown className="size-3" />}
          </button>
        </PopoverTrigger>
        {active && (
          <button className="pr-1.5 opacity-70 hover:opacity-100" title={`Clear ${label.toLowerCase()} filter`} onClick={onClear}>
            <X className="size-3" />
          </button>
        )}
      </div>
      <PopoverContent className="w-80 p-2 text-[13px]">{children}</PopoverContent>
    </Popover>
  )
}

function BranchFilter({ refs, selected, onChange }: { refs: Ref[]; selected: string[]; onChange(revs: string[]): void }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => fuzzyFilter(refs, q, (r) => [r.short]).slice(0, 300), [refs, q])
  const sel = new Set(selected)
  const head = refs.find((r) => r.isHead)
  return (
    <div className="flex flex-col gap-2">
      <Input autoFocus placeholder="Filter branches and tags" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex gap-2 text-xs">
        <button className="text-accent hover:underline" onClick={() => onChange([])}>
          All
        </button>
        {head && (
          <button className="text-accent hover:underline" onClick={() => onChange([head.name])}>
            Current branch only
          </button>
        )}
        <button className="text-accent hover:underline" onClick={() => onChange(['HEAD'])}>
          HEAD
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {list.map((r) => (
          <label key={r.name} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-hover">
            <Checkbox
              checked={sel.has(r.name)}
              onCheckedChange={(c) => onChange(c === true ? [...selected, r.name] : selected.filter((x) => x !== r.name))}
            />
            <span className="truncate">{r.short}</span>
            <span className="ml-auto text-[11px] text-muted">{r.kind}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

const DATE_PRESETS: { label: string; since: string }[] = [
  { label: 'Last 24 hours', since: '24 hours ago' },
  { label: 'Last 7 days', since: '7 days ago' },
  { label: 'Last 30 days', since: '30 days ago' },
  { label: 'Last year', since: '1 year ago' }
]

/** Search + Branch/User/Date/Paths filters + Go to, above the log table. */
export function LogToolbar({ root, query, setQuery, goTo, refs, authors }: Props) {
  const [text, setText] = useState(query.text ?? '')
  const [branchOpen, setBranchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [newAuthor, setNewAuthor] = useState('')
  const [newPath, setNewPath] = useState('')
  const me = useQuery({ queryKey: ['repo', root, 'config', 'user.email'], queryFn: () => api.repo.config(root, 'user.email') })

  useEffect(() => setText(query.text ?? ''), [query.text])

  // Apply the search text after a short pause.
  useEffect(() => {
    if ((query.text ?? '') === text) return
    const t = setTimeout(() => setQuery({ ...query, text: text || undefined }), 450)
    return () => clearTimeout(t)
  }, [text, query, setQuery])

  const goToPrompt = async () => {
    const rev = await prompt({ title: 'Go to Hash/Branch/Tag', placeholder: 'e.g. 3f2a9c1, main, v1.2.0', confirmLabel: 'Go' })
    if (!rev?.trim()) return
    const hash = await api.repo.resolveRev(root, rev.trim())
    if (!hash) {
      notifyError(new Error(`“${rev}” is not a known commit, branch or tag.`))
      return
    }
    await goTo(hash)
  }

  // Ctrl+F search, Ctrl+Shift+F branch filter, Ctrl+G go to.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPrimaryModifier(e) || e.altKey) return
      if ((e.target as HTMLElement | null)?.closest('.monaco-editor')) return
      if (document.querySelector('[role="dialog"]')) return
      const k = e.key.toLowerCase()
      if (k === 'f' && e.shiftKey) {
        e.preventDefault()
        setBranchOpen(true)
      } else if (k === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (k === 'g' && !e.shiftKey) {
        e.preventDefault()
        void goToPrompt()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const revLabel = query.revs.map((r) => refs.find((x) => x.name === r)?.short ?? r)
  const authorsSel = query.authors ?? []
  const pathsSel = query.paths ?? []
  const dateActive = !!(query.since || query.until)
  const anyFilter = !!(query.text || query.revs.length || authorsSel.length || pathsSel.length || dateActive)
  const toRelative = (abs: string) => {
    const norm = abs.replace(/\\/g, '/')
    const r = root.replace(/\\/g, '/').replace(/\/$/, '')
    return norm.startsWith(r + '/') ? norm.slice(r.length + 1) : null
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border-strong bg-panel px-2" data-testid="log-toolbar">
      <div className="relative w-64 shrink-0">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
        <Input
          ref={searchRef}
          data-testid="log-search"
          className="h-6 pl-7 pr-14 text-xs"
          placeholder="Text or hash (Ctrl+F)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setQuery({ ...query, text: text || undefined })
            if (e.key === 'Escape') setText('')
          }}
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
          <button
            title="Regex"
            className={cn('rounded p-0.5', query.regex ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-hover')}
            onClick={() => setQuery({ ...query, regex: !query.regex })}
          >
            <Regex className="size-3.5" />
          </button>
          <button
            title="Match case"
            className={cn('rounded p-0.5', query.matchCase ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-hover')}
            onClick={() => setQuery({ ...query, matchCase: !query.matchCase })}
          >
            <CaseSensitive className="size-3.5" />
          </button>
        </div>
      </div>

      <FilterButton
        label="Branch"
        value={revLabel.length > 2 ? `${revLabel.slice(0, 2).join(', ')} +${revLabel.length - 2}` : revLabel.join(', ')}
        active={query.revs.length > 0}
        onClear={() => setQuery({ ...query, revs: [] })}
        open={branchOpen}
        onOpenChange={setBranchOpen}
      >
        <BranchFilter refs={refs} selected={query.revs} onChange={(revs) => setQuery({ ...query, revs })} />
      </FilterButton>

      <FilterButton
        label="User"
        value={authorsSel.map((a) => (a === me.data ? 'me' : a)).join(', ')}
        active={authorsSel.length > 0}
        onClear={() => setQuery({ ...query, authors: [] })}
      >
        <div className="flex flex-col gap-2">
          {me.data && (
            <label className="flex items-center gap-2">
              <Checkbox
                checked={authorsSel.includes(me.data)}
                onCheckedChange={(c) =>
                  setQuery({ ...query, authors: c === true ? [...authorsSel, me.data!] : authorsSel.filter((a) => a !== me.data) })
                }
              />
              me <span className="text-xs text-muted">({me.data})</span>
            </label>
          )}
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (newAuthor.trim()) setQuery({ ...query, authors: [...authorsSel, newAuthor.trim()] })
              setNewAuthor('')
            }}
          >
            <Input placeholder="Name or e-mail (Enter to add)" value={newAuthor} onChange={(e) => setNewAuthor(e.target.value)} />
          </form>
          <div className="max-h-56 overflow-y-auto">
            {[...new Set([...authorsSel.filter((a) => a !== me.data), ...authors])].slice(0, 50).map((a) => (
              <label key={a} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-hover">
                <Checkbox
                  checked={authorsSel.includes(a)}
                  onCheckedChange={(c) => setQuery({ ...query, authors: c === true ? [...authorsSel, a] : authorsSel.filter((x) => x !== a) })}
                />
                <span className="truncate">{a}</span>
              </label>
            ))}
          </div>
        </div>
      </FilterButton>

      <FilterButton
        label="Date"
        value={[query.since && `since ${query.since}`, query.until && `until ${query.until}`].filter(Boolean).join(' ')}
        active={dateActive}
        onClear={() => setQuery({ ...query, since: undefined, until: undefined })}
      >
        <div className="flex flex-col gap-1">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.label}
              className={cn('rounded px-2 py-1 text-left hover:bg-hover', query.since === p.since && !query.until && 'bg-selected')}
              onClick={() => setQuery({ ...query, since: p.since, until: undefined })}
            >
              {p.label}
            </button>
          ))}
          <div className="mt-2 grid grid-cols-[3.5rem_1fr] items-center gap-1 text-xs text-muted">
            Since
            <Input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(query.since ?? '') ? query.since : ''} onChange={(e) => setQuery({ ...query, since: e.target.value || undefined })} />
            Until
            <Input type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(query.until ?? '') ? query.until : ''} onChange={(e) => setQuery({ ...query, until: e.target.value || undefined })} />
          </div>
        </div>
      </FilterButton>

      <FilterButton
        label="Paths"
        value={pathsSel.length === 1 ? pathsSel[0]! : `${pathsSel.length} paths`}
        active={pathsSel.length > 0}
        onClear={() => setQuery({ ...query, paths: [] })}
      >
        <div className="flex flex-col gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const p = newPath.trim().replace(/\\/g, '/').replace(/^\.\//, '')
              if (p) setQuery({ ...query, paths: [...pathsSel, p] })
              setNewPath('')
            }}
          >
            <Input placeholder="Path relative to the repository (Enter to add)" value={newPath} onChange={(e) => setNewPath(e.target.value)} />
          </form>
          <div className="flex gap-2 text-xs">
            {(['files', 'folders'] as const).map((kind) => (
              <button
                key={kind}
                className="text-accent hover:underline"
                onClick={async () => {
                  const picked = await api.dialog.pickPaths(`Choose ${kind}`, root, kind)
                  const rel = picked.map(toRelative)
                  if (rel.some((r) => r === null)) notifyError(new Error('Only paths inside this repository can be used as a filter.'))
                  const ok = rel.filter((r): r is string => !!r)
                  if (ok.length) setQuery({ ...query, paths: [...new Set([...pathsSel, ...ok])] })
                }}
              >
                Choose {kind}…
              </button>
            ))}
          </div>
          {pathsSel.map((p) => (
            <div key={p} className="flex items-center gap-2 rounded px-1 hover:bg-hover">
              <span className="truncate font-mono text-xs">{p}</span>
              <button className="ml-auto text-muted hover:text-fg" onClick={() => setQuery({ ...query, paths: pathsSel.filter((x) => x !== p) })}>
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      </FilterButton>

      {anyFilter && (
        <button
          className="ml-1 text-xs text-accent hover:underline"
          onClick={() => {
            setText('')
            setQuery({ revs: [] })
          }}
        >
          Clear filters
        </button>
      )}
      <button className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-fg" title="Go to Hash/Branch/Tag (Ctrl+G)" onClick={() => void goToPrompt()}>
        <Crosshair className="size-3.5" /> Go to
      </button>
    </div>
  )
}
