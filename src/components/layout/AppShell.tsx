import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { breadcrumbFor } from '../../navigation'
import { AppFooter } from './AppFooter'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

const COLLAPSE_KEY = 'inventory_shipment.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    // Storage unavailable (private mode, blocked cookies): fall back to expanded.
    return false
  }
}

export function AppShell() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [lastPath, setLastPath] = useState(location.pathname)
  const breadcrumb = breadcrumbFor(location.pathname)

  // Navigating (including browser back/forward) closes the mobile drawer.
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setDrawerOpen(false)
  }

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      // Not being able to remember the preference is not worth surfacing.
    }
  }, [collapsed])

  return (
    <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}`}>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        drawerOpen={drawerOpen}
        onNavigate={() => setDrawerOpen(false)}
      />

      {drawerOpen ? <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} /> : null}

      <div className="app-shell__main">
        <Topbar breadcrumb={breadcrumb} onOpenDrawer={() => setDrawerOpen(true)} />
        <main className="app-content">
          <Outlet />
        </main>
        <AppFooter />
      </div>
    </div>
  )
}
