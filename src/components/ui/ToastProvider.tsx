import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastMessage } from './ToastContext'

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const nextId = useRef(1)

  const showToast = useCallback((text: string, tone: 'success' | 'error' = 'success') => {
    const id = nextId.current++
    setToasts((current) => [...current, { id, text, tone }])
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4000)
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
