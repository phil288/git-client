import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is local git state; refreshes are driven by the repo watcher.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: false
    }
  }
})
