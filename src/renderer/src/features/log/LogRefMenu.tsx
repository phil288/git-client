import type { Ref } from '@shared/types'
import { BranchMenu } from '../branches/BranchMenu'
import { useFavorites } from '../branches/BranchesPanel'

/** Branch / tag menu for a ref label in the log (same actions as the Branches panel). */
export function LogRefMenu({ root, r, currentBranch }: { root: string; r: Ref; currentBranch: string | null }) {
  const { favorites, toggle } = useFavorites(root)
  return <BranchMenu root={root} r={r} currentBranch={currentBranch} favorite={favorites.has(r.name)} onToggleFavorite={() => toggle(r)} />
}
