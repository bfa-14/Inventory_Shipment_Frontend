import type { DocumentTypeDto } from '../../api/inventory/stockDocuments'

/**
 * WHAT A DOCUMENT TYPE DOES (script 79): three switches of Configuration › Document Types, each meaningful on ONE
 * type only. The page, its form and the grid's filter text all read them from here, so a switch is described in
 * the same words wherever it shows.
 *
 *   PINV  affectsItemCost       the invoice's price becomes the cost of the goods received against it
 *   PINV  affectsOnHand         posting the invoice also receives its goods, with a goods receipt
 *   GRN   autoCreateOnDelivery  completing a Delivery movement drafts a goods receipt per container
 *
 * A supplier invoice captures its two when it is posted: changing them never changes an invoice already posted.
 */
export const INVOICE_TYPE = 'PINV'
export const GOODS_RECEIPT_TYPE = 'GRN'

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
} as const

/** Said once under the invoice switches: the value is captured per invoice. */
export const CAPTURED_NOTE = 'Each invoice keeps the values it was posted with: changing them applies to invoices posted from now on.'

/**
 * The Stock column. A supplier invoice moves no stock of its own since goods receipts (its StockDirection is kept for
 * the invoices posted before them): it says so, or that its posting receives the goods through a goods receipt.
 */
export function stockText(t: DocumentTypeDto): string {
  if (t.code === INVOICE_TYPE) return t.affectsOnHand ? 'In, through a goods receipt at posting' : 'None (goods receipts)'
  return t.stockDirection > 0 ? 'In' : t.stockDirection < 0 ? 'Out' : 'None'
}

export function stockColour(t: DocumentTypeDto): string {
  if (t.code === INVOICE_TYPE) return t.affectsOnHand ? 'green' : 'gray'
  return t.stockDirection > 0 ? 'green' : t.stockDirection < 0 ? 'orange' : 'gray'
}

/** The read-only line of the form, in a sentence. */
export function stockSentence(t: DocumentTypeDto): string {
  if (t.code === INVOICE_TYPE)
    return t.affectsOnHand
      ? 'Its goods enter with a goods receipt made when it is posted (Affects on-hand below).'
      : 'No stock effect: its goods enter with goods receipts (GRN). Invoices posted before goods receipts kept their stock.'
  return t.stockDirection > 0 ? 'Adds stock (In)' : t.stockDirection < 0 ? 'Removes stock (Out)' : 'No stock effect'
}

/** The Effects column: the switches of the type, in short words; "-" on the types they do not concern. */
export function effectsText(t: DocumentTypeDto): string {
  if (t.code === INVOICE_TYPE)
    return `Item cost: ${t.affectsItemCost ? 'yes' : 'no'} · Receives on posting: ${t.affectsOnHand ? 'yes' : 'no'}`
  if (t.code === GOODS_RECEIPT_TYPE) return `On Delivery: ${t.autoCreateOnDelivery ? 'automatic' : 'by hand'}`
  return '-'
}
