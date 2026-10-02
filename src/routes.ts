import type { PurchaseDocumentTypeCode } from './api/purchase/documents'

/**
 * Where a record is opened. EVERY LINK TO A PURCHASE DOCUMENT IS BUILT HERE — the lists, the
 * containers, the tracking board, the shortages, the linked documents — so there is one URL per
 * document and nowhere else to drift. The document page decides everything from the document it
 * loads (its type, status, containers) and the reader's permissions; a URL whose type does not match
 * the document is redirected to the one built here.
 */
const PURCHASE_LISTS: Record<PurchaseDocumentTypeCode, string> = {
  PO: '/purchase/orders',
  PINV: '/purchase/invoices',
  PRET: '/purchase/returns',
}

export const routes = {
  purchaseOrders: PURCHASE_LISTS.PO,
  purchaseOrder: (id: number) => `${PURCHASE_LISTS.PO}/${id}`,
  purchaseInvoice: (id: number) => `${PURCHASE_LISTS.PINV}/${id}`,
  purchaseReturn: (id: number) => `${PURCHASE_LISTS.PRET}/${id}`,

  /** A purchase document of a type known only at run time (a linked document, a source). */
  purchaseDocument: (typeCode: PurchaseDocumentTypeCode | string, id: number) =>
    `${PURCHASE_LISTS[typeCode as PurchaseDocumentTypeCode] ?? PURCHASE_LISTS.PO}/${id}`,
}
