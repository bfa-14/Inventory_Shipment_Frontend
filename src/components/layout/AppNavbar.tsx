import { useState } from 'react'
import { AppShell, Badge, Box, Group, Image, NavLink, ScrollArea, Text, Tooltip } from '@mantine/core'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { NavLink as RouterNavLink, useLocation } from 'react-router'
import { katangaLogo } from '../../assets'
import { useAuth } from '../../auth/useAuth'
import { findLeaf, isGroup, visibleNavigation, type NavItem } from '../../navigation'
import { NavIcon } from './NavIcon'
import { useShowComingSoon } from './useComingSoon'

/** Menu labels stay on one line; the sidebar is only 240px wide. */
const NO_WRAP = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const

interface AppNavbarProps {
  collapsed: boolean
  onToggleCollapsed(): void
  onNavigate(): void
}

export function AppNavbar({ collapsed, onToggleCollapsed, onNavigate }: AppNavbarProps) {
  const { hasPermission } = useAuth()
  const location = useLocation()

  const [showComingSoon] = useShowComingSoon()
  const sections = visibleNavigation(hasPermission, showComingSoon)

  // The group holding the current route starts open; the rest stay closed until clicked.
  const activeGroup = findLeaf(location.pathname, sections)?.group?.label
  const [openGroups, setOpenGroups] = useState<string[]>(() => (activeGroup ? [activeGroup] : []))
  const [lastPath, setLastPath] = useState(location.pathname)

  // Navigating into another group opens it, without closing what the user opened by hand.
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    if (activeGroup && !openGroups.includes(activeGroup)) setOpenGroups([...openGroups, activeGroup])
  }

  function toggleGroup(label: string) {
    setOpenGroups((open) => (open.includes(label) ? open.filter((l) => l !== label) : [...open, label]))
  }

  const soonBadge = collapsed ? null : (
    <Badge size="xs" variant="light" color="gray">
      Soon
    </Badge>
  )

  function renderChild(child: NavItem) {
    if (child.comingSoon || !child.to) {
      return (
        <NavLink
          key={child.label}
          label={child.label}
          rightSection={soonBadge}
          disabled
          styles={{ label: { fontSize: 'var(--mantine-font-size-sm)', ...NO_WRAP } }}
        />
      )
    }

    return (
      <NavLink
        key={child.label}
        component={RouterNavLink}
        to={child.to}
        label={child.label}
        onClick={onNavigate}
        active={location.pathname.startsWith(child.to)}
        styles={{
          root: { borderRadius: 'var(--mantine-radius-md)' },
          label: { fontSize: 'var(--mantine-font-size-sm)', ...NO_WRAP },
        }}
      />
    )
  }

  function renderItem(item: NavItem) {
    const icon = <NavIcon name={item.icon} />

    if (item.comingSoon || (!item.to && !isGroup(item))) {
      return (
        <NavLink
          key={item.label}
          label={collapsed ? undefined : item.label}
          leftSection={icon}
          rightSection={soonBadge}
          disabled
          title={`${item.label} - coming soon`}
          styles={{ label: NO_WRAP }}
        />
      )
    }

    if (isGroup(item)) {
      const opened = openGroups.includes(item.label)
      return (
        <NavLink
          key={item.label}
          label={collapsed ? undefined : item.label}
          leftSection={icon}
          opened={opened && !collapsed}
          onClick={() => toggleGroup(item.label)}
          childrenOffset={collapsed ? 0 : 28}
          title={item.label}
          styles={{ root: { borderRadius: 'var(--mantine-radius-md)' }, label: NO_WRAP }}
        >
          {collapsed ? null : (item.children ?? []).map(renderChild)}
        </NavLink>
      )
    }

    return (
      <NavLink
        key={item.label}
        component={RouterNavLink}
        to={item.to as string}
        end={item.to === '/'}
        label={collapsed ? undefined : item.label}
        leftSection={icon}
        onClick={onNavigate}
        active={item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to as string)}
        title={item.label}
        styles={{ root: { borderRadius: 'var(--mantine-radius-md)' }, label: NO_WRAP }}
      />
    )
  }

  return (
    <>
      <AppShell.Section>
        <Group className="app-navbar__brand" justify="center" h={64} px="sm">
          <Image src={katangaLogo} alt="Katanga TVS Motor Company" fit="contain" mah={40} />
        </Group>
      </AppShell.Section>

      <AppShell.Section grow component={ScrollArea} px="xs" py="sm">
        {sections.map((section, index) => (
          <Box key={section.title ?? `top-${index}`} mb="xs">
            {section.title && !collapsed ? (
              <Text
                className="app-navbar__section-title"
                tt="uppercase"
                fw={700}
                fz={10}
                px="sm"
                pt="sm"
                pb={4}
                style={{ letterSpacing: '0.09em' }}
              >
                {section.title}
              </Text>
            ) : null}
            {section.items.map(renderItem)}
          </Box>
        ))}
      </AppShell.Section>

      <AppShell.Section className="app-navbar__footer" p="xs">
        <Tooltip label={collapsed ? 'Expand menu' : 'Collapse menu'} disabled={!collapsed} position="right">
          <NavLink
            label={collapsed ? undefined : 'Collapse Menu'}
            leftSection={collapsed ? <IconChevronRight size={18} /> : <IconChevronLeft size={18} />}
            onClick={onToggleCollapsed}
            styles={{ root: { borderRadius: 'var(--mantine-radius-md)' } }}
          />
        </Tooltip>
      </AppShell.Section>
    </>
  )
}
