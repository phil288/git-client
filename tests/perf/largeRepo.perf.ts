/**
 * Performance check on a synthetic 100k-commit repository (run: npm run test:perf).
 * The repo is built with `git fast-import` (a main line with a side branch
 * merged every 50 commits, plus tags), then the real log pipeline is timed:
 * first page, full stream, graph layout, and a text search.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createGraphState, layoutGraph } from '@shared/graph'
import { LogSessions } from '../../src/main/git/log'
import { locateGit } from '../../src/main/git/locate'
import { CommandLogger } from '../../src/main/git/logger'
import { GitRunner } from '../../src/main/git/runner'
import { tempDir } from '../helpers'

const N = Number(process.env.GITCLIENT_PERF_COMMITS ?? 100_000)
let runner: GitRunner
let logs: LogSessions
const repo = join(tempDir('gitclient-perf-'), 'big')

function fastImportStream(n: number): string {
  const out: string[] = []
  let mark = 0
  let mainTip = 0
  let sideTip = 0
  const t0 = 1_600_000_000
  for (let i = 1; i <= n; i++) {
    const isSide = i % 50 >= 45 && i > 50
    const isMerge = i % 50 === 0 && sideTip > 0
    mark++
    out.push(`commit refs/heads/${isSide ? 'side' : 'main'}`, `mark :${mark}`, `committer Perf <perf@example.com> ${t0 + i} +0000`)
    const msg = `${isMerge ? 'Merge side into main' : 'Change'} #${i}`
    out.push(`data ${Buffer.byteLength(msg)}`, msg)
    if (isSide) {
      out.push(`from :${sideTip || mainTip}`)
      sideTip = mark
    } else {
      if (mainTip) out.push(`from :${mainTip}`)
      if (isMerge) {
        out.push(`merge :${sideTip}`)
        sideTip = 0
      }
      mainTip = mark
    }
    const content = `value ${i}\n`
    out.push(`M 644 inline ${isSide ? 'side.txt' : `dir${i % 20}/file.txt`}`, `data ${content.length}`, content)
    if (i % 5000 === 0) out.push(`reset refs/tags/v${i}`, `from :${mark}`, '')
  }
  return out.join('\n') + '\n'
}

beforeAll(async () => {
  const s = await locateGit(null)
  if (s.state !== 'ok') throw new Error('git missing')
  runner = new GitRunner(s.git.path, new CommandLogger())
  logs = new LogSessions(runner)
  spawnSync('git', ['init', '-q', '-b', 'main', repo])
  const t = performance.now()
  const r = spawnSync('git', ['fast-import', '--quiet'], { cwd: repo, input: fastImportStream(N), maxBuffer: 1 << 30 })
  if (r.status !== 0) throw new Error(String(r.stderr))
  spawnSync('git', ['checkout', '-q', 'main'], { cwd: repo })
  spawnSync('git', ['commit-graph', 'write', '--reachable'], { cwd: repo })
  console.log(`[perf] built ${N} commits in ${Math.round(performance.now() - t)} ms`)
}, 600_000)

describe('large repository', () => {
  it('first page, full stream, graph layout, text search', async () => {
    let t = performance.now()
    const id = await logs.open(repo, { revs: [] })
    const first = await logs.next(id, 2000)
    const firstPageMs = performance.now() - t
    const state = createGraphState()
    const rows = layoutGraph(state, first.commits)
    let total = first.commits.length
    let maxWidth = Math.max(...rows.map((r) => r.width))
    let graphMs = 0
    for (;;) {
      const p = await logs.next(id, 10_000)
      const g = performance.now()
      for (const r of layoutGraph(state, p.commits)) maxWidth = Math.max(maxWidth, r.width)
      graphMs += performance.now() - g
      total += p.commits.length
      if (p.done) break
    }
    const fullMs = performance.now() - t

    t = performance.now()
    const sid = await logs.open(repo, { revs: [], text: '#99999' })
    let found = 0
    for (;;) {
      const p = await logs.next(sid, 2000)
      found += p.commits.length
      if (p.done) break
    }
    const searchMs = performance.now() - t

    console.log(
      `[perf] ${total} commits: first page ${Math.round(firstPageMs)} ms, full stream ${Math.round(fullMs)} ms ` +
        `(graph layout ${Math.round(graphMs)} ms, max ${maxWidth} lanes), text search over all ${Math.round(searchMs)} ms (${found} hits)`
    )
    expect(total).toBe(N)
    expect(firstPageMs).toBeLessThan(2000)
    expect(maxWidth).toBeLessThanOrEqual(4)
    expect(found).toBeGreaterThan(0)
  }, 600_000)
})
