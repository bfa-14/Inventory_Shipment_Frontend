import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose(): void
  children: ReactNode
  footer?: ReactNode
  /** Wider variant for the role/permission editors. */
  wide?: boolean
}

/** Dialog that closes on Escape and on a backdrop click, and moves focus inside on open. */
export function Modal({ title, onClose, children, footer, wide = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return

      // Keep Tab inside the dialog.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
      )
      if (!focusable || focusable.length === 0) return

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <header className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>
  )
}
