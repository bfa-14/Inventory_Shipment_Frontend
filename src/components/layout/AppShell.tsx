import { useEffect, useState } from 'react'
import { AppShell as MantineAppShell, Burger, Group } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Outlet, useLocation } from 'react-router'
import { CONTENT_BG, KATANGA } from '../../theme'
import { AppFooter } from './AppFooter'
import { AppHeader } from './AppHeader'
import { AppNavbar } from './AppNavbar'
import { AppSpotlight } from './AppSpotlight'

const COLLAPSE_KEY = 'inventory_shipment.sidebarCollapsed'

const NAVBAR_WIDTH = 240
const NAVBAR_COLLAPSED = 72

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
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false)
  const [lastPath, setLastPath] = useState(location.pathname)

  // Navigating (including browser back/forward) closes the mobile drawer.
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    closeMobile()
  }

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      // Not being able to remember the preference is not worth surfacing.
    }
  }, [collapsed])

  return (
    <MantineAppShell
      layout="alt"
      header={{ height: 64 }}
      navbar={{
        width: collapsed ? NAVBAR_COLLAPSED : NAVBAR_WIDTH,
        breakpoint: 'sm',
        collapsed: { mobile: !mobileOpened },
      }}
      footer={{ height: 44 }}
      padding="md"
      styles={{
        main: { background: CONTENT_BG },
        // The sign-in page's ground, with its own bloom - the sidebar is the one piece of chrome
        // that carries the brand colour, so it gets the gradient rather than a flat fill.
        navbar: {
          background: `linear-gradient(180deg, ${KATANGA.navyGlow} 0%, ${KATANGA.navyDeep} 55%)`,
          border: 'none',
        },
      }}
    >
      <MantineAppShell.Header>
        <Group h="100%" px="md" wrap="nowrap" gap="sm">
          <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="Open navigation" />
          <AppHeader />
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar className="app-navbar">
        <AppNavbar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((v) => !v)} onNavigate={closeMobile} />
      </MantineAppShell.Navbar>

      <MantineAppShell.Main>
        <Outlet />
      </MantineAppShell.Main>

      <MantineAppShell.Footer>
        <AppFooter />
      </MantineAppShell.Footer>

      {/* Rendered once for the whole shell: it listens for Ctrl+K / Cmd+K wherever the reader is. */}
      <AppSpotlight />
    </MantineAppShell>
  )
}
