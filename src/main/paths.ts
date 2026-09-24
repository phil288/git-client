import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/**
 * Canonical form for repository paths so the same repo never appears twice:
 * absolute, symlinks resolved (when the path exists), no trailing separator,
 * and on Windows the real on-disk casing plus an upper-case drive letter.
 */
export function normalizeRepoPath(p: string, platform: NodeJS.Platform = process.platform): string {
  let out = resolve(p)
  try {
    out = realpathSync.native(out)
  } catch {
    // Missing path: keep the resolved form.
  }
  if (out.length > 1 && (out.endsWith('/') || out.endsWith('\\'))) {
    const isDriveRoot = /^[A-Za-z]:[\\/]$/.test(out)
    if (!isDriveRoot && out !== sep) out = out.slice(0, -1)
  }
  if (platform === 'win32') {
    out = out.replace(/\//g, '\\')
    if (/^[a-z]:/.test(out)) out = out[0]!.toUpperCase() + out.slice(1)
    // realpath.native may return the \\?\ long-path prefix.
    if (out.startsWith('\\\\?\\')) out = out.slice(4)
  }
  return out
}

/** Comparison key: case-insensitive on Windows, exact elsewhere. */
export function pathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? p.replace(/\//g, '\\').toLowerCase() : p
}

export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return pathKey(a, platform) === pathKey(b, platform)
}
