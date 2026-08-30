import { useLocalStorage } from '@mantine/hooks'

/** Where the reader's choice is remembered. */
export const COMING_SOON_KEY = 'inventory_shipment.showComingSoon'

/**
 * Whether the sidebar lists the modules that are not built yet - the "Soon" entries.
 *
 * Hidden by DEFAULT: a menu is a list of places you can go, and nine dead entries above the two
 * live ones make the working application look like a demo. They stay reachable through the switch
 * on the dashboard, because a roadmap is still worth showing on purpose.
 *
 * Mantine's useLocalStorage keeps every caller of this hook in step within the tab (it broadcasts
 * its own event on write), so the sidebar re-renders the moment the dashboard's switch moves - no
 * provider, no prop drilling. getInitialValueInEffect is off so the nav paints its final shape on
 * the first render instead of flashing the coming-soon entries and then dropping them.
 */
export function useShowComingSoon() {
  return useLocalStorage<boolean>({
    key: COMING_SOON_KEY,
    defaultValue: false,
    getInitialValueInEffect: false,
  })
}
