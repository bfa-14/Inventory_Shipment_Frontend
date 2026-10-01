import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  CloseButton,
  Group,
  Highlight,
  Image,
  NavLink,
  ScrollArea,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconSearch } from '@tabler/icons-react'
import { NavLink as RouterNavLink, useLocation, useNavigate } from 'react-router'
import { katangaLogo } from '../../assets'
import { useAuth } from '../../auth/useAuth'
import { findLeaf, isGroup, navLeaves, searchNavigation, visibleNavigation, type NavItem } from '../../navigation'
import { NavIcon } from './NavIcon'
import { useShowComingSoon } from './useComingSoon'

/** Menu labels stay on one line; the sidebar is only 240px wide. */
const NO_WRAP = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const

/** What the search box does to the text it found: bold it, and nothing else. */
const MATCH_STYLES = { backgroundColor: 'transparent', color: 'inherit', fontWeight: 700 } as const

interface AppNavbarProps {
  collapsed: boolean
  onToggleCollapsed(): void
  onNavigate(): void
}

export function AppNavbar({ collapsed, onToggleCollapsed, onNavigate }: AppNavbarProps) {
  const { hasPermission } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const [showComingSoon] = useShowComingSoon()
  const allSections = visibleNavigation(hasPermission, showComingSoon)

  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // Raised when the search icon of the COLLAPSED sidebar is clicked: the box it should focus does
  // not exist yet at that moment, so the focus waits for the expansion to render it.
  const focusOnExpand = useRef(false)

  const searching = query.trim().length > 0
  const sections = searchNavigation(allSections, query)

  // The group holding the current route starts open; the rest stay closed until clicked. Read from
  // the UNFILTERED menu - while searching, the active route may not be among the matches at all.
  const activeGroup = findLeaf(location.pathname, allSections)?.group?.label
  const [openGroups, setOpenGroups] = useState<string[]>(() => (activeGroup ? [activeGroup] : []))
  const [lastPath, setLastPath] = useState(location.pathname)

  // Navigating into another group opens it, without closing what the user opened by hand.
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    if (activeGroup && !openGroups.includes(activeGroup)) setOpenGroups([...openGroups, activeGroup])
  }

  useEffect(() => {
    if (collapsed || !focusOnExpand.current) return
    focusOnExpand.current = false
    searchRef.current?.focus()
  }, [collapsed])

  function toggleGroup(label: string) {
    setOpenGroups((open) => (open.includes(label) ? open.filter((l) => l !== label) : [...open, label]))
  }

  /** Enter opens the first item still on screen; Esc empties the box. */
  function handleSearchKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setQuery('')
      return
    }

    if (event.key !== 'Enter') return
    const first = navLeaves(sections)[0]
    if (!first?.item.to) return
    event.preventDefault()
    setQuery('')
    onNavigate()
    void navigate(first.item.to)
  }

  /** The label a menu entry shows: while searching, with the matched text in bold. */
  function label(item: NavItem) {
    if (collapsed) return undefined
    if (!searching) return item.label

    return (
      <Highlight component="span" inherit highlight={query.trim()} highlightStyles={MATCH_STYLES}>
        {item.label}
      </Highlight>
    )
  }

  const soonBadge = collapsed ? null : (
    <Badge size="xs" variant="light" color="gray">
      Soon
    </Badge>
  )

  /**
   * Is this entry the one the reader is on? A route belongs to the LONGEST menu entry that prefixes it,
   * so Customer Statement (/sales/receipts/statement) does not also light Receipts (/sales/receipts).
   */
  const leafPaths = navLeaves(allSections).map((leaf) => leaf.item.to as string)
  function isActive(to: string): boolean {
    const path = location.pathname
    if (to === '/') return path === '/'
    const matches = (candidate: string) => path === candidate || path.startsWith(candidate + '/')
    if (!matches(to)) return false
    return !leafPaths.some((other) => other.length > to.length && matches(other))
  }

  function renderChild(child: NavItem) {
    if (child.comingSoon || !child.to) {
      return (
        <NavLink
          key={child.label}
          label={label(child)}
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
        // Exact, so the router does not mark a parent route current as well (it sets aria-current, which
        // Mantine styles as active); isActive below decides which entry is lit.
        end
        label={label(child)}
        onClick={onNavigate}
        active={isActive(child.to)}
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
          label={label(item)}
          leftSection={icon}
          rightSection={soonBadge}
          disabled
          title={`${item.label} - coming soon`}
          styles={{ label: NO_WRAP }}
        />
      )
    }

    if (isGroup(item)) {
      // A search shows what it found: a group holding a match is open, whatever the reader last
      // collapsed by hand - and that hand-made state is waiting again once the box is empty.
      const opened = searching || openGroups.includes(item.label)
      return (
        <NavLink
          key={item.label}
          label={label(item)}
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
        end
        label={label(item)}
        leftSection={icon}
        onClick={onNavigate}
        active={isActive(item.to as string)}
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

      <AppShell.Section px="xs" pt="sm">
        {collapsed ? (
          <Tooltip label="Search menu" position="right" withArrow>
            <ActionIcon
              className="app-navbar__search-toggle"
              variant="subtle"
              size="lg"
              mx="auto"
              display="block"
              aria-label="Search menu"
              onClick={() => {
                focusOnExpand.current = true
                onToggleCollapsed()
              }}
            >
              <IconSearch size={18} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <TextInput
            ref={searchRef}
            className="app-navbar__search"
            placeholder="Search menu..."
            aria-label="Search menu"
            leftSection={<IconSearch size={16} />}
            rightSection={
              searching ? (
                <CloseButton size="sm" aria-label="Clear menu search" onClick={() => setQuery('')} />
              ) : null
            }
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleSearchKeys}
          />
        )}
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

        {searching && sections.length === 0 ? (
          <Text className="app-navbar__section-title" fz="sm" px="sm" py="xs">
            No menu item matches &ldquo;{query.trim()}&rdquo;.
          </Text>
        ) : null}
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
