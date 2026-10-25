import { nextEntryKey, type TrackingEntry } from '../tracking/trackingNumbers.ts'

/*
 * (93) THE DISPATCH DIALOG'S TYPED ROWS, KEPT THROUGH A RELOAD (M13) in the viewer's sessionStorage, under
 * `trf-tracking:{orderId}:{rowVersion}`. Every access is wrapped in try / catch: a private window, a blocked or full
 * storage simply keeps nothing. Apart from transferTracking.ts so that Node's test runner can load it (`npm test`).
 */

const STORE_PREFIX = 'trf-tracking:'

/** A row as kept: its `key` is not - every row read back gets a fresh one (`nextEntryKey`). */
type StoredEntry = Omit<TrackingEntry, 'key'>

interface StoredTracking {
  /** Per order line id, the rows typed (committed with Done, or being typed in a dialog left open). */
  lines: Record<string, StoredEntry[]>
}

export const trackingStoreKey = (orderId: number, rowVersion: string | null) =>
  `${STORE_PREFIX}${orderId}:${rowVersion ?? ''}`

/** The rows kept for this order AS IT IS NOW (its row version): none when the order changed since. Never throws. */
export function readStoredTracking(orderId: number, rowVersion: string | null): Record<number, TrackingEntry[]> | null {
  try {
    // An older version of the order keeps nothing worth restoring: its keys are cleared on the way.
    const own = trackingStoreKey(orderId, rowVersion)
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i)
      if (key && key.startsWith(`${STORE_PREFIX}${orderId}:`) && key !== own) window.sessionStorage.removeItem(key)
    }
    const raw = window.sessionStorage.getItem(own)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredTracking
    const out: Record<number, TrackingEntry[]> = {}
    for (const [lineId, entries] of Object.entries(parsed?.lines ?? {})) {
      if (!Array.isArray(entries) || entries.length === 0) continue
      // A FRESH KEY PER ROW: the keys of the rows typed before the reload would come again from the new page's
      // counter (it starts at 0), and two rows with one key are removed or edited together.
      out[Number(lineId)] = entries.map((e) => ({
        key: nextEntryKey(),
        serialNo: String(e.serialNo ?? ''),
        batchNo: String(e.batchNo ?? ''),
        expiryDate: typeof e.expiryDate === 'string' ? e.expiryDate : null,
        quantity: typeof e.quantity === 'number' ? e.quantity : '',
      }))
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

/** Writes the rows typed (or removes the key when there are none). Never throws: storage may be full or blocked. */
export function writeStoredTracking(
  orderId: number,
  rowVersion: string | null,
  lines: Record<number, TrackingEntry[]>,
): void {
  try {
    const key = trackingStoreKey(orderId, rowVersion)
    const kept = Object.entries(lines)
      .filter(([, entries]) => entries.length > 0)
      .map(([lineId, entries]): [string, StoredEntry[]] => [
        lineId,
        entries.map(({ serialNo, batchNo, expiryDate, quantity }) => ({ serialNo, batchNo, expiryDate, quantity })),
      ])
    if (kept.length === 0) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, JSON.stringify({ lines: Object.fromEntries(kept) } satisfies StoredTracking))
  } catch {
    /* A private window or a full storage: the rows simply do not survive a reload. */
  }
}

/** After a post or Discard: nothing kept for this order. */
export function clearStoredTracking(orderId: number): void {
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i)
      if (key && key.startsWith(`${STORE_PREFIX}${orderId}:`)) window.sessionStorage.removeItem(key)
    }
  } catch {
    /* nothing to clear */
  }
}
