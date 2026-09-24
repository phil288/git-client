import { memo } from 'react'
import type { GraphRow } from '@shared/graph'

export const LANE_W = 12
export const ROW_H = 22

/** Lane colours (distinct in light and dark themes). */
export const GRAPH_COLORS = ['#4c8dff', '#f08c00', '#2f9e44', '#e64980', '#7950f2', '#1098ad', '#e8590c', '#74b816', '#c2255c', '#5c7cfa']

export function laneColor(color: number): string {
  return GRAPH_COLORS[color % GRAPH_COLORS.length]!
}

const x = (lane: number) => lane * LANE_W + LANE_W / 2

/** One row of the commit graph: edges in the top and bottom halves plus the node. */
export const GraphCell = memo(function GraphCell({ row, width, isMerge, isHead }: { row: GraphRow; width: number; isMerge: boolean; isHead: boolean }) {
  const mid = ROW_H / 2
  return (
    <svg width={width * LANE_W} height={ROW_H} className="block shrink-0" aria-hidden>
      {row.up.map((e, i) => (
        <path key={`u${i}`} d={`M${x(e.from)} 0 L${x(e.to)} ${mid}`} stroke={laneColor(e.color)} strokeWidth={1.6} fill="none" />
      ))}
      {row.down.map((e, i) => (
        <path key={`d${i}`} d={`M${x(e.from)} ${mid} L${x(e.to)} ${ROW_H}`} stroke={laneColor(e.color)} strokeWidth={1.6} fill="none" />
      ))}
      {isHead && <circle cx={x(row.lane)} cy={mid} r={6} fill="none" stroke={laneColor(row.color)} strokeWidth={1.2} />}
      <circle
        cx={x(row.lane)}
        cy={mid}
        r={isMerge ? 3 : 3.8}
        fill={isMerge ? 'var(--bg)' : laneColor(row.color)}
        stroke={laneColor(row.color)}
        strokeWidth={isMerge ? 1.6 : 0}
      />
    </svg>
  )
})
