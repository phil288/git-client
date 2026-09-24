/** "<owner>/<repo>" from a GitHub repository URL; null for placeholders like <OWNER>/<REPO>. */
export function repoSlug(url: string): string | null {
  const m = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())
  if (!m || m[1]!.includes('<')) return null
  return m[1]!
}

/** Semver-ish "is a newer than b" (pre-release suffixes sort below the release). */
export function newerThan(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [core = '', pre] = v.replace(/^v/, '').split('-', 2)
    return { nums: core.split('.').map((n) => Number(n) || 0), pre: pre ?? null }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d !== 0) return d > 0
  }
  if (x.pre === y.pre) return false
  if (x.pre === null) return true
  if (y.pre === null) return false
  return x.pre > y.pre
}
