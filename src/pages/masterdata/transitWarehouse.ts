import type { WarehouseDto } from '../../api/types'

/**
 * (90) THE ON THE WAY WAREHOUSE OF A BRANCH: where a transfer's goods sit between their dispatch and their receipt.
 * The system makes one per branch and keeps it (never a parent, never deactivated, removed with its branch), so the
 * Warehouses page edits only its name and address and says why everything else stays as it is - in the row's badge
 * and in the form, in the same words.
 */
export function transitHint(warehouse: Pick<WarehouseDto, 'branchCode'>): string {
  return `Managed by transfers: the On the way warehouse of ${warehouse.branchCode}.`
}
