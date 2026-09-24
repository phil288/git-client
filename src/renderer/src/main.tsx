import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)

// Last-resort error reporting: unexpected errors become toasts instead of silent failures.
import { notifyError } from '@/lib/notify'
window.addEventListener('unhandledrejection', (e) => notifyError(e.reason, 'Unexpected error'))
window.addEventListener('error', (e) => {
  if (e.error) notifyError(e.error, 'Unexpected error')
})
