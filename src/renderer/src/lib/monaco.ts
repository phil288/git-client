/**
 * Monaco is bundled locally (no CDN): the editor API, the basic (Monarch)
 * languages for syntax colouring and a single editor worker. No language
 * services — a Git client only needs highlighting and diffing.
 */
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/basic-languages/monaco.contribution'
// editor.api ships no contributions: add find/replace (Ctrl+F / Ctrl+H) and
// the editing basics the merge result needs (clipboard, context menu, line
// and word operations, multi-cursor, comment toggling, cursor undo).
import 'monaco-editor/features/find/register'
import 'monaco-editor/features/clipboard/register'
import 'monaco-editor/features/contextmenu/register'
import 'monaco-editor/features/linesOperations/register'
import 'monaco-editor/features/wordOperations/register'
import 'monaco-editor/features/multicursor/register'
import 'monaco-editor/features/comment/register'
import 'monaco-editor/features/cursorUndo/register'
import 'monaco-editor/features/bracketMatching/register'
import 'monaco-codicon.css'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import { loader } from '@monaco-editor/react'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco })

monaco.editor.defineTheme('gitclient-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1e1f22',
    'editorGutter.background': '#1e1f22',
    'diffEditor.insertedTextBackground': '#2e7d3240',
    'diffEditor.removedTextBackground': '#c6282840',
    'diffEditor.insertedLineBackground': '#29432e80',
    'diffEditor.removedLineBackground': '#48302f80'
  }
})
monaco.editor.defineTheme('gitclient-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'diffEditor.insertedLineBackground': '#e6f4ea',
    'diffEditor.removedLineBackground': '#fce8e6'
  }
})

let byExt: Map<string, string> | null = null
let byName: Map<string, string> | null = null

/** Monaco language id for a path (by file name, then extension). */
export function languageForPath(path: string): string {
  if (!byExt || !byName) {
    byExt = new Map()
    byName = new Map()
    for (const l of monaco.languages.getLanguages()) {
      for (const e of l.extensions ?? []) byExt.set(e.toLowerCase(), l.id)
      for (const f of l.filenames ?? []) byName.set(f.toLowerCase(), l.id)
    }
  }
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const direct = byName.get(name)
  if (direct) return direct
  const dot = name.lastIndexOf('.')
  return (dot >= 0 && byExt.get(name.slice(dot))) || 'plaintext'
}

export { monaco }
