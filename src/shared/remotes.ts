/** Pure helpers for remote URLs and names (shared by the Remotes view, its dialog and tests). */

export type RemoteProtocol = 'ssh' | 'https' | 'http' | 'git' | 'file' | 'local' | 'unknown'
export type RemoteProvider = 'GitHub' | 'GitLab' | 'Bitbucket' | 'Codeberg' | 'Azure DevOps'

export interface ParsedRemoteUrl {
  protocol: RemoteProtocol
  host: string | null
  /** Repository path on the host without leading slash or trailing .git, e.g. owner/repo. */
  path: string | null
  provider: RemoteProvider | null
  /** https page of the repository, when it can be derived reliably. */
  webUrl: string | null
  /** The same repository over SSH / HTTPS (well-known providers only), or null. */
  sshUrl: string | null
  httpsUrl: string | null
  /** The URL embeds a password or token (stored in plain text in .git/config). */
  hasPassword: boolean
}

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\/(?:([^@/]*)@)?(\[[^\]]+\]|[^/:?#]+)(?::(\d*))?(\/[^?#]*)?/i
/** scp-like syntax: [user@]host:path (not a Windows drive letter, not host://). */
const SCP = /^(?:([^@/\s]+)@)?([^:/\s]+):(?!\/\/)(.+)$/

function providerOf(host: string): RemoteProvider | null {
  const h = host.toLowerCase()
  if (h === 'github.com' || h === 'ssh.github.com') return 'GitHub'
  if (h === 'gitlab.com' || h === 'altssh.gitlab.com') return 'GitLab'
  if (h === 'bitbucket.org' || h === 'altssh.bitbucket.org') return 'Bitbucket'
  if (h === 'codeberg.org') return 'Codeberg'
  if (h === 'dev.azure.com' || h === 'ssh.dev.azure.com' || h.endsWith('.visualstudio.com')) return 'Azure DevOps'
  return null
}

/** Canonical web host for SSH aliases (ssh.github.com → github.com). */
function webHost(host: string): string {
  return host.toLowerCase().replace(/^(ssh|altssh)\./, '')
}

function trimPath(p: string): string {
  return p.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '')
}

export function parseRemoteUrl(raw: string): ParsedRemoteUrl {
  const url = raw.trim()
  const base: ParsedRemoteUrl = { protocol: 'unknown', host: null, path: null, provider: null, webUrl: null, sshUrl: null, httpsUrl: null, hasPassword: false }
  if (!url) return base

  let protocol: RemoteProtocol
  let host: string
  let path: string
  let hasPassword = false

  if (/^file:\/\//i.test(url)) return { ...base, protocol: 'file', path: url.slice('file://'.length) }
  const m = SCHEME.exec(url)
  const scp = m ? null : SCP.exec(url)
  if (m) {
    const scheme = m[1]!.toLowerCase()
    protocol =
      scheme === 'https' ? 'https' : scheme === 'http' ? 'http' : scheme === 'git' ? 'git' : /ssh/.test(scheme) ? 'ssh' : 'unknown'
    host = m[3]!
    path = trimPath(m[5] ?? '')
    hasPassword = !!m[2]?.includes(':')
  } else if (scp && !/^[a-z]$/i.test(scp[2]!)) {
    protocol = 'ssh'
    host = scp[2]!
    path = trimPath(scp[3]!)
  } else if (/^(\/|\.{1,2}[/\\]|~|[a-z]:[/\\]|\\\\)/i.test(url)) {
    return { ...base, protocol: 'local', path: url }
  } else {
    return base
  }

  const provider = providerOf(host)
  let webUrl: string | null = null
  let sshUrl: string | null = null
  let httpsUrl: string | null = null
  if (path) {
    if (provider === 'Azure DevOps') {
      // ssh: v3/org/project/repo   https: org/project/_git/repo
      const ssh = /^v3\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path)
      if (ssh) webUrl = `https://dev.azure.com/${ssh[1]}/${ssh[2]}/_git/${ssh[3]}`
      else if (protocol === 'https') webUrl = `https://${host.toLowerCase()}/${path}`
    } else if (provider) {
      const h = webHost(host)
      webUrl = `https://${h}/${path}`
      sshUrl = `git@${h}:${path}.git`
      httpsUrl = `https://${h}/${path}.git`
    } else if (protocol === 'https') {
      webUrl = `https://${host}/${path}`
    }
  }
  return { protocol, host, path, provider, webUrl, sshUrl, httpsUrl, hasPassword }
}

/** Hides a password / token embedded in an http(s) URL. */
export function redactUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/@:]*):[^/@]*@/i, '$1:•••@')
}

export const PROTOCOL_LABEL: Record<RemoteProtocol, string> = {
  ssh: 'SSH',
  https: 'HTTPS',
  http: 'HTTP',
  git: 'Git',
  file: 'File',
  local: 'Local folder',
  unknown: 'Unknown'
}

export interface UrlHint {
  tone: 'info' | 'warning'
  text: string
}

/** One line shown under the URL field while typing. */
export function urlHint(url: string): UrlHint | null {
  if (!url.trim()) return null
  const p = parseRemoteUrl(url)
  if (p.protocol !== 'local' && p.protocol !== 'file' && /\s/.test(url.trim())) return { tone: 'warning', text: 'URLs cannot contain spaces (folder paths can).' }
  if (p.protocol === 'unknown')
    return { tone: 'warning', text: 'This does not look like a Git URL. Expected https://host/owner/repo.git, git@host:owner/repo.git or a folder path.' }
  if (p.hasPassword) return { tone: 'warning', text: 'This URL contains a password or token. Git stores it in plain text in .git/config; prefer a credential manager.' }
  if (p.protocol === 'http') return { tone: 'warning', text: 'Plain HTTP is not encrypted. Use HTTPS if the server supports it.' }
  if (p.protocol === 'git') return { tone: 'warning', text: 'The git:// protocol is unauthenticated and unencrypted; it is usually read-only.' }
  const where = p.provider ?? p.host
  return { tone: 'info', text: [where, PROTOCOL_LABEL[p.protocol], p.path].filter(Boolean).join(' · ') }
}

/**
 * Client-side check of a remote name (git's own check, `refs/remotes/<name>/x` being a valid
 * ref, stays authoritative). `existing` excludes the remote being edited.
 */
export function remoteNameError(name: string, existing: readonly string[]): string | null {
  const n = name.trim()
  if (!n) return 'Enter a name.'
  if (/\s/.test(n)) return 'Names cannot contain spaces.'
  if (n.startsWith('-')) return 'Names cannot start with “-”.'
  if (/[~^:?*[\\]/.test(n) || [...n].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return 'Names cannot contain ~ ^ : ? * [ or \\.'
  if (n.includes('..') || n.includes('@{') || n.includes('//') || n === '@') return 'Names cannot contain “..”, “//” or “@{”.'
  if (n.split('/').some((c) => c.startsWith('.') || c.endsWith('.lock'))) return 'Name parts cannot start with “.” or end with “.lock”.'
  if (n.endsWith('/') || n.endsWith('.')) return 'Names cannot end with “/” or “.”.'
  if (existing.includes(n)) return `A remote named “${n}” already exists.`
  return null
}

/** Name to pre-fill when adding a remote: origin first, then upstream, then a free one derived from the URL owner. */
export function suggestRemoteName(existing: readonly string[], url = ''): string {
  if (!existing.includes('origin')) return 'origin'
  if (!existing.includes('upstream')) return 'upstream'
  const owner = parseRemoteUrl(url).path?.split('/')[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, '')
  if (owner && !remoteNameError(owner, existing)) return owner
  let i = 2
  while (existing.includes(`remote${i}`)) i++
  return `remote${i}`
}
