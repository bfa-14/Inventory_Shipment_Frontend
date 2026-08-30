import { createContext } from 'react'

export interface ToastMessage {
  id: number
  text: string
  tone: 'success' | 'error'
}

export interface ToastContextValue {
  /** Shows a transient confirmation; errors are shown inline in the forms instead. */
  showToast(text: string, tone?: 'success' | 'error'): void
}

export const ToastContext = createContext<ToastContextValue | null>(null)
