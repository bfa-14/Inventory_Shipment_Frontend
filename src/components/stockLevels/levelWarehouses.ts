import type { WarehouseLookupDto } from '../../api/types'

/**
 * THE WAREHOUSES A STOCK LEVEL MAY TAKE (script 91, rule S2): an ACTIVE warehouse at the bottom of the tree, of any
 * branch, never an On the way warehouse - the rule usp_ItemWarehouseLevel_Set checks again. Grouped by branch, as a
 * transfer order's From and To are, so the same warehouse reads the same everywhere.
 */
export interface LevelWarehouseOption {
  value: string
  label: string
  disabled?: boolean
}

export interface LevelWarehouseGroup {
  group: string
  items: LevelWarehouseOption[]
}

/** Active, a leaf, not On the way. */
export function isLevelWarehouse(warehouse: WarehouseLookupDto): boolean {
  return warehouse.isActive && warehouse.childCount === 0 && warehouse.isTransit !== true
}

/**
 * The pickers' data: the warehouses a level may take, grouped by branch (branch name, then code). `except` leaves one
 * out (a transfer order's To, which cannot be its From).
 *
 * `usableOnly` (92): only the warehouses the reader may use (`canUse` of the lookup, missing = true) - setting a level
 * needs the warehouse (W17), and a transfer order's From is the reader's (A9). Left out, exactly what it was.
 */
export function levelWarehouseChoices(
  warehouses: WarehouseLookupDto[],
  except?: number | null,
  usableOnly = false,
): LevelWarehouseGroup[] {
  const shown = warehouses
    .filter((w) => isLevelWarehouse(w) && w.id !== except && (!usableOnly || w.canUse !== false))
    .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.warehouseCode.localeCompare(b.warehouseCode))
  const groups = new Map<string, LevelWarehouseOption[]>()
  for (const w of shown) {
    const group = `${w.branchCode} - ${w.branchName}`
    const list = groups.get(group) ?? []
    list.push({ value: String(w.id), label: `${w.warehouseCode} - ${w.warehouseName}` })
    groups.set(group, list)
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }))
}
