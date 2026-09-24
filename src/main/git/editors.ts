import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * git sometimes wants to run an editor (commit messages on --continue, the
 * interactive-rebase todo list). GitClient never lets it open one: GIT_EDITOR
 * is a no-op and GIT_SEQUENCE_EDITOR is a tiny Node script run by the Electron
 * binary itself (ELECTRON_RUN_AS_NODE=1), which writes the todo list the app
 * generated. git runs both through its own POSIX shell (also on Windows, via
 * Git for Windows' sh), hence the single-quote quoting below. git itself is
 * still spawned with an argument array.
 */

const SEQUENCE_EDITOR = `'use strict'
// Invoked by git as: <editor> <path-to-git-rebase-todo>
const fs = require('fs')
const todoPath = process.argv[process.argv.length - 1]
const planFile = process.env.GITCLIENT_TODO_FILE
if (!planFile) process.exit(0)
if (process.env.GITCLIENT_TODO_MODE === 'transform') {
  // --rebase-merges: keep git's structure (labels, resets, merges) and only
  // change the actions of the picked commits.
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
  const out = []
  for (const line of fs.readFileSync(todoPath, 'utf8').split(/\\r?\\n/)) {
    const m = /^(pick|p)\\s+([0-9a-f]+)(.*)$/.exec(line)
    const entry = m && plan.find((e) => e.hash.startsWith(m[2]) || m[2].startsWith(e.hash))
    if (!entry) { out.push(line); continue }
    if (entry.action === 'drop') { out.push('drop ' + m[2] + m[3]); continue }
    out.push((entry.action === 'reword' ? 'pick' : entry.action) + ' ' + m[2] + m[3])
    for (const x of entry.exec || []) out.push('exec ' + x)
  }
  fs.writeFileSync(todoPath, out.join('\\n'))
} else {
  fs.copyFileSync(planFile, todoPath)
}
`

const NOOP_EDITOR = `'use strict'
// Accepts whatever message git prepared (GIT_EDITOR on Windows).
process.exit(0)
`

/** POSIX single-quote quoting for the editor command strings git passes to sh. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export interface EditorEnv {
  /** Environment for any git command that might open an editor. */
  base: Record<string, string>
  /** Adds the sequence editor for `git rebase -i` with a generated todo file. */
  sequence(todoFile: string, mode: 'replace' | 'transform'): Record<string, string>
}

let current: EditorEnv | null = null

/**
 * Writes the helper scripts into `dir` and computes the editor environment.
 * `execPath` is the Electron binary (process.execPath) — or plain node in tests.
 */
export function initEditors(dir: string, execPath: string, platform: NodeJS.Platform = process.platform): EditorEnv {
  mkdirSync(dir, { recursive: true })
  const seq = join(dir, 'sequence-editor.cjs')
  const noop = join(dir, 'noop-editor.cjs')
  writeFileSync(seq, SEQUENCE_EDITOR)
  writeFileSync(noop, NOOP_EDITOR)
  const node = shQuote(execPath.replace(/\\/g, '/'))
  const toSh = (p: string) => shQuote(p.replace(/\\/g, '/'))
  const gitEditor = platform === 'win32' ? `${node} ${toSh(noop)}` : 'true'
  const base = { GIT_EDITOR: gitEditor, ELECTRON_RUN_AS_NODE: '1', GIT_MERGE_AUTOEDIT: 'no' }
  current = {
    base,
    sequence: (todoFile, mode) => ({
      ...base,
      GIT_SEQUENCE_EDITOR: `${node} ${toSh(seq)}`,
      GITCLIENT_TODO_FILE: todoFile,
      GITCLIENT_TODO_MODE: mode
    })
  }
  return current
}

export function editorEnv(): EditorEnv {
  if (!current) throw new Error('initEditors() has not been called')
  return current
}
