import type { PurchaseDocumentStatus, PurchaseDocumentTypeCode } from '../../api/purchase/documents'
import { PERMISSIONS } from '../../navigation'

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

  /** Blue for orders, green for invoices (stock in), orange for returns (stock out). */
  colour: string

  /** What posting DOES, said in the confirmation and in the posted banner. */
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
  postConfirm: () => 'Confirm this purchase order? The number is assigned and the ordered quantities count as incoming stock until they are invoiced or the order is closed.',
  postedBanner: 'The order is open: its quantities count as incoming stock, and a purchase invoice can be created from it.',
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
  postConfirm: (warehouseName) => `Post this purchase invoice? Stock will be added to ${warehouseName}, the item costs updated and the number assigned.`,
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

export function purchaseKindOf(code: PurchaseDocumentTypeCode | string | null | undefined): PurchaseKind | undefined {
  return PURCHASE_KINDS.find((k) => k.code === code)
}

/** Draft grey, Posted green, Cancelled red — and Closed teal: finished, not undone. */
export const PURCHASE_STATUS_COLOURS: Record<PurchaseDocumentStatus, string> = {
  Draft: 'gray',
  Posted: 'green',
  Cancelled: 'red',
  Closed: 'teal',
}

export const PURCHASE_STATUSES: readonly PurchaseDocumentStatus[] = ['Draft', 'Posted', 'Cancelled', 'Closed']

/** "SUP-0001 - TVS Motor Company" — code first, so a typed code finds the supplier at once. */
export function supplierLabel(party: { partyCode: string; partyName: string }): string {
  return `${party.partyCode} - ${party.partyName}`
}

/** "CDF - Congolese Franc" */
export function currencyLabel(currency: { currencyCode: string; currencyName: string }): string {
  return `${currency.currencyCode} - ${currency.currencyName}`
}
