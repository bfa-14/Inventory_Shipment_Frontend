import {
  IconBuildingWarehouse,
  IconClipboardList,
  IconCreditCard,
  IconDatabase,
  IconFileInvoice,
  IconFiles,
  IconHistory,
  IconLayoutGrid,
  IconPlug,
  IconReportAnalytics,
  IconSettings,
  IconShoppingCart,
  IconTruck,
  IconUsers,
} from '@tabler/icons-react'

const ICONS = {
  grid: IconLayoutGrid,
  box: IconBuildingWarehouse,
  clipboard: IconClipboardList,
  cart: IconShoppingCart,
  invoice: IconFileInvoice,
  truck: IconTruck,
  wallet: IconCreditCard,
  documents: IconFiles,
  reports: IconReportAnalytics,
  database: IconDatabase,
  users: IconUsers,
  settings: IconSettings,
  plug: IconPlug,
  history: IconHistory,
} as const

/** Maps a navigation model icon key to its Tabler icon. */
export function NavIcon({ name, size = 19 }: { name?: string; size?: number }) {
  const Icon = ICONS[(name ?? 'grid') as keyof typeof ICONS] ?? IconLayoutGrid
  return <Icon size={size} stroke={1.6} />
}
