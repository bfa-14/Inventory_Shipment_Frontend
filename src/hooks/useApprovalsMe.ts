import { useEffect, useSyncExternalStore } from 'react'
import { approvalsApi, type ApprovalMeDto } from '../api/purchase/approvals'
import { useAuth } from '../auth/useAuth'

/**
 * What purchase approval means for the signed-in user: the rules, their rights, and how many orders
 * wait for them (the menu badge).
 *
 * ONE READING FOR THE WHOLE APPLICATION, refreshed every minute and whenever the window gets the
 * focus back — the sidebar, the Spotlight and the order page all show the same answer, and only one
 * timer runs however many of them are mounted. An approval decided anywhere calls
 * refreshApprovalsMe(), so the badge drops at once rather than at the next minute.
 *
 * THE ANSWER BELONGS TO ONE USER: it is dropped when another one signs in, so the next reader never
 * sees the previous reader's badge, even for the moment the first request takes.
 */
const REFRESH_MS = 60_000

let current: ApprovalMeDto | null = null
let currentUserId: number | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()
let timer: number | null = null

function publish(me: ApprovalMeDto | null) {
  current = me
  listeners.forEach((listener) => listener())
}

function load(): Promise<void> {
  if (currentUserId === null) return Promise.resolve()
  const forUser = currentUserId
  inflight ??= approvalsApi
    .me()
    // A sign-out or a sign-in as someone else while the request was out: the answer is not theirs.
    .then((me) => void (forUser === currentUserId && publish(me)))
    // Keeps what was there: the badge is a convenience and the next minute tries again.
    .catch(() => {})
    .finally(() => {
      inflight = null
    })
  return inflight
}

const onFocus = () => void load()

/** The store's subscription: the first reader starts the minute timer and the focus listener, the last one stops them. */
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

/** Re-reads the answer now: after an approval, a rejection, a request — anything that moves the badge. */
export function refreshApprovalsMe(): Promise<void> {
  return load()
}

export function useApprovalsMe(): ApprovalMeDto | null {
  const { status, user } = useAuth()
  const userId = status === 'authenticated' ? (user?.id ?? null) : null
  const me = useSyncExternalStore(subscribe, snapshot)

  useEffect(() => {
    if (userId === null) return
    if (userId !== currentUserId) {
      currentUserId = userId
      publish(null)
    }
    // Every reader that appears asks once: opening a page shows the count as it is now.
    void load()
  }, [userId])

  // Until the effect above has adopted this user, what the store holds is somebody else's.
  return userId !== null && userId === currentUserId ? me : null
}
