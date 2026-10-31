import { useAuth } from '../auth/useAuth'
import { PERMISSIONS } from '../navigation'

/**
 * (94) Whether the signed-in user may see what an item costs (`inventory.costs.view`, "View item costs"): the average,
 * last and FOB cost and the stock values on Item Definition, Inventory In / Out / BIVAC Out, goods receipts, Shortages,
 * transfer orders and the Dashboard. Without it the API sends every such figure null.
 *
 * THE PERMISSION DECIDES THE LAYOUT, NOT THE DATA: a viewer still sees '—' for an item without a cost, a reader without
 * it sees no column.
 */
export function useSeesItemCosts(): boolean {
  const { hasPermission } = useAuth()
  return hasPermission(PERMISSIONS.costsView)
}
