/** Normalises what a coding-agent CLI printed into a plain commit message (pure). */

const LABEL_RE = /^(?:\*\*)?(?:here(?:'s| is) (?:the |a |your )?(?:suggested |proposed )?commit message|(?:suggested |proposed )?commit message)(?:\*\*)?\s*:(?:\*\*)?\s*/i
const TRAILER_RE = /^\s*(?:co-authored-by:|signed-off-by:|(?:🤖\s*)?generated (?:with|by)\b)/i
const QUOTES: Partial<Record<string, string>> = { '"': '"', "'": "'", '`': '`', '“': '”' }

export function cleanCommitMessage(raw: string): string {
  // eslint-disable-next-line no-control-regex -- strips ANSI colour codes a CLI may print despite NO_COLOR
  let text = raw.replace(/\r\n?/g, '\n').replace(/\u001b\[[0-9;]*m/g, '').trim()

  // A fenced block anywhere: the message is its content (models add prose around it).
  const fence = /```[\w-]*[ \t]*\n([\s\S]*?)\n?```/.exec(text)
  if (fence) text = (fence[1] ?? '').trim()

  // "Commit message:" / "Here is the commit message:" label on the first line.
  const label = LABEL_RE.exec(text)
  if (label) text = text.slice(label[0].length).trim()

  // Whole message wrapped in quotes.
  const close = QUOTES[text.charAt(0)]
  if (close && text.length > 1 && text.endsWith(close) && !text.slice(1, -1).includes(close)) text = text.slice(1, -1).trim()

  let lines = text.split('\n').map((l) => l.replace(/\s+$/, ''))
  // The app has its own sign-off option; tool-added trailers never belong here.
  lines = lines.filter((l) => !TRAILER_RE.test(l))
  text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (text === '') return ''

  lines = text.split('\n')
  if (lines.length > 1 && lines[1]?.trim() !== '') lines.splice(1, 0, '')
  return lines.join('\n')
}
