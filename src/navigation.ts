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
  brandsView: 'masterdata.brands.view',
  brandsCreate: 'masterdata.brands.create',
  brandsEdit: 'masterdata.brands.edit',
  brandsDelete: 'masterdata.brands.delete',
  unitTypesView: 'masterdata.unittypes.view',
  unitTypesCreate: 'masterdata.unittypes.create',
  unitTypesEdit: 'masterdata.unittypes.edit',
  unitTypesDelete: 'masterdata.unittypes.delete',
  priceListsView: 'masterdata.pricelists.view',
  priceListsCreate: 'masterdata.pricelists.create',
  priceListsEdit: 'masterdata.pricelists.edit',
  priceListsDelete: 'masterdata.pricelists.delete',
  partiesView: 'masterdata.parties.view',
  partiesCreate: 'masterdata.parties.create',
  partiesEdit: 'masterdata.parties.edit',
  partiesDelete: 'masterdata.parties.delete',
  itemsView: 'inventory.items.view',
  itemsCreate: 'inventory.items.create',
  itemsEdit: 'inventory.items.edit',
  itemsDelete: 'inventory.items.delete',
  stockInView: 'inventory.stockin.view',
  stockInCreate: 'inventory.stockin.create',
  stockInPost: 'inventory.stockin.post',
  stockInCancel: 'inventory.stockin.cancel',
  stockInDelete: 'inventory.stockin.delete',
  stockOutView: 'inventory.stockout.view',
  stockOutCreate: 'inventory.stockout.create',
  stockOutPost: 'inventory.stockout.post',
  stockOutCancel: 'inventory.stockout.cancel',
  stockOutDelete: 'inventory.stockout.delete',
  invoicesImport: 'sales.invoices.import',
  invoicesPriceOverride: 'sales.invoices.priceoverride',
  invoicesView: 'sales.invoices.view',
  invoicesCreate: 'sales.invoices.create',
  invoicesPost: 'sales.invoices.post',
  invoicesCancel: 'sales.invoices.cancel',
  invoicesDelete: 'sales.invoices.delete',
  receiptsView: 'sales.receipts.view',
  receiptsCreate: 'sales.receipts.create',
  receiptsPost: 'sales.receipts.post',
  receiptsReverse: 'sales.receipts.reverse',
  receiptsDelete: 'sales.receipts.delete',
  receiptsAllocate: 'sales.receipts.allocate',
  documentTypesManage: 'inventory.documenttypes.manage',
  shortagesView: 'inventory.shortages.view',
  shortagesCreate: 'inventory.shortages.create',
  shortagesPost: 'inventory.shortages.post',
  shortagesDelete: 'inventory.shortages.delete',
  purchaseOrdersView: 'purchase.orders.view',
  purchaseOrdersCreate: 'purchase.orders.create',
  purchaseOrdersPost: 'purchase.orders.post',
  purchaseOrdersCancel: 'purchase.orders.cancel',
  purchaseOrdersDelete: 'purchase.orders.delete',
  purchaseInvoicesView: 'purchase.invoices.view',
  purchaseInvoicesCreate: 'purchase.invoices.create',
  purchaseInvoicesPost: 'purchase.invoices.post',
  purchaseInvoicesCancel: 'purchase.invoices.cancel',
  purchaseInvoicesDelete: 'purchase.invoices.delete',
  purchaseReturnsView: 'purchase.returns.view',
  purchaseReturnsCreate: 'purchase.returns.create',
  purchaseReturnsPost: 'purchase.returns.post',
  purchaseReturnsCancel: 'purchase.returns.cancel',
  purchaseReturnsDelete: 'purchase.returns.delete',
  chargeTypesManage: 'purchase.chargetypes.manage',
  settingsManage: 'configuration.settings.manage',
  emailsView: 'messaging.emails.view',
  emailSettingsManage: 'settings.email.manage',
  approvalManage: 'purchase.approval.manage',
  outOfStockAuditView: 'sales.outofstockaudit.view',
  paymentsView: 'purchase.payments.view',
  paymentsCreate: 'purchase.payments.create',
  paymentsPost: 'purchase.payments.post',
  paymentsReverse: 'purchase.payments.reverse',
  paymentsDelete: 'purchase.payments.delete',
  paymentsAllocate: 'purchase.payments.allocate',
  landedCostsView: 'purchase.landedcosts.view',
  landedCostsCreate: 'purchase.landedcosts.create',
  landedCostsPost: 'purchase.landedcosts.post',
  landedCostsCancel: 'purchase.landedcosts.cancel',
  landedCostsDelete: 'purchase.landedcosts.delete',
  salesProfitView: 'sales.profit.view',
  containersView: 'containers.view',
  containersCreate: 'containers.create',
  containersConfirm: 'containers.confirm',
  containersOffload: 'containers.offload',
  containersCancel: 'containers.cancel',
  containersClose: 'containers.close',
  containersDelete: 'containers.delete',
  containersOverCapacity: 'containers.overcapacity',
  movementsManage: 'containers.movements.manage',
  containerChargesView: 'containers.charges.view',
  containerChargesCreate: 'containers.charges.create',
  containerChargesPost: 'containers.charges.post',
  containerChargesCancel: 'containers.charges.cancel',
  containerAttachmentsManage: 'containers.attachments.manage',
  containerTypesManage: 'masterdata.containertypes.manage',
  portsManage: 'masterdata.ports.manage',
  attachmentTypesManage: 'masterdata.attachmenttypes.manage',
  movementTypesManage: 'masterdata.movementtypes.manage',
  paymentMethodsManage: 'masterdata.paymentmethods.manage',
  cashBankAccountsManage: 'masterdata.cashbankaccounts.manage',
} as const

export interface NavItem {
  label: string
  /** Route of a leaf item. Groups and items that are not built yet have none. */
  to?: string
  /** Permission required to see the item; undefined means "always visible". */
  permission?: string
  /** Rendered greyed with a "Soon" tag and no route. */
  comingSoon?: boolean
  /** A short tag beside the label — "Preview" on a screen that exists only to try something out. */
  badge?: string
  /**
   * False hides the item from the sidebar, the menu search AND the Spotlight while its route keeps
   * working — for a screen that is kept but not offered, so a bookmark still opens it.
   */
  visible?: boolean
  /**
   * A fact about the reader that only the server knows live, beyond the permissions (see NavFacts):
   * the item is listed only while it is true. Approvals is offered to the in-app approvers only.
   */
  requires?: 'canApproveInApp'
  /** A live count shown in red beside the label (see NavFacts), hidden at 0: what waits for the reader. */
  countOf?: 'pendingApprovals'
  /** Key into the sidebar icon set (see NavIcon). Sub-items use a bullet instead. */
  icon?: string
  /**
   * The whole breadcrumb for this item, when the trail the menu implies is not the one the screen
   * should show. Price Lists sits beside Item Definition because that is where a reader looks for
   * it, but it is setup data and the approved design reads "Setup › Inventory › Price Lists".
   */
  breadcrumb?: string[]
  /** Present on a group: the items it expands to. */
  children?: NavItem[]
}

/**
 * What the menu needs to know about the reader that is not in their permissions — read from the
 * server and refreshed while the application is open (useApprovalsMe). Missing facts count as false
 * and 0, so an item that `requires` one stays hidden until the answer arrives.
 */
export interface NavFacts {
  canApproveInApp: boolean
  pendingApprovals: number
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
      { label: 'Purchase Planning', icon: 'clipboard', comingSoon: true, children: [] },
      { label: 'Purchase Orders', icon: 'cart', comingSoon: true },
      { label: 'Invoices', icon: 'invoice', comingSoon: true },
      { label: 'Costs & Payments', icon: 'wallet', comingSoon: true, children: [] },
      { label: 'Documents', icon: 'documents', comingSoon: true },
      { label: 'Reports', icon: 'reports', comingSoon: true },
    ],
  },
  {
    // The stock screens are not built yet, but Item Definition is the heart of the application and
    // belongs in its own section rather than buried under Master Data.
    title: 'INVENTORY',
    breadcrumb: 'Inventory',
    items: [
      { label: 'Item Definition', to: '/inventory/items', permission: PERMISSIONS.itemsView, icon: 'box' },
      {
        label: 'Price Lists',
        to: '/inventory/price-lists',
        permission: PERMISSIONS.priceListsView,
        icon: 'price',
        breadcrumb: ['Setup', 'Inventory', 'Price Lists'],
      },
      // The two document screens sit directly under Item Definition: they are what people open all
      // day, and the read-only stock views below them are answers to questions these documents ask.
      { label: 'Inventory In', to: '/inventory/stock-in', permission: PERMISSIONS.stockInView, icon: 'box' },
      { label: 'Inventory Out', to: '/inventory/stock-out', permission: PERMISSIONS.stockOutView, icon: 'box' },
      // What the shelves are worth: the item list with its money shown, behind the same permission.
      { label: 'Stock Valuation', to: '/inventory/valuation', permission: PERMISSIONS.itemsView, icon: 'balance' },
      { label: 'Stock Balance', icon: 'balance', comingSoon: true },
      { label: 'Stock Movement', icon: 'movement', comingSoon: true },
      // Shortage plans: saved planning documents (draft, then a posted snapshot) that purchase orders are created from.
      { label: 'Shortages', to: '/inventory/shortages', permission: PERMISSIONS.shortagesView, icon: 'shortage' },
    ],
  },
  {
    // BUYING, IN THE ORDER IT HAPPENS: an order is confirmed, the supplier invoices it (stock in,
    // costs set), and what is wrong goes back on a return. One page serves all three.
    title: 'PURCHASE',
    breadcrumb: 'Purchase',
    items: [
      { label: 'Purchase Orders', to: '/purchase/orders', permission: PERMISSIONS.purchaseOrdersView, icon: 'cart' },
      // The orders waiting for the reader's decision: approvers in the app only (Settings > Purchase approval).
      {
        label: 'Approvals',
        to: '/purchase/approvals',
        permission: PERMISSIONS.purchaseOrdersView,
        requires: 'canApproveInApp',
        countOf: 'pendingApprovals',
        icon: 'approval',
      },
      { label: 'Purchase Invoices', to: '/purchase/invoices', permission: PERMISSIONS.purchaseInvoicesView, icon: 'invoice' },
      { label: 'Purchase Returns', to: '/purchase/returns', permission: PERMISSIONS.purchaseReturnsView, icon: 'movement' },
      // Money going out: advances, purchase invoice payments and container charge payments (US-PAY-001).
      { label: 'Supplier Payments', to: '/purchase/payments', permission: PERMISSIONS.paymentsView, icon: 'wallet' },
      // Charges that arrive after the goods: they move value, not stock, so they are their own document.
      { label: 'Landed Cost Adjustments', to: '/purchase/landed-cost-adjustments', permission: PERMISSIONS.landedCostsView, icon: 'price' },
      // Defining the charge types is setup; entering a charge is not. Both live where they are used.
      { label: 'Charge Types', to: '/purchase/charge-types', permission: PERMISSIONS.chargeTypesManage, icon: 'settings' },
    ],
  },
  {
    // THE SHIPMENT BETWEEN THE ORDER AND THE WAREHOUSE: containers loaded from purchase orders, the
    // movements they travel with, the charges that make their real cost, and the tracking board.
    title: 'LOGISTICS',
    breadcrumb: 'Logistics',
    items: [
      { label: 'Containers', to: '/logistics/containers', permission: PERMISSIONS.containersView, icon: 'truck' },
      { label: 'Movements', to: '/logistics/movements', permission: PERMISSIONS.containersView, icon: 'ship' },
      { label: 'Container Charges', to: '/logistics/container-charges', permission: PERMISSIONS.containerChargesView, icon: 'coins' },
      { label: 'Tracking', to: '/logistics/tracking', permission: PERMISSIONS.containersView, icon: 'route' },
    ],
  },
  {
    // HIDDEN, NOT REMOVED. The import page turned a spreadsheet into a posted invoice before the
    // Sales Invoice screen existed; that screen hosts the same wizard now, so the page is kept for
    // its route and its code but is not offered in the menu, the search or the Spotlight.
    title: 'SALES',
    breadcrumb: 'Sales',
    items: [
      { label: 'Sales Invoices', to: '/sales/invoices', permission: PERMISSIONS.invoicesView, icon: 'invoice' },
      // Net sales less the cost frozen on each line. Its own permission: a margin is not a price.
      { label: 'Sales Profit', to: '/sales/profit', permission: PERMISSIONS.salesProfitView, icon: 'reports' },
      { label: 'Receipts', to: '/sales/receipts', permission: PERMISSIONS.receiptsView, icon: 'wallet' },
      { label: 'Customer Statement', to: '/sales/receipts/statement', permission: PERMISSIONS.receiptsView, icon: 'reports' },
      // Who confirmed selling below zero stock, and when: the audit of the Allow Selling Out of Stock setting.
      { label: 'Out-of-Stock Sales', to: '/sales/out-of-stock-audit', permission: PERMISSIONS.outOfStockAuditView, icon: 'reports' },
      {
        label: 'Import Sales from Excel',
        to: '/sales/import-preview',
        permission: PERMISSIONS.invoicesImport,
        icon: 'invoice',
        visible: false,
      },
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
          { label: 'Exchange Rates', to: '/setup/master-data/exchange-rates', permission: PERMISSIONS.exchangeRatesView },
          { label: 'Item Families', to: '/setup/master-data/item-families', permission: PERMISSIONS.itemFamiliesView },
          { label: 'Brands', to: '/setup/master-data/brands', permission: PERMISSIONS.brandsView },
          { label: 'Parties', to: '/setup/master-data/parties', permission: PERMISSIONS.partiesView },
          { label: 'Unit Types', to: '/setup/master-data/unit-types', permission: PERMISSIONS.unitTypesView },
          // The lists the container pages pick from.
          { label: 'Container Types', to: '/setup/master-data/container-types', permission: PERMISSIONS.containerTypesManage },
          { label: 'Ports', to: '/setup/master-data/ports', permission: PERMISSIONS.portsManage },
          { label: 'Attachment Types', to: '/setup/master-data/attachment-types', permission: PERMISSIONS.attachmentTypesManage },
          { label: 'Movement Types', to: '/setup/master-data/movement-types', permission: PERMISSIONS.movementTypesManage },
          // The lists a customer receipt line picks from.
          { label: 'Payment Methods', to: '/setup/master-data/payment-methods', permission: PERMISSIONS.paymentMethodsManage },
          { label: 'Cash / Bank Accounts', to: '/setup/master-data/cash-bank-accounts', permission: PERMISSIONS.cashBankAccountsManage },
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
      { label: 'Integration', icon: 'plug', comingSoon: true },
      { label: 'Audit & Logs', icon: 'history', comingSoon: true, children: [] },
    ],
  },
  {
    // WHAT A BUSINESS OWNER CHANGES ONCE AND LEAVES ALONE: how documents number, price and behave.
    // Its own section rather than a group under Setup, so it is found by the people who own it.
    title: 'CONFIGURATION',
    breadcrumb: 'Configuration',
    items: [
      {
        label: 'Document Types',
        to: '/configuration/document-types',
        permission: PERMISSIONS.documentTypesManage,
        icon: 'settings',
      },
      {
        // Settings, one page each: the global switches (each setting a row, drawn by one page), the mail
        // server and its log, and who approves purchase orders.
        label: 'Settings',
        icon: 'settings',
        children: [
          { label: 'General', to: '/configuration/settings', permission: PERMISSIONS.settingsManage },
          { label: 'Email', to: '/configuration/email', permission: PERMISSIONS.emailSettingsManage },
          { label: 'Email log', to: '/configuration/email-log', permission: PERMISSIONS.emailsView },
          { label: 'Purchase approval', to: '/configuration/purchase-approval', permission: PERMISSIONS.approvalManage },
        ],
      },
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
 *
 * `facts` are the live answers an item may require (NavFacts); a caller that passes none hides those items.
 */
export function visibleNavigation(
  hasPermission: (code: string) => boolean,
  showComingSoon = true,
  facts: Partial<NavFacts> = {},
): NavSection[] {
  const allowed = (item: NavItem) =>
    (!item.permission || hasPermission(item.permission)) && (!item.requires || facts[item.requires] === true)
  const built = (item: NavItem) => (showComingSoon || !item.comingSoon) && item.visible !== false

  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => allowed(item) && built(item))
      .map((item) =>
        item.children ? { ...item, children: item.children.filter((c) => allowed(c) && built(c)) } : item,
      )
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

  // An item may carry the whole trail itself when the menu's own one is not what the screen shows.
  if (leaf.item.breadcrumb) return leaf.item.breadcrumb

  return [leaf.section.breadcrumb, leaf.group?.label, leaf.item.label].filter((part): part is string => !!part)
}

/** Landing route after sign-in: the Users screen when allowed, otherwise the dashboard. */
export function landingRoute(permissions: string[] | undefined): string {
  return permissions?.includes(PERMISSIONS.usersView) ? '/security/users' : '/'
}

/**
 * The menu narrowed to what matches a typed query - the sidebar's search box and nothing else
 * decides what "matching" means, so the box and the Spotlight cannot drift apart.
 *
 * Three rules, in the order a reader would expect them:
 *  - a SECTION named by the query answers it whole ("setup" is a place, not a page), so it is kept
 *    intact - its heading is matched on both the title it shows and the breadcrumb word it stands for;
 *  - a GROUP whose own label matches keeps every child, because "master data" asks for the group;
 *  - otherwise a group survives on its matching children alone, and everything else disappears.
 *
 * Feed it an already-permission-filtered list ({@link visibleNavigation}): a search must never be a
 * way to see a page the menu is hiding.
 */
export function searchNavigation(sections: NavSection[], query: string): NavSection[] {
  const term = query.trim().toLowerCase()
  if (!term) return sections

  const hits = (text?: string) => !!text && text.toLowerCase().includes(term)

  return sections
    .map((section) => {
      if (hits(section.title) || hits(section.breadcrumb)) return section

      const items = section.items
        .map((item) => {
          if (hits(item.label)) return item
          const children = (item.children ?? []).filter((child) => hits(child.label))
          return children.length > 0 ? { ...item, children } : null
        })
        .filter((item): item is NavItem => item !== null)

      return { ...section, items }
    })
    .filter((section) => section.items.length > 0)
}
