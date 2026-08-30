import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/useAuth'
import { initials } from '../format'
import { Icon } from '../ui/Icon'

interface TopbarProps {
  /** Trail from the navigation model, e.g. ['Setup', 'Master Data', 'Branches / Sites']. */
  breadcrumb: string[]
  onOpenDrawer(): void
}

/** Notifications are not wired up yet; the bell shows an empty count. */
const NOTIFICATION_COUNT = 0

export function Topbar({ breadcrumb, onOpenDrawer }: TopbarProps) {
  const { user, logout, logoutEverywhere } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function handleSignOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  async function handleSignOutEverywhere() {
    try {
      await logoutEverywhere()
    } finally {
      navigate('/login', { replace: true })
    }
  }

  const primaryRole = user?.roles[0]

  return (
    <header className="topbar">
      <button type="button" className="topbar__menu" onClick={onOpenDrawer} aria-label="Open navigation">
        <Icon name="menu" />
      </button>

      <nav className="breadcrumb" aria-label="Breadcrumb">
        {breadcrumb.map((part, index) => (
          <Fragment key={part}>
            {index > 0 ? <span className="breadcrumb__sep">&rsaquo;</span> : null}
            <span className={index === breadcrumb.length - 1 ? 'breadcrumb__current' : undefined}>{part}</span>
          </Fragment>
        ))}
      </nav>

      <div className="topbar__search">
        <Icon name="search" />
        <input type="search" aria-label="Search anything" placeholder="Search anything..." />
      </div>

      <button type="button" className="topbar__bell" aria-label={`Notifications (${NOTIFICATION_COUNT})`}>
        <Icon name="bell" />
        <span className="topbar__bell-count">{NOTIFICATION_COUNT}</span>
      </button>

      <div className="topbar__user" ref={menuRef}>
        <button type="button" className="topbar__trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="topbar__avatar" aria-hidden="true">
            {initials(user?.fullName)}
          </span>
          <span className="topbar__identity">
            <strong>{user?.fullName}</strong>
            <span>{primaryRole ?? 'No roles'}</span>
          </span>
          <Icon name="chevron-down" className="topbar__caret" />
        </button>

        {open ? (
          <div className="topbar__menu-panel">
            <div className="topbar__menu-head">
              <strong>{user?.fullName}</strong>
              <span className="muted">{user?.email}</span>
              <div className="topbar__roles">
                {(user?.roles ?? []).map((role) => (
                  <span className="chip" key={role}>
                    {role}
                  </span>
                ))}
                {user?.roles.length === 0 ? <span className="muted">No roles</span> : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/account/password')
              }}
            >
              Change password
            </button>
            <button type="button" onClick={handleSignOutEverywhere}>
              Sign out everywhere
            </button>
            <button type="button" className="topbar__signout" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  )
}
