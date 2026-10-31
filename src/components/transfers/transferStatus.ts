import type {
  TransferDisplayStatus,
  TransferOrderStatus,
  TransferPostingKind,
  TransferPostingStatus,
  TransferStatusFilter,
} from '../../api/inventory/transfers'
import { formatNumber } from '../format'

/**
 * WHAT A TRANSFER ORDER SHOWS, in one place (rule T7): the words and the colour of each status, the Late and lost
 * badges, and how a posting reads.
 *
 * STORED IS NOT SHOWN. The order stores Draft, Waiting for approval, Released or Cancelled; once released it shows
 * how far its dispatches and receipts went - Released, Partly dispatched, Dispatched, Partly received, Closed,
 * Received - the first that applies. The server works it out (fn_TransferOrder_State) and sends it as
 * `displayStatus`; transferDisplayStatus below is the same rule, for the rare screen holding counters and no answer.
 */

export interface TransferStatusStyle {
  value: TransferDisplayStatus
  label: string
  colour: string
}

/** In lifecycle order: the list's Status filter offers them so (then "Open"). */
export const TRANSFER_STATUSES: readonly TransferStatusStyle[] = [
  { value: 'Draft', label: 'Draft', colour: 'gray' },
  { value: 'PendingApproval', label: 'Waiting for approval', colour: 'yellow' },
  { value: 'Released', label: 'Released', colour: 'blue' },
  { value: 'PartlyDispatched', label: 'Partly dispatched', colour: 'orange' },
  { value: 'Dispatched', label: 'Dispatched', colour: 'indigo' },
  { value: 'PartlyReceived', label: 'Partly received', colour: 'orange' },
  { value: 'Received', label: 'Received', colour: 'green' },
  { value: 'Closed', label: 'Closed', colour: 'teal' },
  { value: 'Cancelled', label: 'Cancelled', colour: 'red' },
]

/** The list's Status filter: every shown status, then Open (released, neither Received nor Closed). */
export const TRANSFER_STATUS_FILTER_OPTIONS: readonly { value: TransferStatusFilter; label: string }[] = [
  ...TRANSFER_STATUSES.map(({ value, label }) => ({ value, label })),
  { value: 'Open', label: 'Open' },
]

export function transferStatusLabel(status: TransferDisplayStatus | TransferOrderStatus): string {
  return TRANSFER_STATUSES.find((s) => s.value === status)?.label ?? String(status)
}

export function transferStatusColour(status: TransferDisplayStatus | TransferOrderStatus): string {
  return TRANSFER_STATUSES.find((s) => s.value === status)?.colour ?? 'gray'
}

/** The order's figures the shown status is read from, in pcs. */
export interface TransferCounters {
  orderedBase: number
  dispatchedBase: number
  receivedBase: number
  lostBase: number
  notSentBase: number
}

/**
 * The shown status of an order from its stored status and counters - the rule of fn_TransferOrder_State, word for
 * word. `notSent` is the "Nothing more will be sent" stamp (not the Not sent pieces: a dispatch reversed after the
 * stamp adds to them).
 */
export function transferDisplayStatus(
  status: TransferOrderStatus,
  counters: TransferCounters,
  notSent: boolean,
): TransferDisplayStatus {
  if (status !== 'Released') return status
  const toDispatch = Math.max(0, counters.orderedBase - counters.dispatchedBase - counters.notSentBase)
  const onTheWay = counters.dispatchedBase - counters.receivedBase - counters.lostBase
  if (counters.dispatchedBase === 0 && counters.notSentBase === 0) return 'Released'
  if (toDispatch > 0 && !notSent) return 'PartlyDispatched'
  if (onTheWay > 0 && counters.receivedBase === 0 && counters.lostBase === 0) return 'Dispatched'
  if (onTheWay > 0) return 'PartlyReceived'
  if (counters.notSentBase > 0) return 'Closed'
  return 'Received'
}

/** Released and still moving: neither Received nor Closed (the "Open" filter). */
export function isOpenTransfer(status: TransferDisplayStatus): boolean {
  return status === 'Released' || status === 'PartlyDispatched' || status === 'Dispatched' || status === 'PartlyReceived'
}

/** Received or Closed: nothing will move any more (only the notes and the documents change, rule T9). */
export function isFinishedTransfer(status: TransferDisplayStatus): boolean {
  return status === 'Received' || status === 'Closed'
}

/**
 * The red FILLED badge beside the status (rule T27): something to dispatch after the Expected arrival, or a dispatch
 * with pieces on the way after its ETA. Never "Overdue".
 */
export const LATE_BADGE = { label: 'Late', colour: 'red', variant: 'filled' } as const

/** The orange badge of an order that wrote pieces off ("1 lost"); none at 0. */
export const LOST_BADGE_COLOUR = 'orange'

export function lostBadgeLabel(lostBase: number): string | null {
  return lostBase > 0 ? `${formatNumber(lostBase)} lost` : null
}

export const TRANSFER_POSTING_STATUSES: Readonly<Record<TransferPostingStatus, { label: string; colour: string }>> = {
  Posted: { label: 'Posted', colour: 'green' },
  // Undone, not wrong: orange, as every reversal in the application.
  Reversed: { label: 'Reversed', colour: 'orange' },
}

export function postingStatusLabel(status: TransferPostingStatus): string {
  return TRANSFER_POSTING_STATUSES[status]?.label ?? String(status)
}

export function postingStatusColour(status: TransferPostingStatus): string {
  return TRANSFER_POSTING_STATUSES[status]?.colour ?? 'gray'
}

export function postingKindLabel(kind: TransferPostingKind): string {
  return kind === 'Dispatch' ? 'Dispatch' : 'Receipt'
}
