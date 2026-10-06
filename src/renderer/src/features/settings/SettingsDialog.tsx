import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AI_TOOLS, AI_TOOL_LABEL, type Settings } from '@shared/types'
import { api } from '@/lib/api'
import { notifyError, run } from '@/lib/notify'
import { useAppStore } from '@/stores/app'
import { closeModal } from '@/stores/modals'
import { useTabsStore } from '@/stores/tabs'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

function Row({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[13rem_1fr] items-start gap-3 py-1.5">
      <div className="pt-1 text-[13px]">
        {label}
        {help && <div className="text-xs text-muted">{help}</div>}
      </div>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border-strong pb-2">
      <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  )
}

const select = 'h-7 rounded-md border border-border-strong bg-bg px-2 text-[13px]'

/** File → Settings (Ctrl+,). Every change is saved immediately. */
export function SettingsDialog() {
  const s = useAppStore((st) => st.settings)
  const gitStatus = useAppStore((st) => st.gitStatus)
  const update = useAppStore((st) => st.updateSettings)
  const setGitStatus = useAppStore((st) => st.setGitStatus)
  const activeRoot = useTabsStore((st) => st.tabs.find((t) => t.id === st.activeId)?.path ?? null)
  const qc = useQueryClient()
  const os = useQuery({ queryKey: ['os-integration'], queryFn: () => api.os.integration() })
  const rerere = useQuery({ queryKey: ['rerere', activeRoot], queryFn: () => api.conflicts.getRerere(activeRoot!), enabled: !!activeRoot })
  const tool = useQuery({ queryKey: ['configured-tool', activeRoot], queryFn: () => api.conflicts.configuredTool(activeRoot!), enabled: !!activeRoot })

  const aiTools = useQuery({ queryKey: ['ai-tools'], queryFn: () => api.ai.tools(), staleTime: 0, refetchOnMount: 'always' })
  const aiPath = s.aiCommitTool === 'auto' ? aiTools.data?.find((t) => t.path)?.path : aiTools.data?.find((t) => t.id === s.aiCommitTool)?.path

  const aiHelp = 'Prompt is sent to the CLI on stdin; the CLI runs in read-only mode in the repository folder.'

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    update({ [key]: value } as Partial<Settings>).catch((err) => notifyError(err, 'Could not save the setting'))
  }

  return (
    <Dialog open onOpenChange={(o) => !o && closeModal()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" aria-describedby={undefined} data-testid="settings-dialog">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Section title="General">
          <Row label="Theme">
            <select className={select} value={s.theme} onChange={(e) => set('theme', e.target.value as Settings['theme'])}>
              <option value="system">Follow the OS</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Row>
          <Row label="Reopen last session" help="Restore open repository tabs at startup">
            <Checkbox checked={s.reopenLastSession} onCheckedChange={(c) => set('reopenLastSession', c === true)} />
          </Row>
          <Row label="Date format">
            <select className={select} value={s.dateFormat} onChange={(e) => set('dateFormat', e.target.value as Settings['dateFormat'])}>
              <option value="relative">Relative (3 hours ago)</option>
              <option value="absolute">Absolute (locale)</option>
              <option value="iso">ISO (2026-09-24 14:05)</option>
            </select>
          </Row>
          <Row label="Check for updates at startup">
            <Checkbox checked={s.checkForUpdates} onCheckedChange={(c) => set('checkForUpdates', c === true)} />
          </Row>
        </Section>

        <Section title="Git">
          <Row label="Git executable" help={gitStatus?.state === 'ok' ? `Using ${gitStatus.git.path} (${gitStatus.git.version})` : 'Not found'}>
            <Input readOnly value={s.gitPath ?? 'Auto-detect'} className="flex-1" />
            <Button size="sm" variant="secondary" onClick={() => run(async () => setGitStatus(await api.git.pickExecutable()))}>
              Choose…
            </Button>
            {s.gitPath && (
              <Button size="sm" variant="ghost" onClick={() => set('gitPath', null)}>
                Auto-detect
              </Button>
            )}
          </Row>
          <Row label="Default pull mode">
            <select className={select} value={s.pullMode} onChange={(e) => set('pullMode', e.target.value as Settings['pullMode'])}>
              <option value="merge">Merge</option>
              <option value="rebase">Rebase</option>
              <option value="ff-only">Fast-forward only</option>
            </select>
          </Row>
          <Row label="Auto-fetch" help="Background fetch of all remotes for open repositories">
            <select className={select} value={s.autoFetchMinutes} onChange={(e) => set('autoFetchMinutes', Number(e.target.value) as Settings['autoFetchMinutes'])}>
              <option value={0}>Off</option>
              <option value={5}>Every 5 minutes</option>
              <option value={15}>Every 15 minutes</option>
            </select>
          </Row>
          <Row label="Confirm large pushes" help="Destructive actions (hard reset, force push, drop, discard…) always ask">
            <Checkbox checked={s.confirmPush} onCheckedChange={(c) => set('confirmPush', c === true)} />
          </Row>
          <Row label="Force worktree removal by default" help="Pre-tick “Force (git worktree remove -f -f)” in the Remove Worktree dialog">
            <Checkbox checked={s.worktreeForceRemove} onCheckedChange={(c) => set('worktreeForceRemove', c === true)} />
          </Row>
        </Section>

        <Section title="Conflicts">
          <Row
            label="Reuse recorded resolutions (rerere)"
            help={activeRoot ? 'For the current repository: git remembers how you resolved a conflict and reapplies it next time.' : 'Open a repository to change this.'}
          >
            <Checkbox
              disabled={!activeRoot || rerere.isLoading}
              checked={rerere.data ?? false}
              onCheckedChange={(c) =>
                run(async () => {
                  await api.conflicts.setRerere(activeRoot!, c === true)
                  void qc.invalidateQueries({ queryKey: ['rerere', activeRoot] })
                })
              }
            />
          </Row>
          <Row label="External merge tool" help={tool.data ? `git config merge.tool = ${tool.data}` : 'Empty: use git config merge.tool'}>
            <Input value={s.mergeTool} placeholder={tool.data ?? 'e.g. meld, kdiff3, bc'} onChange={(e) => set('mergeTool', e.target.value)} />
          </Row>
        </Section>

        <Section title="Tools">
          <Row
            label="AI commit messages"
            help={aiPath ? `Using ${aiPath}. ${aiHelp}` : aiHelp}
          >
            <select className={select} value={s.aiCommitTool} onChange={(e) => set('aiCommitTool', e.target.value as Settings['aiCommitTool'])} data-testid="ai-tool-select">
              <option value="auto">Auto-detect (first installed)</option>
              {AI_TOOLS.map((id) => (
                <option key={id} value={id}>
                  {AI_TOOL_LABEL[id]}
                  {aiTools.data && aiTools.data.find((t) => t.id === id)?.path === null ? ' (not installed)' : ''}
                </option>
              ))}
            </select>
            <Button size="sm" variant="ghost" disabled={aiTools.isFetching} onClick={() => void aiTools.refetch()}>
              Refresh
            </Button>
          </Row>
          <Row label="Editor command" help="Used by “Open in Editor”; the path is appended">
            <Input value={s.editorCommand} onChange={(e) => set('editorCommand', e.target.value)} placeholder="code" />
          </Row>
          <Row label="Terminal command" help="Empty: auto-detect">
            <Input value={s.terminalCommand} onChange={(e) => set('terminalCommand', e.target.value)} placeholder="gnome-terminal" />
          </Row>
          <Row label="Scan depth" help="Default folder depth for Scan Folder for Repositories">
            <Input type="number" min={0} max={12} className="w-24" value={s.scanMaxDepth} onChange={(e) => set('scanMaxDepth', Math.max(0, Math.min(12, Number(e.target.value) || 0)))} />
          </Row>
        </Section>

        {os.data && (os.data.platform === 'win32' || os.data.platform === 'linux') && (
          <Section title="Integration">
            {os.data.platform === 'win32' && (
              <Row label="Explorer context menu" help="“Open in GitClient” on folders">
                <Checkbox
                  checked={os.data.explorerMenu === true}
                  onCheckedChange={(c) =>
                    run(async () => {
                      await api.os.setExplorerMenu(c === true)
                      await os.refetch()
                      toast.success(c === true ? 'Explorer entry added' : 'Explorer entry removed')
                    })
                  }
                />
              </Row>
            )}
            {os.data.platform === 'linux' && (
              <Row
                label="File manager script"
                help={`“Open in GitClient” in the Scripts menu of Nautilus / Nemo${os.data.fileManagerScripts?.nautilus === null && os.data.fileManagerScripts?.nemo === null ? ' (neither found for this user)' : ''}`}
              >
                <Checkbox
                  checked={!!(os.data.fileManagerScripts?.nautilus || os.data.fileManagerScripts?.nemo)}
                  onCheckedChange={(c) =>
                    run(async () => {
                      await api.os.setFileManagerScripts(c === true)
                      await os.refetch()
                    })
                  }
                />
              </Row>
            )}
          </Section>
        )}

        <DialogFooter>
          <Button onClick={closeModal}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
