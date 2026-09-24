import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

/**
 * Lazily loads branch / dirty / ahead-behind for a recents entry. Main limits
 * concurrency, so a long list renders instantly and fills in progressively.
 */
export function useQuickStatus(path: string, enabled: boolean) {
  return useQuery({
    queryKey: ['quickStatus', path],
    queryFn: () => api.repo.quickStatus(path),
    enabled,
    staleTime: 60_000
  })
}
