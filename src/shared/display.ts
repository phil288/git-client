/** Pure display helpers shared by renderer and tests. */

/** Replace the home directory prefix with ~ (Linux/macOS only, like a shell prompt). */
export function shortenHome(path: string, homeDir: string, platform: string): string {
  if (platform === 'win32' || !homeDir) return path
  if (path === homeDir) return '~'
  const prefix = homeDir.endsWith('/') ? homeDir : homeDir + '/'
  return path.startsWith(prefix) ? '~/' + path.slice(prefix.length) : path
}

/** Last path segment, accepting both separators. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

/** Up to two initials: "git-manager" -> "GM", "backend" -> "BA", "MyRepo" -> "MR". */
export function repoInitials(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s\-_.]+/)
    .filter(Boolean)
  if (words.length >= 2) return ((words[0]![0] ?? '') + (words[1]![0] ?? '')).toUpperCase()
  const w = words[0] ?? name
  return w.slice(0, 2).toUpperCase()
}

/** Deterministic hue from a string (for avatars). */
export function stringHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

/** "3 minutes ago", "yesterday", "5 days ago"... */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp)
  const sec = Math.floor(diff / 1000)
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return min <= 1 ? '1 minute ago' : `${min} minutes ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`
  const years = Math.floor(days / 365)
  return years <= 1 ? '1 year ago' : `${years} years ago`
}

/** Display form of a command, quoting args with spaces. Never executed. */
export function formatCommand(args: readonly string[]): string {
  return ['git', ...args].map((a) => (/[\s"'$`\\]/.test(a) || a === '' ? JSON.stringify(a) : a)).join(' ')
}

/** Folder name git would create for a clone URL ("https://x/y/repo.git" -> "repo"). */
export function cloneDirName(url: string): string {
  const cleaned = url.trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '').replace(/[\\/]+$/, '')
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'), cleaned.lastIndexOf(':'))
  const name = idx >= 0 ? cleaned.slice(idx + 1) : cleaned
  return name.replace(/[<>:"|?*]/g, '')
}
