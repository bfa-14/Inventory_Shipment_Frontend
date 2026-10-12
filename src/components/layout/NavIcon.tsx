import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconBuildingWarehouse,
  IconClipboardList,
  IconCreditCard,
  IconDatabase,
  IconFileInvoice,
  IconFiles,
  IconHistory,
  IconHome,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconPlug,
  IconReceipt2,
  IconReportAnalytics,
  IconScale,
  IconSettings,
  IconShoppingCart,
  IconTruck,
  IconUsers,
  IconCoins,
  IconChecklist,
  IconRoute,
  IconShip,
  IconPackageImport,
} from '@tabler/icons-react'

const ICONS = {
  grid: IconLayoutGrid,
  home: IconHome,
  dashboard: IconLayoutDashboard,
  box: IconBuildingWarehouse,
  balance: IconScale,
  movement: IconArrowsExchange,
  shortage: IconAlertTriangle,
  clipboard: IconClipboardList,
  cart: IconShoppingCart,
  invoice: IconFileInvoice,
  truck: IconTruck,
  wallet: IconCreditCard,
  documents: IconFiles,
  reports: IconReportAnalytics,
  database: IconDatabase,
  price: IconReceipt2,
  users: IconUsers,
  settings: IconSettings,
  plug: IconPlug,
  history: IconHistory,
  ship: IconShip,
  route: IconRoute,
  coins: IconCoins,
  approval: IconChecklist,
  // Goods receipts: goods coming into the stock (`box` is the warehouse).
  inbox: IconPackageImport,
} as const

/** Maps a navigation model icon key to its Tabler icon. */
export function NavIcon({ name, size = 19 }: { name?: string; size?: number }) {
  const Icon = ICONS[(name ?? 'grid') as keyof typeof ICONS] ?? IconLayoutGrid
  return <Icon size={size} stroke={1.6} />
}
