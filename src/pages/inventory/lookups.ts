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
 * The family's label in a picker: its whole path, parents first -
 * "Motorcycles \ Electricals \ Battery".
 *
 * THE PATH RATHER THAN AN INDENT. An indented name reads as a tree in the open list and as nothing
 * at all in the closed field: "Battery" alone does not say WHICH Battery, and the codes
 * ("FAM-001-03-01") say it only to whoever has memorised them. The path says it in both places,
 * and it makes the search behave the way a reader expects - typing "Electricals" now finds
 * everything standing under it, which an indented list could never do.
 *
 * `byId` is every family that was loaded, so the walk can climb to the root. A family whose parent
 * is missing from it - deactivated, say - stops there and shows the path it can.
 */
export function familyOptionLabel(
  family: ItemFamilyLookupDto,
  byId: Map<number, ItemFamilyLookupDto>,
): string {
  const names: string[] = []
  const seen = new Set<number>()

  let current: ItemFamilyLookupDto | undefined = family
  // Guarded against a cycle the API forbids but a stale reload could still be holding.
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id)
    names.unshift(current.familyName)
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }

  return `${names.join(' \\ ')}${family.isActive ? '' : ' (inactive)'}`
}

/** One entry of a picker. `disabled` shows it without letting it be chosen. */
export interface PickerOption {
  value: string
  label: string
  disabled?: boolean
}

/** A heading with its choices under it. The heading itself is never selectable. */
export interface PickerGroup {
  group: string
  items: PickerOption[]
}

/**
 * Options for a family Select, in tree order (a parent immediately before its children).
 *
 * `leavesSelectableOnly` GREYS THE PARENTS OUT RATHER THAN HIDING THEM. An item is filed under one
 * particular family, not under the heading above it - filing a bike under "Motorcycles" instead of
 * under its model is how a catalogue stops answering "how many of these do we have". But a list of
 * leaves alone loses the thing that made the leaf make sense: "Battery" means little until you can
 * see "Motorcycles \ Electricals" standing over it. So the headings stay, dimmed and unclickable,
 * and the reader keeps their bearings while only the leaves can be chosen. Each label carries its
 * own path as well, so the chosen family still reads in full once the list has closed.
 *
 * `keepId` stays selectable whatever the rest of the rule says. An item already filed under a
 * family that has since been given children must go on showing it: greying it out would blank the
 * field on the next save and write that blank back as a real change.
 */
export function familyOptions(
  families: ItemFamilyLookupDto[],
  options?: { leavesSelectableOnly?: boolean; keepId?: number | null },
): PickerOption[] {
  const ordered = orderAsTree(families)
  // Every family that was loaded, so a label can climb from a leaf to its root.
  const byId = new Map(families.map((family) => [family.id, family]))

  if (options?.leavesSelectableOnly !== true) {
    return ordered.map((family) => toFamilyOption(family, byId, false))
  }

  // Judged on the families in hand. The lookup carries the active ones, so a family whose children
  // are all deactivated reads as a leaf - which is right: they are not on offer either.
  const parents = new Set<number>()
  for (const family of families) {
    if (family.parentId !== null) parents.add(family.parentId)
  }

  return ordered.map((family) =>
    toFamilyOption(family, byId, parents.has(family.id) && family.id !== options.keepId),
  )
}

function toFamilyOption(
  family: ItemFamilyLookupDto,
  byId: Map<number, ItemFamilyLookupDto>,
  disabled: boolean,
): PickerOption {
  return { value: String(family.id), label: familyOptionLabel(family, byId), disabled }
}

/**
 * Warehouses grouped under the branch they stand in.
 *
 * The same idea as the family tree, with the depth fixed at two: a warehouse has no parent
 * warehouse, so its branch is the only thing above it. The branch is a Select group heading, which
 * Mantine already draws unselectable - the parent is shown, the leaf is chosen - and it answers the
 * question a flat list of codes could not, which is which site a warehouse actually belongs to.
 */
export function warehouseOptions(warehouses: WarehouseLookupDto[]): PickerGroup[] {
  const byBranch = new Map<string, WarehouseLookupDto[]>()
  for (const warehouse of warehouses) {
    const heading = `${warehouse.branchCode} - ${warehouse.branchName}`
    const siblings = byBranch.get(heading)
    if (siblings) siblings.push(warehouse)
    else byBranch.set(heading, [warehouse])
  }

  return [...byBranch.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([group, items]) => ({
      group,
      items: items
        .sort((a, b) => a.warehouseCode.localeCompare(b.warehouseCode, undefined, { numeric: true }))
        .map((warehouse) => ({ value: String(warehouse.id), label: warehouseLabel(warehouse) })),
    }))
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
