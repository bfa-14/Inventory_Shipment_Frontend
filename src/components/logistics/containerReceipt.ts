import type { ContainerReceiptRef } from '../../api/logistics/containers'
import { toGoodsReceiptStatus, type GoodsReceiptStatusCode, type MovementReceiptResultDto } from '../../api/purchase/goodsReceipts'
import { dateLabel } from '../documents/documentKind'

/**
 * A container's goods receipt as the logistics pages talk about it (scripts 64-65): the container page, the containers
 * list, the movement page and its containers card.
 *
 * NOT IN A COMPONENT FILE, because of Fast Refresh: a module exporting a component and a plain value loses hot
 * reloading for the component.
 */

/** The open receipt of a container: a draft or a posted one. A cancelled receipt is no receipt: it can be made again. */
export interface ContainerReceipt {
  id: number
  /** Null on a draft. */
  number: string | null
  status: GoodsReceiptStatusCode
}

/** The receipt the API names on a container (or a movement's container), or null when it has none open. */
export function containerReceiptOf(ref: ContainerReceiptRef | null | undefined): ContainerReceipt | null {
  if (!ref || ref.goodsReceiptId === null || ref.goodsReceiptId === undefined) return null
  const status = toGoodsReceiptStatus(ref.goodsReceiptStatus)
  if (status === 3) return null
  return { id: ref.goodsReceiptId, number: ref.goodsReceiptNumber ?? null, status }
}

/** The containers a goods receipt can be made for (rule 6): Confirmed, In Transit, At Port, Cleared. */
export const RECEIVABLE_STATUSES: readonly number[] = [2, 3, 4, 5]

/** "Receive goods…" on a draft container. */
export const CONFIRM_FIRST = 'Confirm the container first.'

/** Under the container's "Warehouse (offloading destination)" and the Auto-plan's "Offloading warehouse". */
export const WAREHOUSE_PROPOSED_HINT = 'The goods receipt proposes this warehouse.'

/**
 * The blue Alert of a container whose receipt is a draft. The date is the draft's; without it (a reader who cannot read
 * goods receipts) the sentence goes without.
 */
export function draftReceiptAlert(createdOn: string | null): string {
  const created = createdOn ? `Goods receipt draft created on ${dateLabel(createdOn)}.` : 'Goods receipt draft created.'
  return `${created} The goods are not in stock until it is posted. Changing the container's warehouse does not change the draft.`
}

/**
 * Why a container with a goods receipt cannot be cancelled (69019, the server's sentence): the tooltip of its disabled
 * Cancel, on the container page and the containers list.
 */
export function receiptBlocksCancelText(containerRef: string, receipt: ContainerReceipt): string {
  return `Container ${containerRef} has ${receipt.number ? `goods receipt ${receipt.number}` : 'a draft goods receipt'}. Delete the draft (or cancel the receipt) first.`
}

/**
 * The green banner of a container received by a goods receipt (it replaces "Offloaded into …"). The number is a link on
 * the page, so the sentence is given in its two halves around it.
 */
export function receivedBanner(warehouse: string, date: string, user: string, closed: boolean): { before: string; after: string } {
  return {
    before: 'Received by ',
    after: ` into ${warehouse} on ${date} by ${user}. The container is read-only${closed ? ' and closed' : ''}.`,
  }
}

/* ── the Complete of a Delivery movement ─────────────────────────────────────────────────────────── */

/** What completing a Delivery adds to the Complete dialog (rule 5). */
export const DELIVERY_COMPLETE_TEXT =
  'The containers arrive at the warehouse: a draft goods receipt is created for each of them. The stock changes only when the warehouse posts it.'

/**
 * (79) The goods receipt type makes them by hand (Configuration › Document Types): the Complete dialog says this instead
 * of the per-container preview, and the API answers the completion with the same sentence.
 */
export const DELIVERY_BY_HAND_TEXT = 'Goods receipts are made by hand: use Receive goods… on each container.'

/** What the completion will do for one container of the movement, as the dialog lists it. */
export interface DeliveryPreviewInput {
  containerRef: string
  status: number
  receipt: ContainerReceipt | null
  warehouseCode: string | null | undefined
  warehouseInBranch: boolean | null | undefined
  /** Why the container's warehouse will not be taken, from the server ("LUB, the container's, has warehouses under it"). */
  warehouseNote?: string | null
}

/**
 * "KTG-2026-0031 → draft goods receipt into LUB-WH", "KTG-2026-0032 → draft, warehouse to choose (LUB, the container's,
 * has warehouses under it)", "KTG-2026-0033 → no receipt: it already has GRN-BR-002-000004". The server decides at the
 * completion; this is what the page can see now.
 */
export function deliveryPreviewLine(c: DeliveryPreviewInput): { text: string; created: boolean } {
  if (c.receipt) {
    return {
      text: `${c.containerRef} → no receipt: it already has ${c.receipt.number ?? 'a draft goods receipt'}`,
      created: false,
    }
  }
  if (c.status === 1) return { text: `${c.containerRef} → no receipt: it is not confirmed`, created: false }
  if (c.status === 6 || c.status === 7) return { text: `${c.containerRef} → no receipt: its goods are already received`, created: false }
  if (c.status === 8) return { text: `${c.containerRef} → no receipt: it is cancelled`, created: false }
  if (c.warehouseCode && c.warehouseInBranch !== false) {
    return { text: `${c.containerRef} → draft goods receipt into ${c.warehouseCode}`, created: true }
  }
  return {
    text: `${c.containerRef} → draft, warehouse to choose${c.warehouseNote ? ` (${c.warehouseNote})` : ''}`,
    created: true,
  }
}

/** The start of the database's sentence for a draft created by a Delivery (usp_GoodsReceipt_CreateForMovement). */
const CREATED_PREFIX = 'Draft goods receipt created: '

/**
 * Why a Delivery's draft was created without a warehouse although its container has one (script 72), from the
 * database's sentence: "choose the warehouse (LUB, the container's, has warehouses under it: stock is kept only in the
 * warehouses at the bottom of the tree)". Null for a draft with a warehouse, for the plain "choose the warehouse" (the
 * container has none), for a skipped container and for an older server whose sentence gives no reason.
 */
export function warehouseToChooseReason(result: MovementReceiptResultDto): string | null {
  if (!result.created || result.warehouseCode || !result.message?.startsWith(CREATED_PREFIX)) return null
  const reason = result.message.slice(CREATED_PREFIX.length).trim().replace(/\.+$/, '')
  return reason.includes('(') ? reason : null
}

/**
 * One container the completion gave no draft, for the notification: "KTG-2026-0033 already has GRN-BR-002-000004". The
 * known reasons in the notification's own words; a refusal (Error) or a reason this page does not know in the server's
 * sentence, with the container named in front.
 */
export function notCreatedText(result: MovementReceiptResultDto): string {
  const ref = result.containerRef
  const server = result.message ? (result.message.includes(ref) ? result.message : `${ref}: ${result.message}`) : null
  switch (result.skipReason) {
    case 'HasDraft':
      return `${ref} already has ${result.goodsReceiptNumber ?? 'a draft goods receipt'}`
    case 'Received':
      return result.goodsReceiptNumber ? `${ref} already has ${result.goodsReceiptNumber}` : `${ref} is already received`
    case 'NotConfirmed':
      return `${ref} is not confirmed`
    case 'Cancelled':
      return `${ref} is cancelled`
    case 'NoLines':
      return `${ref} has no loaded lines`
    case 'Error':
      return server ?? `${ref}: the draft could not be created`
    default:
      // 'InactiveItem' ("Item … is inactive: activate it in Item Definition, then use Receive goods… on the container.")
      return server ?? (result.skipReason ? `${ref}: ${result.skipReason}` : ref)
  }
}

/* ── cancelling a completed Delivery ─────────────────────────────────────────────────────────────── */

/** An automatic draft the cancel of a Delivery deletes, and whether someone typed in it since. */
export interface DraftToDelete {
  containerRef: string
  receiptId: number
  editedBy: string | null
  editedAtUtc: string | null
}

/** "GRN draft of KTG-2026-0031 was edited by {user} on {date}: the received quantities and reasons typed there are lost." */
export function editedDraftText(draft: DraftToDelete, when: string): string {
  return `GRN draft of ${draft.containerRef} was edited by ${draft.editedBy ?? 'someone'} on ${when}: the received quantities and reasons typed there are lost.`
}
