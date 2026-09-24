/**
 * Commit graph lane layout, JetBrains/`git log --graph` style.
 *
 * Input commits must be ordered children-before-parents (git log
 * --date-order or --topo-order). Layout is incremental: the state carries the
 * open lanes across pages, so pages of 2,000 commits can be laid out as they
 * stream in.
 *
 * Each lane holds the hash it is waiting for. A commit takes the leftmost lane
 * waiting for it (other lanes waiting for it converge into that one), or a new
 * lane when nothing waits for it (a branch tip). Its first parent continues in
 * the same lane; further parents join a lane already waiting for them or open
 * a new one. Lanes never move sideways, so pass-through lines stay straight.
 */

export interface GraphCommitInput {
  hash: string
  parents: readonly string[]
}

/** A line segment in one half of a row, from column `from` to column `to`. */
export interface GraphEdge {
  from: number
  to: number
  color: number
}

export interface GraphRow {
  /** Column of the commit node. */
  lane: number
  color: number
  /** Top half: y=0 (row top) to y=0.5 (node centre). */
  up: GraphEdge[]
  /** Bottom half: y=0.5 to y=1 (row bottom). */
  down: GraphEdge[]
  /** Columns needed to draw this row. */
  width: number
  /** Nothing above leads into this commit (branch tip). */
  isTip: boolean
}

export interface GraphState {
  lanes: (string | null)[]
  colors: number[]
  nextColor: number
}

export function createGraphState(): GraphState {
  return { lanes: [], colors: [], nextColor: 0 }
}

function freeLane(lanes: (string | null)[], exclude: number): number {
  for (let i = 0; i < lanes.length; i++) if (lanes[i] === null && i !== exclude) return i
  return lanes.length === exclude ? exclude + 1 : lanes.length
}

/** Lays out `commits`, continuing from (and mutating) `state`. */
export function layoutGraph(state: GraphState, commits: readonly GraphCommitInput[]): GraphRow[] {
  const rows: GraphRow[] = []
  const { lanes, colors } = state

  for (const c of commits) {
    // 1. Which lanes wait for this commit?
    const matching: number[] = []
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === c.hash) matching.push(i)

    let lane: number
    const isTip = matching.length === 0
    if (isTip) {
      lane = freeLane(lanes, -1)
      colors[lane] = state.nextColor++
    } else {
      lane = matching[0]!
    }
    const color = colors[lane]!

    // 2. Top half: lanes converging into the node, everything else passes through.
    const up: GraphEdge[] = []
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null || lanes[i] === undefined) continue
      up.push({ from: i, to: lanes[i] === c.hash ? lane : i, color: colors[i]! })
    }
    for (const j of matching) if (j !== lane) lanes[j] = null

    // 3. Parents.
    const parents = [...new Set(c.parents)]
    const down: GraphEdge[] = []
    const opened = new Set<number>()
    lanes[lane] = parents[0] ?? null
    if (lane >= lanes.length) lanes.length = lane + 1
    for (let p = 1; p < parents.length; p++) {
      const hash = parents[p]!
      const existing = lanes.indexOf(hash)
      if (existing >= 0 && existing !== lane) {
        down.push({ from: lane, to: existing, color: colors[existing]! })
      } else {
        const k = freeLane(lanes, lane)
        lanes[k] = hash
        colors[k] = state.nextColor++
        opened.add(k)
        down.push({ from: lane, to: k, color: colors[k]! })
      }
    }

    // 4. Bottom half: continuing lanes (the node's own lane included).
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null || lanes[i] === undefined || opened.has(i)) continue
      down.push({ from: i, to: i, color: colors[i]! })
    }

    // 5. Drop trailing free lanes so width shrinks again.
    while (lanes.length > 0 && (lanes[lanes.length - 1] === null || lanes[lanes.length - 1] === undefined)) {
      lanes.pop()
    }
    colors.length = Math.max(colors.length, lanes.length)

    let width = lane + 1
    for (const e of up) width = Math.max(width, e.from + 1, e.to + 1)
    for (const e of down) width = Math.max(width, e.from + 1, e.to + 1)
    rows.push({ lane, color, up, down, width, isTip })
  }
  return rows
}
