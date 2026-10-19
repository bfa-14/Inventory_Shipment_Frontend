import { itemsApi } from '../../api/inventory/items'

/**
 * PREVIOUS / NEXT ON AN ITEM FOLLOW THE LIST THE READER CAME FROM.
 *
 * The Items list remembers its rows - filtered and sorted exactly as on screen - in sessionStorage, so the item page
 * can step through them without the list being mounted. sessionStorage, not memory: it survives a reload of the item
 * page and stays with the browser tab, so two tabs on two different lists do not mix. Inactive rows are kept in the
 * order (an inactive item opened from the list still has its place) but are never stepped onto.
 *
 * An item opened without the list (a link, a document, a reload in a new tab), or one the list does not hold, steps
 * through every active item by code instead: its neighbours are the nearest codes on either side.
 */
export interface ItemSequenceEntry {
  id: number
  itemCode: string
  isActive: boolean
}

export interface ItemNeighbours {
  previous: ItemSequenceEntry | null
  next: ItemSequenceEntry | null
}

const STORE_KEY = 'inventory.items.sequence'

/** Called by the Items list whenever the rows on screen change. */
export function saveItemSequence(entries: ItemSequenceEntry[]): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(entries))
  } catch {
    // Storage full or blocked: the item page falls back to every active item by code.
  }
}

export function readItemSequence(): ItemSequenceEntry[] | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter(
      (e): e is ItemSequenceEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as ItemSequenceEntry).id === 'number' &&
        typeof (e as ItemSequenceEntry).itemCode === 'string' &&
        typeof (e as ItemSequenceEntry).isActive === 'boolean',
    )
  } catch {
    return null
  }
}

/** Keeps the remembered list true after the item page changes one item (status) or removes it (delete). */
export function updateItemInSequence(id: number, change: { isActive: boolean } | 'removed'): void {
  const entries = readItemSequence()
  if (!entries) return
  saveItemSequence(
    change === 'removed'
      ? entries.filter((e) => e.id !== id)
      : entries.map((e) => (e.id === id ? { ...e, isActive: change.isActive } : e)),
  )
}

/** The active items either side of `id` in `entries`; null when `id` is not in the list. */
export function neighboursIn(entries: ItemSequenceEntry[], id: number): ItemNeighbours | null {
  const index = entries.findIndex((e) => e.id === id)
  if (index < 0) return null
  return {
    previous: entries.slice(0, index).findLast((e) => e.isActive) ?? null,
    next: entries.slice(index + 1).find((e) => e.isActive) ?? null,
  }
}

const byCode = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/**
 * The fallback: every active item, by code. `itemCode` places an item that is not in that list (inactive, or deleted
 * while open) between its nearest neighbours.
 */
export async function activeNeighboursByCode(id: number, itemCode: string, signal?: AbortSignal): Promise<ItemNeighbours> {
  // The dropdown lookup: every active item in one light call.
  const active = await itemsApi.lookup(true, undefined, signal)
  const entries: ItemSequenceEntry[] = active
    .filter((i) => i.isActive)
    .map((i) => ({ id: i.id, itemCode: i.itemCode, isActive: true }))
    .sort((a, b) => byCode(a.itemCode, b.itemCode))

  const own = neighboursIn(entries, id)
  if (own) return own

  const after = entries.findIndex((e) => byCode(e.itemCode, itemCode) > 0)
  return after < 0
    ? { previous: entries.at(-1) ?? null, next: null }
    : { previous: entries[after - 1] ?? null, next: entries[after] ?? null }
}
