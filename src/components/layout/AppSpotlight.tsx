import { useMemo } from 'react'
import { Spotlight, type SpotlightActionData } from '@mantine/spotlight'
import { IconSearch } from '@tabler/icons-react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/useAuth'
import { useApprovalsMe } from '../../hooks/useApprovalsMe'
import { navLeaves, visibleNavigation } from '../../navigation'
import { NavIcon } from './NavIcon'

/**
 * The command palette behind the header's search box and Ctrl+K / Cmd+K.
 *
 * It lists every PAGE the signed-in user may open - the sidebar's own model, read through
 * `visibleNavigation`, so a permission the menu hides hides the page here too. `navLeaves` keeps
 * only the items that have a route, which is also what drops the modules that are not built yet;
 * they are passed `showComingSoon: false` as well, so nothing without a destination can be typed
 * into existence.
 *
 * The description is the page's place in the menu ("Setup > Master Data"), and it is matched by
 * Spotlight's own filter, so "setup" finds every back-office page and "master" the whole group.
 */
export function AppSpotlight() {
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  // The live facts the sidebar uses too: Approvals is a page only an in-app approver is offered.
  const canApproveInApp = useApprovalsMe()?.canApproveInApp === true

  const actions = useMemo<SpotlightActionData[]>(
    () =>
      navLeaves(visibleNavigation(hasPermission, false, { canApproveInApp })).map(({ item, section, group }) => {
        const path = [section.breadcrumb ?? section.title, group?.label].filter((part): part is string => !!part)

        return {
          id: item.to as string,
          label: item.label,
          description: path.join(' › ') || undefined,
          // Sub-items carry no icon of their own; they borrow the group's, so a row is never blank.
          leftSection: <NavIcon name={item.icon ?? group?.icon} size={20} />,
          highlightColor: 'brand.1',
          onClick: () => void navigate(item.to as string),
        }
      }),
    [hasPermission, navigate, canApproveInApp],
  )

  return (
    <Spotlight
      actions={actions}
      shortcut={['mod + K']}
      // Mantine stands the shortcut down while a text field has focus. A palette is exactly what a
      // reader reaches for while typing in a filter box, and Ctrl+K cannot be mistaken for typing,
      // so it answers from everywhere - including the header box, which is itself an input.
      tagsToIgnore={[]}
      highlightQuery
      scrollable
      maxHeight={420}
      nothingFound="No page matches that."
      searchProps={{ leftSection: <IconSearch size={18} />, placeholder: 'Search pages...' }}
    />
  )
}
