import type { DocumentTypeDto } from '../../api/inventory/stockDocuments'

/**
 * WHAT A DOCUMENT TYPE DOES (script 79): the switches of Configuration › Document Types, each meaningful on ONE
 * type only. The page, its form and the grid's filter text all read them from here, so a switch is described in
 * the same words wherever it shows.
 *
 *   PINV  affectsItemCost       the invoice's price becomes the cost of the goods received against it
 *   PINV  affectsOnHand         posting the invoice also receives its goods, with a goods receipt
 *   GRN   autoCreateOnDelivery  completing a Delivery movement drafts a goods receipt per container
 *   TRO   needsApproval         (90) a transfer order is approved before it is released
 *
 * A supplier invoice captures its two when it is posted: changing them never changes an invoice already posted.
 * Turning the transfer switch never changes an order already waiting or released.
 */
export const INVOICE_TYPE = 'PINV'
export const GOODS_RECEIPT_TYPE = 'GRN'
/** (90) The transfer order, its dispatch and its receipt: one stock direction each would be a lie (two legs each). */
export const TRANSFER_ORDER_TYPE = 'TRO'
export const TRANSFER_DISPATCH_TYPE = 'TRD'
export const TRANSFER_RECEIPT_TYPE = 'TRR'

/** The form's switches: label and the one-line description under it. */
export const EFFECT_TEXT = {
  affectsItemCost: {
    label: 'Affects item cost',
    description:
      "On: the invoice's price and its own charges become the cost of the goods received against it. Off: those goods keep the order price (and their container's charges); landed cost adjustments are refused on it.",
  },
  affectsOnHand: {
    label: 'Affects on-hand (receive the goods when posted)',
    description:
      'On: posting an invoice also receives its goods, with a goods receipt created and posted at once (lines travelling in containers are received with their containers). Off: goods are received with Receive goods… apart.',
  },
  autoCreateOnDelivery: {
    label: 'Create goods receipts when a Delivery is completed',
    description:
      'On: completing a Delivery movement creates a draft goods receipt for each container. Off: goods receipts are made by hand with Receive goods… on each container.',
  },
  needsApproval: {
    label: 'Needs approval before release',
    description:
      'On: a transfer order is sent for approval and released when a user holding Approve Transfer Orders approves it (an approver may approve and release at once). Off: Release releases it; orders already waiting stay waiting.',
  },
} as const

/** Said once under the invoice switches: the value is captured per invoice. */
export const CAPTURED_NOTE = 'Each invoice keeps the values it was posted with: changing them applies to invoices posted from now on.'

/**
 * The Stock column. A supplier invoice moves no stock of its own since goods receipts (its StockDirection is kept for
 * the invoices posted before them): it says so, or that its posting receives the goods through a goods receipt.
 *
 * (90) A TRANSFER'S TYPES ARE STORED WITH DIRECTION 0 - a dispatch and a receipt each write two legs, which no one
 * direction describes - so their words are their own: the order moves nothing, the dispatch and the receipt move the
 * goods through the destination branch's On the way warehouse.
 */
export function stockText(t: DocumentTypeDto): string {
  if (t.code === INVOICE_TYPE) return t.affectsOnHand ? 'In, through a goods receipt at posting' : 'None (goods receipts)'
  if (t.code === TRANSFER_ORDER_TYPE) return 'None (an order)'
  if (t.code === TRANSFER_DISPATCH_TYPE) return 'Out of the source, onto On the way'
  if (t.code === TRANSFER_RECEIPT_TYPE) return 'From On the way into the destination'
  return t.stockDirection > 0 ? 'In' : t.stockDirection < 0 ? 'Out' : 'None'
}

export function stockColour(t: DocumentTypeDto): string {
  if (t.code === INVOICE_TYPE) return t.affectsOnHand ? 'green' : 'gray'
  // A transfer moves stock between two warehouses: the company holds as much before as after.
  if (t.code === TRANSFER_DISPATCH_TYPE || t.code === TRANSFER_RECEIPT_TYPE) return 'blue'
  return t.stockDirection > 0 ? 'green' : t.stockDirection < 0 ? 'orange' : 'gray'
}

/** The read-only line of the form, in a sentence. */
export function stockSentence(t: DocumentTypeDto): string {
  if (t.code === INVOICE_TYPE)
    return t.affectsOnHand
      ? 'Its goods enter with a goods receipt made when it is posted (Affects on-hand below).'
      : 'No stock effect: its goods enter with goods receipts (GRN). Invoices posted before goods receipts kept their stock.'
  if (t.code === TRANSFER_ORDER_TYPE)
    return 'No stock effect: an order. Its dispatches (TRD) and receipts (TRR) move the goods.'
  if (t.code === TRANSFER_DISPATCH_TYPE)
    return 'Takes the goods out of the source warehouse, onto the On the way warehouse of the destination branch.'
  if (t.code === TRANSFER_RECEIPT_TYPE) return 'Takes the goods from On the way into the destination warehouse.'
  return t.stockDirection > 0 ? 'Adds stock (In)' : t.stockDirection < 0 ? 'Removes stock (Out)' : 'No stock effect'
}

/** The Effects column: the switches of the type, in short words; "-" on the types they do not concern. */
export function effectsText(t: DocumentTypeDto): string {
  if (t.code === INVOICE_TYPE)
    return `Item cost: ${t.affectsItemCost ? 'yes' : 'no'} · Receives on posting: ${t.affectsOnHand ? 'yes' : 'no'}`
  if (t.code === GOODS_RECEIPT_TYPE) return `On Delivery: ${t.autoCreateOnDelivery ? 'automatic' : 'by hand'}`
  if (t.code === TRANSFER_ORDER_TYPE) return `Approval: ${t.needsApproval ? 'yes' : 'no'}`
  return '-'
}
