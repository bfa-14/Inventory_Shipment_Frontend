import { useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { katangaLogo } from '../../assets'
import { useAuth } from '../../auth/useAuth'
import { findLeaf, isGroup, visibleNavigation, type NavItem } from '../../navigation'
import { Icon } from '../ui/Icon'
import { NavIcon } from './NavIcon'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed(): void
  /** Mobile drawer state; ignored on wide screens. */
  drawerOpen: boolean
  onNavigate(): void
}

export function Sidebar({ collapsed, onToggleCollapsed, drawerOpen, onNavigate }: SidebarProps) {
  const { hasPermission } = useAuth()
  const location = useLocation()

  const sections = visibleNavigation(hasPermission)

  // The group holding the current route starts open; the rest stay closed until clicked.
  const activeGroup = findLeaf(location.pathname, sections)?.group?.label
  const [openGroups, setOpenGroups] = useState<string[]>(() => (activeGroup ? [activeGroup] : []))
  const [lastPath, setLastPath] = useState(location.pathname)

  // Navigating into another group opens it, without closing what the user opened by hand.
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    if (activeGroup && !openGroups.includes(activeGroup)) setOpenGroups([...openGroups, activeGroup])
  }

  const isOpen = (item: NavItem) => openGroups.includes(item.label)

  function toggleGroup(label: string) {
    setOpenGroups((open) => (open.includes(label) ? open.filter((l) => l !== label) : [...open, label]))
  }

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${drawerOpen ? ' sidebar--open' : ''}`}>
      <div className="sidebar__brand">
        <img src={katangaLogo} alt="Katanga TVS Motor Company" />
      </div>

      <nav className="sidebar__nav">
        {sections.map((section, index) => (
          <div className="sidebar__section" key={section.title ?? `top-${index}`}>
            {section.title ? <p className="sidebar__section-title">{section.title}</p> : null}

            {section.items.map((item) => {
              if (item.comingSoon || (!item.to && !isGroup(item))) {
                return (
                  <span className="sidebar__link sidebar__link--soon" key={item.label} title={`${item.label} - coming soon`}>
                    <NavIcon name={item.icon ?? 'grid'} />
                    <span className="sidebar__label">{item.label}</span>
                    <span className="sidebar__soon">Soon</span>
                  </span>
                )
              }

              if (isGroup(item)) {
                const open = isOpen(item)
                return (
                  <div className="sidebar__group" key={item.label}>
                    <button
                      type="button"
                      className={`sidebar__link sidebar__link--group${open ? ' sidebar__link--expanded' : ''}`}
                      onClick={() => toggleGroup(item.label)}
                      aria-expanded={open}
                      title={item.label}
                    >
                      <NavIcon name={item.icon ?? 'grid'} />
                      <span className="sidebar__label">{item.label}</span>
                      <Icon name={open ? 'chevron-down' : 'chevron-right'} className="sidebar__chevron" />
                    </button>

                    {open ? (
                      <div className="sidebar__children">
                        {(item.children ?? []).map((child) =>
                          child.comingSoon || !child.to ? (
                            <span
                              className="sidebar__child sidebar__child--soon"
                              key={child.label}
                              title={`${child.label} - coming soon`}
                            >
                              <span className="sidebar__bullet" aria-hidden="true" />
                              <span className="sidebar__label">{child.label}</span>
                              <span className="sidebar__soon">Soon</span>
                            </span>
                          ) : (
                            <NavLink
                              key={child.label}
                              to={child.to}
                              className={({ isActive }) => `sidebar__child${isActive ? ' sidebar__child--active' : ''}`}
                              onClick={onNavigate}
                              title={child.label}
                            >
                              <span className="sidebar__bullet" aria-hidden="true" />
                              <span className="sidebar__label">{child.label}</span>
                            </NavLink>
                          ),
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              }

              return (
                <NavLink
                  key={item.label}
                  to={item.to as string}
                  end={item.to === '/'}
                  className={({ isActive }) => `sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
                  onClick={onNavigate}
                  title={item.label}
                >
                  <NavIcon name={item.icon ?? 'grid'} />
                  <span className="sidebar__label">{item.label}</span>
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      <button type="button" className="sidebar__collapse" onClick={onToggleCollapsed}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} />
        <span className="sidebar__label">Collapse Menu</span>
      </button>
    </aside>
  )
}
