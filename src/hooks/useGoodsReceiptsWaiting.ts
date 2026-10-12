import { useEffect, useSyncExternalStore } from 'react'
import { goodsReceiptsApi } from '../api/purchase/goodsReceipts'
import { useAuth } from '../auth/useAuth'
import { PERMISSIONS } from '../navigation'

/**
 * How many draft goods receipts wait to be posted: the red count beside Purchase › Goods Receipts.
 *
 * THE GOODS ARE NOT IN STOCK UNTIL THE RECEIPT IS POSTED, and a Delivery completed on the road creates the drafts
 * without anybody in the warehouse being told. The count is how the warehouse finds out, so it is live: refreshed
 * every minute and whenever the window gets the focus back, the way the approvals count is (useApprovalsMe).
 *
 * ONE READING FOR THE WHOLE APPLICATION, one timer however many readers are mounted. Anything that creates, posts or
 * deletes a draft calls refreshGoodsReceiptsWaiting(), so the count moves at once rather than at the next minute.
 *
 * ONLY FOR A READER WHO MAY SEE GOODS RECEIPTS: without the view permission nothing is asked and the count is 0. The
 * answer belongs to one user and is dropped when another one signs in.
 */
const REFRESH_MS = 60_000

let current: number | null = null
let currentUserId: number | null = null
/** The signed-in reader may see goods receipts; nothing is asked otherwise. */
let allowed = false
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()
let timer: number | null = null

function publish(count: number | null) {
  current = count
  listeners.forEach((listener) => listener())
}

function load(): Promise<void> {
  if (currentUserId === null || !allowed) return Promise.resolve()
  const forUser = currentUserId
  inflight ??= goodsReceiptsApi
    .waiting()
    // Another sign-in while the request was out: the answer is not theirs.
    .then((count) => void (forUser === currentUserId && publish(count)))
    // Keeps what was there: the count is a convenience and the next minute tries again.
    .catch(() => {})
    .finally(() => {
      inflight = null
    })
  return inflight
}

const onFocus = () => void load()

/** The first reader starts the minute timer and the focus listener, the last one stops them. */
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    timer = window.setInterval(() => void load(), REFRESH_MS)
    window.addEventListener('focus', onFocus)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    if (timer !== null) window.clearInterval(timer)
    timer = null
    window.removeEventListener('focus', onFocus)
  }
}

const snapshot = () => current

/** Re-reads the count now: after a receipt is created, posted, deleted or cancelled. */
export function refreshGoodsReceiptsWaiting(): Promise<void> {
  return load()
}

/** The drafts waiting to be posted; 0 while unknown and for a reader without the view permission. */
export function useGoodsReceiptsWaiting(): number {
  const { status, user, hasPermission } = useAuth()
  const userId = status === 'authenticated' ? (user?.id ?? null) : null
  const canView = userId !== null && hasPermission(PERMISSIONS.goodsReceiptsView)
  const count = useSyncExternalStore(subscribe, snapshot)

  useEffect(() => {
    if (userId === null) return
    allowed = canView
    if (userId !== currentUserId) {
      currentUserId = userId
      publish(null)
    }
    if (canView) void load()
  }, [userId, canView])

  // Until the effect above has adopted this user, what the store holds is somebody else's.
  return canView && userId === currentUserId ? (count ?? 0) : 0
}
