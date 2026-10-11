import type { WarehouseLookupDto } from '../../api/types'

/*
 * THE WAREHOUSE OF A DOCUMENT LINE, the same rule on every document that moves stock (sales invoices
 * and returns, purchase orders, invoices and returns, Inventory In and Out, and their imports):
 *
 *  - ANY BRANCH. The header's branch numbers the document and says where it was made; it does not
 *    limit where a line takes or puts stock.
 *  - A LEAF ONLY. A warehouse with warehouses under it is a group, not a place: stock lives in the
 *    warehouses at the bottom of the tree. The database refuses a parent too (script 65).
 */

const isLeaf = (warehouse: WarehouseLookupDto) => warehouse.childCount === 0

/**
 * The options of a line's Warehouse select: the leaves of every branch, the header branch's first
 * and the others with their branch named. `keepIds` (the warehouses the lines already hold) stay in
 * the list even when they are no longer allowed, so an older line still shows where it is — marked,
 * so the reader knows to change it.
 */
export function lineWarehouseOptions(
  warehouses: WarehouseLookupDto[],
  headerBranchId: number | null,
  keepIds: (number | null | undefined)[] = [],
): { value: string; label: string }[] {
  const keep = new Set(keepIds.filter((id): id is number => typeof id === 'number'))
  return warehouses
    .filter((w) => isLeaf(w) || keep.has(w.id))
    .sort(
      (a, b) =>
        Number(b.branchId === headerBranchId) - Number(a.branchId === headerBranchId) ||
        a.branchName.localeCompare(b.branchName) ||
        a.warehouseName.localeCompare(b.warehouseName),
    )
    .map((w) => {
      const name = w.branchId === headerBranchId ? w.warehouseName : `${w.warehouseName} (${w.branchName})`
      return { value: String(w.id), label: isLeaf(w) ? name : `${name} - has warehouses under it, choose one of those` }
    })
}

/** The warehouse a new line starts in: the branch's main warehouse when it is a leaf, else the branch's first leaf. */
export function defaultLineWarehouseId(warehouses: WarehouseLookupDto[], branchId: number | null): number | null {
  if (branchId === null) return null
  const leaves = warehouses.filter((w) => w.branchId === branchId && w.isActive && isLeaf(w))
  return (leaves.find((w) => w.isMainWarehouse) ?? leaves[0])?.id ?? null
}
