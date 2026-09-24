import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button, for destructive actions. */
  destructive?: boolean
}

export interface PromptOptions {
  title: string
  label?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  /** Return an error message to block submission. */
  validate?: (value: string) => string | null
}

export interface ChoiceOptions<T extends string> {
  title: string
  message: React.ReactNode
  choices: { id: T; label: string; variant?: 'default' | 'secondary' | 'danger'; description?: string }[]
}

type Pending =
  | { kind: 'choose'; options: ChoiceOptions<string>; resolve: (id: string | null) => void }
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

interface DialogsState {
  pending: Pending | null
  settle(value: boolean | string | null): void
}

export const useDialogsStore = create<DialogsState>((set, get) => ({
  pending: null,
  settle(value) {
    const p = get().pending
    if (!p) return
    set({ pending: null })
    if (p.kind === 'confirm') p.resolve(value === true)
    else p.resolve(typeof value === 'string' ? value : null)
  }
}))

/** Promise-based confirmation dialog. Every destructive action goes through this. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  useDialogsStore.getState().settle(false)
  return new Promise((resolve) => useDialogsStore.setState({ pending: { kind: 'confirm', options, resolve } }))
}

export function prompt(options: PromptOptions): Promise<string | null> {
  useDialogsStore.getState().settle(null)
  return new Promise((resolve) => useDialogsStore.setState({ pending: { kind: 'prompt', options, resolve } }))
}

/** Dialog with several buttons (e.g. Smart Checkout / Force Checkout / Cancel). Resolves the chosen id or null. */
export function choose<T extends string>(options: ChoiceOptions<T>): Promise<T | null> {
  useDialogsStore.getState().settle(null)
  return new Promise((resolve) =>
    useDialogsStore.setState({ pending: { kind: 'choose', options: options as ChoiceOptions<string>, resolve: resolve as (id: string | null) => void } })
  )
}
