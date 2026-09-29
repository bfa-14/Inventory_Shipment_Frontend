import { useEffect, useState } from 'react'
import { brandsApi } from '../../api/masterdata/brands'
import { itemFamiliesApi } from '../../api/masterdata/itemFamilies'
import { unitTypesApi } from '../../api/masterdata/unitTypes'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BrandLookupDto, ItemFamilyLookupDto, UnitTypeLookupDto, WarehouseLookupDto } from '../../api/types'

export interface ItemLookups {
  brands: BrandLookupDto[]
  families: ItemFamilyLookupDto[]
  warehouses: WarehouseLookupDto[]
  unitTypes: UnitTypeLookupDto[]
  loading: boolean
  /** Set when a lookup could not be read; the pickers are then empty and say so. */
  error: string | null
}

const EMPTY: ItemLookups = { brands: [], families: [], warehouses: [], unitTypes: [], loading: true, error: null }

/**
 * The four dropdowns every Item screen needs, fetched once in parallel.
 *
 * `includeIds` keeps the records an item already points at in their list even when the master data
 * behind them has since been deactivated - otherwise opening an old item would silently blank its
 * Brand or Family, and saving would write that blank back.
 */
export function useItemLookups(includeIds?: {
  brandId?: number
  familyId?: number
  warehouseId?: number
}): ItemLookups {
  const [state, setState] = useState<ItemLookups>(EMPTY)

  const brandId = includeIds?.brandId
  const familyId = includeIds?.familyId
  const warehouseId = includeIds?.warehouseId

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      try {
        const [brands, families, warehouses, unitTypes] = await Promise.all([
          brandsApi.lookup(true, brandId),
          itemFamiliesApi.lookup(true, familyId),
          // The warehouse lookup's second argument is a branch filter, not the include - all
          // branches are offered here, and only the item's own warehouse is force-included.
          warehousesApi.lookup(true, undefined, warehouseId),
          unitTypesApi.lookup(true, undefined, controller.signal),
        ])
        if (controller.signal.aborted) return
        setState({ brands, families, warehouses, unitTypes, loading: false, error: null })
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        setState({ ...EMPTY, loading: false, error: 'The dropdown lists could not be loaded.' })
      }
    })()

    return () => controller.abort()
  }, [brandId, familyId, warehouseId])

  return state
}

/** "BRD-001 - TVS", marked when the brand is no longer active. */
export function brandLabel(brand: BrandLookupDto): string {
  return `${brand.brandCode} - ${brand.brandName}${brand.isActive ? '' : ' (inactive)'}`
}

/** "WH-001 - Main Warehouse", marked when the warehouse is no longer active. */
export function warehouseLabel(warehouse: WarehouseLookupDto): string {
  return `${warehouse.warehouseCode} - ${warehouse.warehouseName}${warehouse.isActive ? '' : ' (inactive)'}`
}

/**
 * The family's label in a picker, indented one dash per level below the root so the hierarchy is
 * readable in a flat list. A Select has no room for a real tree, and the codes alone
 * ("FAM-001-03-01") do not tell a reader where a family sits.
 */
export function familyOptionLabel(family: ItemFamilyLookupDto): string {
  const indent = '— '.repeat(Math.max(0, family.level - 1))
  return `${indent}${family.familyName}${family.isActive ? '' : ' (inactive)'}`
}

/**
 * Options for a family Select, in tree order (a parent immediately before its children).
 *
 * `leavesOnly` offers only the families nothing sits under - a family with no children, whether it
 * is a root standing alone or the last child of a long branch. WHERE AN ITEM IS FILED, it belongs
 * to one particular family rather than to the group above it: "Motorcycles" is a heading, and
 * filing a bike under the heading instead of under its model is how a catalogue stops answering
 * "how many of these do we have". A FILTER keeps every family, since narrowing by a heading is a
 * fair question to ask of a list.
 *
 * `keepId` is always offered whatever the rest of the rule says. An item already filed under a
 * family that has since been given children must go on showing it: dropping it would blank the
 * field, and the next save would write that blank back as a real change.
 */
export function familyOptions(
  families: ItemFamilyLookupDto[],
  options?: { leavesOnly?: boolean; keepId?: number | null },
): { value: string; label: string }[] {
  const ordered = orderAsTree(families)
  if (options?.leavesOnly !== true) return ordered.map(toFamilyOption)

  // Judged on the families in hand. The lookup carries the active ones, so a family whose children
  // are all deactivated reads as a leaf - which is right: they are not on offer either.
  const parents = new Set<number>()
  for (const family of families) {
    if (family.parentId !== null) parents.add(family.parentId)
  }

  return ordered
    .filter((family) => !parents.has(family.id) || family.id === options.keepId)
    .map(toFamilyOption)
}

function toFamilyOption(family: ItemFamilyLookupDto): { value: string; label: string } {
  return { value: String(family.id), label: familyOptionLabel(family) }
}

/**
 * The flat lookup re-ordered depth-first, so an indented label lands under the family it belongs to.
 * The API sends the list ordered by level, which would otherwise print every root, then every
 * second-level family, and so on - indentation over an order that contradicts it reads as noise.
 *
 * The walk is an explicit stack, not recursion: the tree has no depth limit, and a cycle (which the
 * API forbids, but a stale reload could still show) must not blow the stack. Anything unreachable
 * from a root is appended at the end rather than dropped.
 */
function orderAsTree(families: ItemFamilyLookupDto[]): ItemFamilyLookupDto[] {
  const byParent = new Map<number, ItemFamilyLookupDto[]>()
  const ROOT = 0

  for (const family of families) {
    const key = family.parentId ?? ROOT
    const siblings = byParent.get(key)
    if (siblings) siblings.push(family)
    else byParent.set(key, [family])
  }

  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.familyCode.localeCompare(b.familyCode))
  }

  const ordered: ItemFamilyLookupDto[] = []
  const seen = new Set<number>()
  const stack = [...(byParent.get(ROOT) ?? [])].reverse()

  while (stack.length > 0) {
    const family = stack.pop() as ItemFamilyLookupDto
    if (seen.has(family.id)) continue
    seen.add(family.id)
    ordered.push(family)

    const children = byParent.get(family.id) ?? []
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i] as ItemFamilyLookupDto)
  }

  for (const family of families) {
    if (!seen.has(family.id)) ordered.push(family)
  }

  return ordered
}
