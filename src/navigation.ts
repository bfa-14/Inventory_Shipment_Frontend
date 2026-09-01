/** Permission codes the API guards its endpoints with. */
export const PERMISSIONS = {
  usersView: 'security.users.view',
  usersCreate: 'security.users.create',
  usersEdit: 'security.users.edit',
  rolesView: 'security.roles.view',
  rolesManage: 'security.roles.manage',
  permissionsView: 'security.permissions.view',
  auditView: 'security.audit.view',
  branchesView: 'masterdata.branches.view',
  branchesCreate: 'masterdata.branches.create',
  branchesEdit: 'masterdata.branches.edit',
  branchesDelete: 'masterdata.branches.delete',
  warehousesView: 'masterdata.warehouses.view',
  warehousesCreate: 'masterdata.warehouses.create',
  warehousesEdit: 'masterdata.warehouses.edit',
  warehousesDelete: 'masterdata.warehouses.delete',
  currenciesView: 'masterdata.currencies.view',
  currenciesCreate: 'masterdata.currencies.create',
  currenciesEdit: 'masterdata.currencies.edit',
  currenciesDelete: 'masterdata.currencies.delete',
  exchangeRatesView: 'masterdata.exchangerates.view',
  exchangeRatesCreate: 'masterdata.exchangerates.create',
  exchangeRatesEdit: 'masterdata.exchangerates.edit',
  exchangeRatesDelete: 'masterdata.exchangerates.delete',
  itemFamiliesView: 'masterdata.itemfamilies.view',
  itemFamiliesCreate: 'masterdata.itemfamilies.create',
  itemFamiliesEdit: 'masterdata.itemfamilies.edit',
  itemFamiliesDelete: 'masterdata.itemfamilies.delete',
} as const

export interface NavItem {
  label: string
  /** Route of a leaf item. Groups and items that are not built yet have none. */
  to?: string
  /** Permission required to see the item; undefined means "always visible". */
  permission?: string
  /** Rendered greyed with a "Soon" tag and no route. */
  comingSoon?: boolean
  /** Key into the sidebar icon set (see NavIcon). Sub-items use a bullet instead. */
  icon?: string
  /** Present on a group: the items it expands to. */
  children?: NavItem[]
}

export interface NavSection {
  /** Heading shown above the section in the sidebar; the first section has none. */
  title?: string
  /** Label this section contributes to the breadcrumb (BACKOFFICE reads "Setup" there). */
  breadcrumb?: string
  items: NavItem[]
}

/**
 * The whole menu. Items the user has no permission for are hidden, groups that end up empty are
 * hidden with them, and a section whose items all disappear is dropped too.
 */
export const NAVIGATION: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', to: '/', icon: 'grid' },
      { label: 'Inventory', icon: 'box', comingSoon: true, children: [] },
      { label: 'Purchase Planning', icon: 'clipboard', comingSoon: true, children: [] },
      { label: 'Purchase Orders', icon: 'cart', comingSoon: true },
      { label: 'Invoices', icon: 'invoice', comingSoon: true },
      { label: 'Shipment & Containers', icon: 'truck', comingSoon: true, children: [] },
      { label: 'Costs & Payments', icon: 'wallet', comingSoon: true, children: [] },
      { label: 'Documents', icon: 'documents', comingSoon: true },
      { label: 'Reports', icon: 'reports', comingSoon: true },
    ],
  },
  {
    title: 'BACKOFFICE',
    breadcrumb: 'Setup',
    items: [
      {
        label: 'Master Data',
        icon: 'database',
        children: [
          { label: 'Branches / Sites', to: '/setup/master-data/branches', permission: PERMISSIONS.branchesView },
          { label: 'Warehouses', to: '/setup/master-data/warehouses', permission: PERMISSIONS.warehousesView },
          { label: 'Currencies', to: '/setup/master-data/currencies', permission: PERMISSIONS.currenciesView },
          { label: 'Item Families', to: '/setup/master-data/item-families', permission: PERMISSIONS.itemFamiliesView },
          { label: 'Units of Measure', comingSoon: true },
          { label: 'Brands', comingSoon: true },
        ],
      },
      {
        label: 'Users & Permissions',
        icon: 'users',
        children: [
          { label: 'Users', to: '/security/users', permission: PERMISSIONS.usersView },
          { label: 'Roles', to: '/security/roles', permission: PERMISSIONS.rolesView },
          // Assigning permissions to a role is a change to the ROLE, so it answers to the role codes:
          // rolesView to open it, rolesManage to save. It needs permissionsView as well to list the
          // catalog, but that is the catalog's own guard, not a second gate on this screen.
          { label: 'Role Permissions', to: '/security/role-permissions', permission: PERMISSIONS.rolesView },
          { label: 'Permissions', to: '/security/permissions', permission: PERMISSIONS.permissionsView },
          { label: 'Login audit', to: '/security/login-audit', permission: PERMISSIONS.auditView },
        ],
      },
      { label: 'Configuration', icon: 'settings', comingSoon: true, children: [] },
      { label: 'Integration', icon: 'plug', comingSoon: true },
      { label: 'Audit & Logs', icon: 'history', comingSoon: true, children: [] },
    ],
  },
]

/** True when the item is a group that expands to sub-items the user may open. */
export function isGroup(item: NavItem): boolean {
  return !item.comingSoon && (item.children?.length ?? 0) > 0
}

/**
 * The menu with everything the user cannot reach removed. Groups keep only the children the user
 * may open, and both groups and sections vanish once nothing is left inside them.
 *
 * `showComingSoon` decides whether the modules that are not built yet are listed at all. It defaults
 * to true so a caller that only cares about permissions - the dashboard's own section cards, say -
 * keeps its existing behaviour; the sidebar passes the reader's choice from useShowComingSoon().
 * With it false a group whose children are ALL unbuilt empties out and disappears with them, which
 * is what stops "Master Data" surviving as a heading over nothing.
 */
export function visibleNavigation(
  hasPermission: (code: string) => boolean,
  showComingSoon = true,
): NavSection[] {
  const allowed = (item: NavItem) => !item.permission || hasPermission(item.permission)
  const built = (item: NavItem) => showComingSoon || !item.comingSoon

  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => allowed(item) && built(item))
      .map((item) => (item.children ? { ...item, children: item.children.filter((c) => allowed(c) && built(c)) } : item))
      .filter((item) => !isGroupShell(item)),
  })).filter((section) => section.items.length > 0)
}

/** A group whose children were all filtered away - by permission or by not existing yet. */
function isGroupShell(item: NavItem): boolean {
  return !item.comingSoon && item.children !== undefined && item.children.length === 0
}

export interface NavLeaf {
  item: NavItem
  section: NavSection
  group?: NavItem
}

/** Every routable item, paired with the section and group it sits in. */
export function navLeaves(sections: NavSection[] = NAVIGATION): NavLeaf[] {
  const leaves: NavLeaf[] = []

  for (const section of sections) {
    for (const item of section.items) {
      if (item.to) leaves.push({ item, section })
      for (const child of item.children ?? []) {
        if (child.to) leaves.push({ item: child, section, group: item })
      }
    }
  }

  return leaves
}

/** The leaf matching a route: "/" only matches exactly, everything else matches by prefix. */
export function findLeaf(pathname: string, sections: NavSection[] = NAVIGATION): NavLeaf | undefined {
  const matches = navLeaves(sections).filter(({ item }) =>
    item.to === '/' ? pathname === '/' : pathname.startsWith(item.to as string),
  )

  // Prefer the longest route so /security/users wins over a hypothetical /security.
  return matches.sort((a, b) => (b.item.to as string).length - (a.item.to as string).length)[0]
}

/** Breadcrumb for a route, e.g. ['Setup', 'Master Data', 'Branches / Sites']. */
export function breadcrumbFor(pathname: string): string[] {
  const leaf = findLeaf(pathname)
  if (!leaf) {
    if (pathname.startsWith('/account/password')) return ['Change password']
    if (pathname.startsWith('/forbidden')) return ['Access denied']
    return []
  }

  return [leaf.section.breadcrumb, leaf.group?.label, leaf.item.label].filter((part): part is string => !!part)
}

/** Landing route after sign-in: the Users screen when allowed, otherwise the dashboard. */
export function landingRoute(permissions: string[] | undefined): string {
  return permissions?.includes(PERMISSIONS.usersView) ? '/security/users' : '/'
}
