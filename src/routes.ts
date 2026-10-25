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

const GOODS_RECEIPTS = '/purchase/goods-receipts'

const TRANSFER_ORDERS = '/inventory/transfers'

export const routes = {
  purchaseOrders: PURCHASE_LISTS.PO,
  purchaseOrder: (id: number) => `${PURCHASE_LISTS.PO}/${id}`,
  purchaseInvoice: (id: number) => `${PURCHASE_LISTS.PINV}/${id}`,
  purchaseReturn: (id: number) => `${PURCHASE_LISTS.PRET}/${id}`,

  /** A purchase document of a type known only at run time (a linked document, a source). */
  purchaseDocument: (typeCode: PurchaseDocumentTypeCode | string, id: number) =>
    `${PURCHASE_LISTS[typeCode as PurchaseDocumentTypeCode] ?? PURCHASE_LISTS.PO}/${id}`,

  /* GOODS RECEIPTS (GRN): their own family, not a fourth purchase kind - no prices, currency or approval. */
  goodsReceipts: GOODS_RECEIPTS,
  goodsReceipt: (id: number) => `${GOODS_RECEIPTS}/${id}`,
  goodsReceiptPrint: (id: number) => `${GOODS_RECEIPTS}/${id}/print`,
  /** "+ New › Without an order": a receipt typed by hand, for the supplier chosen in the chooser. */
  newGoodsReceipt: (supplierId?: number | null) =>
    `${GOODS_RECEIPTS}/new${supplierId ? `?supplierId=${supplierId}` : ''}`,

  /*
   * TRANSFER ORDERS (script 90): stock moved between two warehouses. Their dispatches and receipts are not pages of
   * their own - they live on the order - except the dispatch note, which is printed (outside the shell, like the goods
   * receipt's count sheet).
   */
  transferOrders: TRANSFER_ORDERS,
  newTransferOrder: `${TRANSFER_ORDERS}/new`,
  transferOrder: (id: number) => `${TRANSFER_ORDERS}/${id}`,
  transferDispatchPrint: (id: number, postingId: number) => `${TRANSFER_ORDERS}/${id}/dispatches/${postingId}/print`,

  container: (id: number) => `/logistics/containers/${id}`,
  movement: (id: number) => `/logistics/movements/${id}`,
}
