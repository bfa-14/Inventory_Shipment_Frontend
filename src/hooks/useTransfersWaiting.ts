import { useEffect, useSyncExternalStore } from 'react'
import { transfersApi } from '../api/inventory/transfers'
import { useAuth } from '../auth/useAuth'
import { PERMISSIONS } from '../navigation'

/**
 * How many transfer orders wait for approval: the red count beside Inventory › Transfer Orders (script 90).
 *
 * AN ORDER SENT FOR APPROVAL IS LOCKED UNTIL SOMEBODY DECIDES, and the approvers are told by email only when the
 * application's address is set. The count is how an approver finds out in the application, so it is live: refreshed
 * every minute and whenever the window gets the focus back, the way the goods receipts count is
 * (useGoodsReceiptsWaiting).
 *
 * ONE READING FOR THE WHOLE APPLICATION, one timer however many readers are mounted. Anything that sends, approves,
 * rejects or withdraws an order calls refreshTransfersWaiting(), so the count moves at once rather than at the next
 * minute.
 *
 * ONLY FOR AN APPROVER OR A RECEIVER: a reader holding Approve Transfer Orders or (92) Receive Transfers (and View,
 * which the route asks for). Nobody else is asked and the count is 0 - the server answers 0 to them anyway. The count is
 * the orders waiting for the reader's approval plus (92) the orders on their way to the reader's own warehouses (the
 * server counts those only for a reader limited to some warehouses: FB section 6's "to receive"). The answer belongs to
 * one user and is dropped when another one signs in.
 */
const REFRESH_MS = 60_000

let current: number | null = null
let currentUserId: number | null = null
/** The signed-in reader approves transfer orders; nothing is asked otherwise. */
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
  inflight ??= transfersApi
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

/** Re-reads the count now: after an order is sent for approval, approved, rejected or withdrawn. */
export function refreshTransfersWaiting(): Promise<void> {
  return load()
}

/**
 * The orders waiting for the reader's approval plus those on the way to their own warehouses; 0 while unknown and for a
 * reader who neither approves nor receives transfer orders.
 */
export function useTransfersWaiting(): number {
  const { status, user, hasPermission } = useAuth()
  const userId = status === 'authenticated' ? (user?.id ?? null) : null
  const canAsk =
    userId !== null &&
    hasPermission(PERMISSIONS.transfersView) &&
    (hasPermission(PERMISSIONS.transfersApprove) || hasPermission(PERMISSIONS.transfersReceive))
  const count = useSyncExternalStore(subscribe, snapshot)

  useEffect(() => {
    if (userId === null) return
    allowed = canAsk
    if (userId !== currentUserId) {
      currentUserId = userId
      publish(null)
    }
    if (canAsk) void load()
  }, [userId, canAsk])

  // Until the effect above has adopted this user, what the store holds is somebody else's.
  return canAsk && userId === currentUserId ? (count ?? 0) : 0
}
