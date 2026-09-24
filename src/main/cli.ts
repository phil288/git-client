import { isAbsolute, resolve } from 'node:path'

/**
 * Extracts repository paths from a command line such as
 *   gitclient .            gitclient /path/to/repo       gitclient "C:\My Repo"
 * Skips the executable, the app entry (in dev, `electron .`), and any flags
 * (Chromium appends its own switches to second-instance argv).
 */
export function extractPathArgs(argv: readonly string[], isDefaultApp: boolean): string[] {
  // Packaged: [exe, ...args]. Dev (`electron out/main/index.js ...`): [electron, entry, ...args].
  const rest = argv.slice(isDefaultApp ? 2 : 1)
  const out: string[] = []
  let afterDoubleDash = false
  for (const a of rest) {
    if (!afterDoubleDash && a === '--') {
      afterDoubleDash = true
      continue
    }
    if (!afterDoubleDash && a.startsWith('-')) continue
    if (a.trim() === '') continue
    out.push(a)
  }
  return out
}

export function resolvePathArgs(args: readonly string[], cwd: string): string[] {
  return args.map((a) => (isAbsolute(a) ? resolve(a) : resolve(cwd, a)))
}
