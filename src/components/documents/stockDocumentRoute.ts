import { PERMISSIONS } from '../../navigation'
import { routes } from '../../routes'

/** What a stock movement says of its document: the ledger's type code and id, and a transfer's order (scripts 90, 103). */
export interface StockDocumentRef {
  documentTypeCode: string | null
  documentId: number
  transferOrderId?: number | null
}

/**
 * Where a movement's document opens, for a reader who may view that kind of document. A type without a page of its
 * own - or one the reader may not open (the statement needs only the item's view) - shows its number only, as the
 * source link beside it does: a link must never lead to the Forbidden page.
 */
export function stockDocumentRoute(m: StockDocumentRef, can: (permission: string) => boolean): string | null {
  const gated = (permission: string, route: string) => (can(permission) ? route : null)
  switch (m.documentTypeCode) {
    case 'INV_IN': return gated(PERMISSIONS.stockInView, `/inventory/stock-in/${m.documentId}`)
    case 'INV_OUT': return gated(PERMISSIONS.stockOutView, `/inventory/stock-out/${m.documentId}`)
    case 'BIV_OUT': return gated(PERMISSIONS.bivacOutView, `/inventory/bivac-out/${m.documentId}`)
    case 'SINV': return gated(PERMISSIONS.invoicesView, `/sales/invoices/${m.documentId}`)
    case 'PO': return gated(PERMISSIONS.purchaseOrdersView, `/purchase/orders/${m.documentId}`)
    case 'PINV': return gated(PERMISSIONS.purchaseInvoicesView, `/purchase/invoices/${m.documentId}`)
    case 'PRET': return gated(PERMISSIONS.purchaseReturnsView, `/purchase/returns/${m.documentId}`)
    // goods receipts (scripts 64-65): the goods enter the stock with the receipt, whatever brought them
    case 'GRN': return gated(PERMISSIONS.goodsReceiptsView, routes.goodsReceipt(m.documentId))
    // container offloading (before goods receipts) received the goods against the container
    case 'CNT': return gated(PERMISSIONS.containersView, `/logistics/containers/${m.documentId}`)
    // (90) a transfer's dispatch or receipt lives on its order: the row's id is the posting's, the order is named apart
    case 'TRD':
    case 'TRR':
      return m.transferOrderId ? gated(PERMISSIONS.transfersView, routes.transferOrder(m.transferOrderId)) : null
    default: return null
  }
}
