import { closeModal } from '@/stores/modals'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Repositories & tabs',
    items: [
      ['Ctrl+O', 'Open folder / repository'],
      ['Ctrl+E, Ctrl+Shift+O', 'Recent repositories'],
      ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous tab'],
      ['Ctrl+1 … Ctrl+9', 'Go to tab (9 = last)'],
      ['Ctrl+W', 'Close tab'],
      ['Ctrl+K', 'Commit view'],
      ['Alt+9', 'Git Console'],
      ['Ctrl+,', 'Settings']
    ]
  },
  {
    title: 'Log',
    items: [
      ['↑ / ↓, PgUp / PgDn, Home / End', 'Move selection (Shift extends)'],
      ['← / →', 'Go to parent / child'],
      ['Ctrl+click, Shift+click', 'Multi-select'],
      ['Ctrl+F', 'Search text / hash / author'],
      ['Ctrl+Shift+F', 'Branch filter'],
      ['Ctrl+G', 'Go to hash / branch / tag']
    ]
  },
  {
    title: 'Commit & merge',
    items: [
      ['Ctrl+Enter', 'Commit (Shift: commit and push)'],
      ['Ctrl+Shift+G', 'Generate commit message with the AI CLI (Commit view)'],
      ['F7 / Shift+F7', 'Next / previous conflict in the merge editor'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo in the merge result (actions included)'],
      ['Delete', 'Delete selected branches (branches panel)']
    ]
  }
]

export function ShortcutsDialog() {
  return (
    <Dialog open onOpenChange={(o) => !o && closeModal()}>
      <DialogContent className="max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</div>
            {g.items.map(([k, d]) => (
              <div key={k} className="flex justify-between gap-4 py-0.5 text-[13px]">
                <span>{d}</span>
                <Kbd>{k}</Kbd>
              </div>
            ))}
          </div>
        ))}
        <DialogFooter>
          <Button onClick={closeModal}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
