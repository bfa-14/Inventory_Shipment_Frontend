import type { WarehouseLookupDto } from '../../api/types'

/*
 * THE WAREHOUSE OF A DOCUMENT LINE, the same rule on every document that moves stock (sales invoices
 * and returns, purchase orders, invoices and returns, Inventory In and Out, and their imports):
 *
 *  - ANY BRANCH. The header's branch numbers the document and says where it was made; it does not
 *    limit where a line takes or puts stock.
 *  - A LEAF ONLY. A warehouse with warehouses under it is a group, not a place: stock lives in the
 *    warehouses at the bottom of the tree. The database refuses a parent too (script 70; goods receipts, 72).
 */

const isLeaf = (warehouse: WarehouseLookupDto) => warehouse.childCount === 0

/**
 * The options of a line's Warehouse select: the leaves of every branch, the header branch's first
 * and the others with their branch named. `keepIds` (the warehouses the lines already hold) stay in
 * the list even when they are no longer allowed, so an older line still shows where it is — marked,
 * so the reader knows to change it.
 *
 * `usableOnly` (92, the pages of documents that move stock): only the leaves the READER may use (`canUse` of the
 * lookup, missing = true); a kept one the reader may not use stays, marked "- not one of your warehouses" (the
 * parent's mark wins when both apply). Left out, the list is exactly what it was.
 */
export function lineWarehouseOptions(
  warehouses: WarehouseLookupDto[],
  headerBranchId: number | null,
  keepIds: (number | null | undefined)[] = [],
  usableOnly = false,
): { value: string; label: string }[] {
  const keep = new Set(keepIds.filter((id): id is number => typeof id === 'number'))
  const usable = (w: WarehouseLookupDto) => !usableOnly || w.canUse !== false
  return warehouses
    .filter((w) => (isLeaf(w) && usable(w)) || keep.has(w.id))
    .sort(
      (a, b) =>
        Number(b.branchId === headerBranchId) - Number(a.branchId === headerBranchId) ||
        a.branchName.localeCompare(b.branchName) ||
        a.warehouseName.localeCompare(b.warehouseName),
    )
    .map((w) => {
      const name = w.branchId === headerBranchId ? w.warehouseName : `${w.warehouseName} (${w.branchName})`
      if (!isLeaf(w)) return { value: String(w.id), label: `${name} - has warehouses under it, choose one of those` }
      return { value: String(w.id), label: usable(w) ? name : `${name} - ${NOT_ONE_OF_YOURS}` }
    })
}

/** (92) The mark of a warehouse a document already holds but the reader may not use. */
export const NOT_ONE_OF_YOURS = 'not one of your warehouses'

/**
 * (92) What a line's Warehouse cell says under its select when the line holds a warehouse the reader may not use: the
 * cell (190 px) cuts the label before its mark ("TEST92-G1 w…"), so the mark is said where it can be read. Undefined
 * for every other line - and for every line of a reader who may use every warehouse.
 */
export function notYoursNote(
  options: ({ value: string; label: string } | { group: string; items: { value: string; label: string }[] })[],
  warehouseId: number | string | null,
): string | undefined {
  if (warehouseId === null || warehouseId === '') return undefined
  const flat = options.flatMap((o) => ('items' in o ? o.items : [o]))
  const chosen = flat.find((o) => o.value === String(warehouseId))
  return chosen?.label.endsWith(` - ${NOT_ONE_OF_YOURS}`) ? 'Not one of your warehouses' : undefined
}

/**
 * The warehouse a new line starts in: the branch's main warehouse when it is a leaf, else the branch's first leaf.
 *
 * `usableOnly` (92): among the leaves the reader may use; none in the branch and the reader restricted, the reader's
 * first usable leaf of any branch (its main one first). Left out - or for a reader who may use every warehouse -
 * exactly what it was.
 */
export function defaultLineWarehouseId(
  warehouses: WarehouseLookupDto[],
  branchId: number | null,
  usableOnly = false,
): number | null {
  if (branchId === null) return null
  const candidates = warehouses.filter((w) => w.isActive && isLeaf(w) && (!usableOnly || w.canUse !== false))
  const leaves = candidates.filter((w) => w.branchId === branchId)
  const pick = (list: WarehouseLookupDto[]) => (list.find((w) => w.isMainWarehouse) ?? list[0])?.id ?? null
  const restricted = usableOnly && warehouses.some((w) => !w.isTransit && w.canUse === false)
  return pick(leaves) ?? (restricted ? pick(candidates.filter((w) => !w.isTransit)) : null)
}
