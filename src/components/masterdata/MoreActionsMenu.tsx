import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui/Icon'

interface MoreActionsMenuProps {
  onRefresh(): void
  /** Called with a filename; the component turns the rows into a CSV download. */
  onExport(): void
}

/** The "More Actions" dropdown shared by the master-data list pages. */
export function MoreActionsMenu({ onRefresh, onExport }: MoreActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  return (
    <div className="dropdown" ref={menuRef}>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="more" />
        More Actions
        <Icon name="chevron-down" />
      </button>

      {open ? (
        <div className="dropdown__panel">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onRefresh()
            }}
          >
            <Icon name="refresh" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onExport()
            }}
          >
            <Icon name="download" />
            Export CSV
          </button>
        </div>
      ) : null}
    </div>
  )
}
