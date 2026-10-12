import type { PurchaseDocumentDto, PurchaseDocumentStatus, PurchaseDocumentTypeCode } from '../../api/purchase/documents'
import { PERMISSIONS } from '../../navigation'
import { formatNumber } from '../format'

/**
 * Everything that differs between a purchase order, a purchase invoice and a purchase return.
 *
 * ONE PAGE, THREE DOCUMENTS — the same rule the stock documents follow. The list and the document
 * page take a `kind` and never branch on `'PO'` themselves; what changes is the wording, the accent,
 * the five permissions and what the posting does, and that lives here.
 */
export interface PurchaseKind {
  code: PurchaseDocumentTypeCode

  /** "Purchase Order" — the page title, the New button, the breadcrumb. */
  title: string
  /** "Purchase Orders" — the list title and the menu label. */
  plural: string
  /** "order" — for sentences: "Post this order?", "1 order(s) selected". */
  noun: string

  /** "/purchase/orders" — the list route; the document routes hang off it. */
  route: string

  /** Blue for orders, green for invoices, orange for returns (stock out). */
  colour: string

  /**
   * What posting DOES, said in the confirmation and in the posted banner. A supplier invoice posted since goods receipts
   * moves no stock: its confirmation says so and its banner says how much was received (`invoicePostedBanner`);
   * `postedBanner` is then the text of an old local invoice, posted before (with the hint of `LEGACY_INVOICE_TEXTS`).
   */
  postVerb: string
  postConfirm(warehouseName: string): string
  postedBanner: string

  permissions: {
    view: string
    create: string
    post: string
    cancel: string
    delete: string
  }
}

export const PURCHASE_ORDER: PurchaseKind = {
  code: 'PO',
  title: 'Purchase Order',
  plural: 'Purchase Orders',
  noun: 'order',
  route: '/purchase/orders',
  colour: 'blue',
  postVerb: 'Confirm',
  postConfirm: () => 'Confirm this purchase order? The number is assigned and the ordered quantities count as incoming stock until they are received or the order is closed.',
  postedBanner: 'The order is open: its quantities count as incoming stock, and goods can be received and invoiced against it.',
  permissions: {
    view: PERMISSIONS.purchaseOrdersView,
    create: PERMISSIONS.purchaseOrdersCreate,
    post: PERMISSIONS.purchaseOrdersPost,
    cancel: PERMISSIONS.purchaseOrdersCancel,
    delete: PERMISSIONS.purchaseOrdersDelete,
  },
}

export const PURCHASE_INVOICE: PurchaseKind = {
  code: 'PINV',
  title: 'Purchase Invoice',
  plural: 'Purchase Invoices',
  noun: 'invoice',
  route: '/purchase/invoices',
  colour: 'green',
  postVerb: 'Post',
  postConfirm: () =>
    'Post this purchase invoice? The number is assigned and the amount becomes payable to the supplier. The stock does not change: goods enter with goods receipts.',
  // An old local invoice (posted before goods receipts, not shipped in containers): its posting added the stock.
  postedBanner: 'Stock has been added, the item costs updated, and this invoice can no longer be edited.',
  permissions: {
    view: PERMISSIONS.purchaseInvoicesView,
    create: PERMISSIONS.purchaseInvoicesCreate,
    post: PERMISSIONS.purchaseInvoicesPost,
    cancel: PERMISSIONS.purchaseInvoicesCancel,
    delete: PERMISSIONS.purchaseInvoicesDelete,
  },
}

export const PURCHASE_RETURN: PurchaseKind = {
  code: 'PRET',
  title: 'Purchase Return',
  plural: 'Purchase Returns',
  noun: 'return',
  route: '/purchase/returns',
  colour: 'orange',
  postVerb: 'Post',
  postConfirm: (warehouseName) => `Post this purchase return? Stock will be removed from ${warehouseName} at the invoice cost and the number assigned.`,
  postedBanner: 'Stock has been removed at the invoice cost, and this return can no longer be edited.',
  permissions: {
    view: PERMISSIONS.purchaseReturnsView,
    create: PERMISSIONS.purchaseReturnsCreate,
    post: PERMISSIONS.purchaseReturnsPost,
    cancel: PERMISSIONS.purchaseReturnsCancel,
    delete: PERMISSIONS.purchaseReturnsDelete,
  },
}

export const PURCHASE_KINDS: readonly PurchaseKind[] = [PURCHASE_ORDER, PURCHASE_INVOICE, PURCHASE_RETURN]

/* ── supplier invoices and goods receipts (scripts 64-65) ─────────────────────────────────────── */

/**
 * The posted banner of an invoice posted since goods receipts, after "Posted by {user} on {date}.": how much of it has
 * come in so far. Replaces the old local and "shipped in containers" banners alike.
 */
export function invoicePostedBanner(receivedBase: number, quantityBase: number): string {
  return `Received so far: ${formatNumber(receivedBase)} of ${formatNumber(quantityBase)} pcs.`
}

/**
 * The texts an OLD LOCAL invoice keeps (posted before goods receipts, not "Shipped in containers"): its stock entered
 * when it was posted. An older "Shipped in containers" invoice takes the new texts: its containers may still be
 * travelling, and are then received with goods receipts; only the hint stays on one whose containers were all
 * offloaded the old way (the server's reason).
 */
export const LEGACY_INVOICE_TEXTS = {
  /** The gray hint under its banner, and why "Receive goods…" is disabled on it (the server's exact sentence). */
  hint: 'Posted before goods receipts: its stock entered when it was posted (or when its container was offloaded).',
  /** The subtitle of its Containers card (`ShippedInvoiceContainersCard legacy`). */
  containersCardLocal: 'Received when the invoice was posted: no containers needed.',
  /** The same for an older "Shipped in containers" invoice whose containers were all offloaded before goods receipts. */
  containersCardShipped: 'Shipped in containers: the goods entered the stock when these containers were offloaded.',
} as const

/** True when an amount reads 0.00: a difference of a fraction of a cent changes no cost anyone can see. */
export function isZeroAmount(amount: number): boolean {
  return Math.abs(amount) < 0.005
}

/** The same sentence when the invoice price is what the received goods already cost (a difference of 0.00 on every line). */
export function receiptCostUnchangedText(receivedBase: number): string {
  return `The invoice price equals the cost of the ${formatNumber(receivedBase)} pcs already received: their cost does not change.`
}

/** The post confirmation's sentence about the goods already received, from `receipt-cost-preview` (an estimate). */
export function receiptCostPreviewText(receivedBase: number, amountBase: number, inventoryBase: number, cogsBase: number, currencyCode: string): string {
  if (receivedBase <= 0) return "No goods received yet: their cost will be this invoice's when they arrive."
  const signed = `${amountBase > 0 ? '+' : ''}${formatNumber(amountBase, 2)}`
  return `${formatNumber(receivedBase)} pcs already received will have their cost adjusted by ${signed} ${currencyCode} (estimate: stock ${formatNumber(inventoryBase, 2)}, cost of sales ${formatNumber(cogsBase, 2)}).`
}

/** "Receive the goods now into {warehouse}" - the checkbox of a local invoice's post confirmation (rule 15a). */
export function receiveNowLabel(warehouses: string[]): string {
  return `Receive the goods now into ${warehouses.join(', ')}`
}

/** Why "Receive goods…" cannot be used on this supplier invoice (rule 15); null when it can. */
export function invoiceReceiveReason(invoice: PurchaseDocumentDto): string | null {
  if (invoice.status === 'Draft') return 'Post the invoice first: goods are received against a posted invoice, or from the order.'
  if (invoice.status === 'Cancelled') return 'This invoice is cancelled.'
  // The server's answer first: it knows the draft receipts, and an older "Shipped in containers" invoice whose lines are
  // not all in containers offloaded the old way can still be received.
  if (invoice.canReceive === false) return invoice.receiveBlockedReason ?? 'Every piece of this invoice is already received.'
  if (invoice.canReceive === true) return null
  if (invoice.usesGoodsReceipts !== true && invoice.receiptMode === 1) return LEGACY_INVOICE_TEXTS.hint

  let left = 0
  let outside = 0
  let inContainers = 0
  for (const line of invoice.lines) {
    const rest = Math.max(0, line.quantityBase - line.receivedQuantityBase)
    left += rest
    if (line.containerLineId == null) outside += line.toReceiveBase ?? rest
    else inContainers += rest
  }
  if (left <= 0) return 'Every piece of this invoice is already received.'
  if (outside > 0) return null
  if (inContainers > 0) return "This invoice's goods travel in containers: they are received with their containers."
  return 'The rest is in draft goods receipts: post or delete them first.'
}

export function purchaseKindOf(code: PurchaseDocumentTypeCode | string | null | undefined): PurchaseKind | undefined {
  return PURCHASE_KINDS.find((k) => k.code === code)
}

/** Draft grey, waiting for approval yellow, Posted green, Cancelled red — and Closed teal: finished, not undone. */
export const PURCHASE_STATUS_COLOURS: Record<PurchaseDocumentStatus, string> = {
  Draft: 'gray',
  PendingApproval: 'yellow',
  Posted: 'green',
  Cancelled: 'red',
  Closed: 'teal',
}

export const PURCHASE_STATUSES: readonly PurchaseDocumentStatus[] = ['Draft', 'PendingApproval', 'Posted', 'Cancelled', 'Closed']

/** How a status reads on screen: the API's names, except the one that is two words run together. */
export function purchaseStatusLabel(status: PurchaseDocumentStatus | string): string {
  return status === 'PendingApproval' ? 'Waiting for approval' : status
}

/** "SUP-0001 - TVS Motor Company" — code first, so a typed code finds the supplier at once. */
export function supplierLabel(party: { partyCode: string; partyName: string }): string {
  return `${party.partyCode} - ${party.partyName}`
}

/** "CDF - Congolese Franc" */
export function currencyLabel(currency: { currencyCode: string; currencyName: string }): string {
  return `${currency.currencyCode} - ${currency.currencyName}`
}
