import type { BranchLookupDto, WarehouseLookupDto } from '../api/types'

/*
 * WAREHOUSE ACCESS PER USER (script 92), what the pages need of it.
 *
 * A user has All warehouses (every user until an administrator restricts one) or only the warehouses ticked for them on
 * the Users page (a ticked parent gives its whole tree). It limits MOVING stock - posting, cancelling, reversing,
 * receiving, dispatching, setting stock levels, naming a warehouse on a draft - never VIEWING.
 *
 * "RESTRICTED" IS READ FROM THE LOOKUP, NEVER FROM THE SESSION. The warehouse lookup answers `canUse` for the reader,
 * worked out by the server at each request, so a change an administrator makes shows at the page's next read with no
 * sign-out (W11). The token carries nothing about warehouses. For an unrestricted reader every `canUse` is true and
 * nothing here changes anything.
 *
 * THE SERVER HAS THE LAST WORD. A refusal the page did not foresee (an administrator changed the ticks meanwhile) comes
 * back as 403 WAREHOUSE_ACCESS with the database's sentence, shown as it comes.
 */

/** The reader may not use at least one warehouse (an On the way warehouse is nobody's and does not count). */
export function isWarehouseRestricted(warehouses: WarehouseLookupDto[]): boolean {
  return warehouses.some((w) => !w.isTransit && w.canUse === false)
}

/** The reader may move stock in this warehouse: `canUse` missing (an older API) means yes. */
export function canUseWarehouse(warehouse: WarehouseLookupDto | undefined): boolean {
  return warehouse?.canUse !== false
}

const isUsableLeaf = (w: WarehouseLookupDto) => w.isActive && w.childCount === 0 && !w.isTransit && w.canUse !== false

/**
 * The branch a NEW document starts in (A17). Unrestricted reader: the page's default (`pageDefaultBranchId`, else the
 * main branch, else the first) - as before 92. Restricted: that branch when it holds one of the reader's usable leaves,
 * else the branch of the reader's first usable leaf (its main warehouse first); no usable leaf at all: the page's
 * default (the reader may still prepare a draft; posting it is refused).
 */
export function defaultBranchIdFor(
  branches: BranchLookupDto[],
  warehouses: WarehouseLookupDto[],
  pageDefaultBranchId: number | null = null,
): number | null {
  const fallback = pageDefaultBranchId ?? (branches.find((b) => b.isMainBranch) ?? branches[0])?.id ?? null
  if (!isWarehouseRestricted(warehouses)) return fallback
  const usable = warehouses.filter(isUsableLeaf)
  if (fallback !== null && usable.some((w) => w.branchId === fallback)) return fallback
  const known = new Set(branches.map((b) => b.id))
  const offered = usable.filter((w) => known.size === 0 || known.has(w.branchId))
  const first = offered.find((w) => w.isMainWarehouse) ?? offered[0]
  return first?.branchId ?? fallback
}

/** (92) What a restricted reader with no warehouse to move stock in at all is told on a document they may edit (W14). */
export const NO_USABLE_WAREHOUSE = 'You have no warehouse to move stock in: ask an administrator.'

/**
 * (92) The reader is restricted and none of the warehouses that hold stock (active, at the bottom of the tree, not On the
 * way) is theirs: "Only these warehouses" with none ticked, or ticks on warehouses that are all inactive. Their pickers are
 * empty, so the page says why rather than "No warehouse to choose" alone.
 */
export function hasNoUsableWarehouse(warehouses: WarehouseLookupDto[]): boolean {
  return isWarehouseRestricted(warehouses) && !warehouses.some(isUsableLeaf)
}

/**
 * "A", "A and B", "A, B and C", "A, B, C and 2 more": the codes sorted, as the database's sentence names them
 * (`security.fn_User_WarehouseRefusal`).
 */
export function joinWarehouseCodes(codes: string[]): string {
  const sorted = [...new Set(codes)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (sorted.length <= 1) return sorted[0] ?? ''
  if (sorted.length <= 3) return `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`
  return `${sorted.slice(0, 3).join(', ')} and ${sorted.length - 3} more`
}

/**
 * The refusal of one warehouse, in the database's words, for a button the page disables before the click (a stock
 * level's row). The server repeats it if the click comes anyway.
 */
export function noAccessSentence(warehouseCode: string): string {
  return `You have no access to warehouse ${warehouseCode}: ask an administrator.`
}

/** The same sentence for several warehouses ("warehouses A and B", "… and 2 more"), as the database words it. */
export function noAccessSentenceFor(warehouseCodes: string[]): string {
  const codes = [...new Set(warehouseCodes)]
  if (codes.length <= 1) return noAccessSentence(codes[0] ?? '')
  return `You have no access to warehouses ${joinWarehouseCodes(codes)}: ask an administrator.`
}

/** Save & Post while a current line names a warehouse the reader may not use, and it is not the stored document's. */
export const LINES_NOT_YOURS =
  'Some lines are in a warehouse that is not one of yours (marked - not one of your warehouses): change them, or ask an administrator.'

/**
 * Why Save & Post (Post on a page that saves first) is disabled, or null when it is not (W2, W8).
 *
 * BY THE CURRENT LINES, not the stored ones: moving the last line out of a warehouse the reader may not use enables it
 * at once. The reason is the server's `warehouseAccessRefusal` while the warehouses that block are exactly the stored
 * document's (the sentence names them), else the page's own sentence (the reader added or changed lines since).
 *
 * `currentIds`: every warehouse the form would save (the lines', and the header's where the header has one).
 * `storedIds`: the same on the document as last read; `storedRefusal` its `warehouseAccessRefusal`.
 */
export function postAccessBlockedReason(
  warehouses: WarehouseLookupDto[],
  currentIds: (number | null | undefined)[],
  storedIds: (number | null | undefined)[] = [],
  storedRefusal: string | null | undefined = null,
): string | null {
  const byId = new Map(warehouses.map((w) => [w.id, w]))
  const blockedOf = (ids: (number | null | undefined)[]) =>
    [...new Set(ids.filter((id): id is number => typeof id === 'number'))].filter((id) => byId.get(id)?.canUse === false)
  const blocked = blockedOf(currentIds)
  if (blocked.length === 0) return null
  const storedBlocked = new Set(blockedOf(storedIds))
  const same = storedRefusal && storedBlocked.size === blocked.length && blocked.every((id) => storedBlocked.has(id))
  return same ? storedRefusal : LINES_NOT_YOURS
}

/** The codes of the warehouses among `ids` that the reader may not use (the lookup's `canUse`). */
export function warehouseCodesNotUsable(warehouses: WarehouseLookupDto[], ids: (number | null | undefined)[]): string[] {
  const byId = new Map(warehouses.map((w) => [w.id, w]))
  return [...new Set(ids.filter((id): id is number => typeof id === 'number'))]
    .map((id) => byId.get(id))
    .filter((w): w is WarehouseLookupDto => w !== undefined && w.canUse === false)
    .map((w) => w.warehouseCode)
}
