import type { BulkActionItemResult, BulkActionResult, ImportCreateLine, ImportCreateResult } from '../documents'
import { documentFilesApi } from '../documentFiles'
import { fetchBlob, request } from '../http'
import type { SalesRateType } from '../sales/invoices'
import type { PurchaseChargeDto, SetPurchaseChargesRequest } from './landedCostAdjustments'
import type { PagedResult } from '../types'

/**
 * Purchase orders, purchase invoices and purchase returns — one engine behind one route.
 *
 * THE KIND IS A FIELD, NOT A ROUTE: `api/purchase/documents` serves all three and every document
 * says which it is in `documentTypeCode`. The permission the API checks follows that code
 * (purchase.orders.* / purchase.invoices.* / purchase.returns.*), and a 403 names the one missing.
 */
const BASE = '/api/purchase/documents'

/** Copied to every invoice a create makes (one per item). Blank = none. */
export interface InvoiceReferences {
  exporterReference?: string | null
  commercialInvoiceNo?: string | null
}

function referencesBody(references?: InvoiceReferences) {
  return {
    exporterReference: references?.exporterReference?.trim() || null,
    commercialInvoiceNo: references?.commercialInvoiceNo?.trim() || null,
  }
}

/** One supplier invoice a create or a split made: a supplier invoice holds ONE item. */
export interface CreatedPurchaseInvoiceDto {
  id: number
  itemId: number | null
  itemCode: string | null
  itemName: string | null
  lineCount: number
  quantityBase: number
  totalAmount: number
}

/** "Create invoice" from an order or its containers: one draft per item. `id` = `firstId`. */
export interface CreatedPurchaseInvoicesDto {
  firstId: number
  id: number
  invoices: CreatedPurchaseInvoiceDto[]
  /** "3 invoices created, one per item" or "Invoice created". */
  message: string
}

export interface SplitByItemResultDto {
  invoices: CreatedPurchaseInvoiceDto[]
}

export type PurchaseDocumentTypeCode = 'PO' | 'PINV' | 'PRET'

/**
 * Purchase documents have one status more than the others: a posted order is OPEN until it is CLOSED.
 * An order sent for approval is PendingApproval (not editable, not posted yet) until it is approved.
 */
export type PurchaseDocumentStatus = 'Draft' | 'PendingApproval' | 'Posted' | 'Cancelled' | 'Closed'

export interface PurchaseRateResolutionDto {
  currencyId: number
  currencyCode: string
  symbol: string | null
  decimalPlaces: number
  isBaseCurrency: boolean
  rateType: SalesRateType
  /** Null when nothing is defined for that day — a warning on the page, not an error. */
  rate: number | null
  rateDate: string | null
  baseCurrencyCode: string | null
}

export interface SavePurchaseDocumentLine {
  lineNo: number
  itemId: number
  itemUnitId: number
  warehouseId: number
  expiryDate: string | null
  quantity: number
  /** Null = the item's last cost converted to the document currency (0 when it has none). */
  unitPrice: number | null
  discountPercent: number | null
  importRowNumber: number | null
  notes: string | null
  /** The order line an invoice line receives, or the invoice line a return line gives back. */
  sourceLineId: number | null
  /** Invoices from containers: EVERY line sends its container line back (the server refuses otherwise). */
  containerLineId?: number | null
}

export interface SavePurchaseDocumentRequest {
  documentTypeCode: PurchaseDocumentTypeCode
  documentDate: string
  expectedDate?: string | null
  branchId: number
  /**
   * The document's warehouse, which is now only a label: the warehouse lives on each LINE. Null
   * lets the server keep the first line's, which is what the editor sends.
   */
  warehouseId?: number | null
  supplierId: number
  /** Null = the supplier's default currency, else the base currency. */
  currencyId: number | null
  rateType: SalesRateType
  /** Null = resolved from the exchange rates for the document date. */
  exchangeRate: number | null
  supplierReference: string | null
  /** 1 on posting, 2 at the container offload; null = unchanged. Invoices send shippedInContainers instead. */
  receiptMode?: ReceiptMode | null
  /** Invoices: "Shipped in containers" (receipt mode 2). Refused off while a line is linked (409 RECEIPT_MODE_LOCKED). */
  shippedInContainers?: boolean | null
  exporterReference?: string | null
  commercialInvoiceNo?: string | null
  notes: string | null
  sourceDocumentId?: number | null
  lines: SavePurchaseDocumentLine[]
  rowVersion?: string | null
}

/** When a purchase invoice puts its goods into stock: 1 on posting (local), 2 on container offload (imports). */
export type ReceiptMode = 1 | 2

export const RECEIPT_MODE_LABELS: Record<ReceiptMode, string> = {
  1: 'On posting',
  2: 'On container offload',
}

/** A container of the document: for an order the containers carrying its lines, for an invoice its containers. */
export interface PurchaseInvoiceContainerDto {
  id: number
  containerRef: string
  containerNo: string | null
  status: number
  statusName: string
  dispatchDate: string | null
  eta: string | null
  offloadedDate: string | null
  currentLocation: string | null
  warehouseCode: string | null
  warehouseName: string | null
  /** Of this document, in base units. */
  allocatedBase: number
  receivedBase: number
  /** Of this document's quantity on the container, what posted invoices cover. */
  invoicedBase: number
  containerTypeId: number
  containerTypeCode: string
  purchaseOrderId: number | null
}

/** One container line to invoice, in pieces. */
export interface ContainerLineQuantity {
  containerLineId: number
  quantityBase: number
}

export interface PurchaseDocumentListDto {
  id: number
  documentTypeCode: PurchaseDocumentTypeCode
  documentTypeName: string
  stockDirection: number
  documentNumber: string | null
  documentDate: string
  expectedDate: string | null
  branchId: number
  branchName: string
  warehouseId: number
  warehouseName: string
  supplierId: number
  supplierCode: string
  supplierName: string
  currencyId: number
  currencyCode: string
  currencySymbol: string | null
  decimalPlaces: number
  exchangeRate: number
  supplierReference: string | null
  /** Null until the list procedure returns it. */
  exporterReference: string | null
  commercialInvoiceNo: string | null
  receiptMode: ReceiptMode
  status: PurchaseDocumentStatus
  totalItems: number
  totalQuantity: number
  subtotal: number
  totalDiscount: number
  totalAmount: number
  totalAmountBase: number
  sourceDocumentId: number | null
  sourceDocumentNumber: string | null
  /** Orders only: how much of the ordered quantity has been invoiced, 0–100. */
  receivedPercent: number | null
  /** Supplier invoices: the item it holds (the one of its first line); null for orders and returns. */
  itemId: number | null
  itemCode: string | null
  itemName: string | null
  /** Supplier invoices: how many items it holds — more than 1 only on a draft made before one item per invoice. */
  itemCount: number | null
  postedAtUtc: string | null
  postedByName: string | null
  cancelledAtUtc: string | null
  closedAtUtc: string | null
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  rowVersion: string
}

export interface PurchaseDocumentQuery {
  documentTypeCode: PurchaseDocumentTypeCode
  search?: string
  branchId?: number
  warehouseId?: number
  supplierId?: number
  status?: PurchaseDocumentStatus
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface PurchaseDocumentLineDto {
  id: number
  lineNo: number
  itemId: number
  itemCode: string
  itemName: string
  itemUnitId: number
  unitTypeName: string
  skuCode: string | null
  barcode: string | null
  packingFormula: number
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  expiryDate: string | null
  quantity: number
  quantityBase: number
  unitPrice: number
  discountPercent: number
  lineDiscount: number
  lineTotal: number
  /** The LANDED cost per base unit in the base currency, written by the posting (FOB + charges). */
  unitCostBase: number | null
  /** The same figure under the name the costing uses, so a column can say "Landed" without arithmetic. */
  landedCostBase: number | null
  /** What the supplier charged per base unit, before any of the charges around it. */
  fobCostBase: number | null
  /** The charges this line took, in the base currency. */
  allocatedChargesBase: number
  receivedQuantityBase: number
  returnedQuantityBase: number
  /** Orders: still to receive; invoices: still returnable; returns: null. Base units. */
  remainingBase: number | null
  /** Orders: what the supplier has shipped so far, recorded with "Mark as shipped". Base units. */
  shippedQuantityBase: number
  /** Invoices: loaded on containers in transit / at port / cleared and not yet received — what the shortage plan counts as Transit. Base units. */
  transitBase: number
  /** Invoices: what containers that are not cancelled hold of this line. Base units. */
  allocatedToContainersBase: number
  /** Orders: still free to load into a container; null on invoices and returns. Base units. */
  availableForContainerBase: number | null
  /** Orders: invoiced straight from the order, without a container. */
  invoicedDirectBase: number | null
  /* Invoices from containers: every line points to ONE container line. */
  containerLineId: number | null
  containerId: number | null
  containerRef: string | null
  containerNo: string | null
  containerStatus: number | null
  /** The posted container charges that fall on this line (base). */
  containerChargesBase: number | null
  /** FOB + container charges per unit; final once the container is offloaded. */
  estimatedLandedCostBase: number | null
  importRowNumber: number | null
  notes: string | null
  sourceLineId: number | null
  onHandBase: number
  itemLastCost: number | null
  itemAverageCost: number | null
  /** The item's FOB cost as it stands now — what the next invoice would start from. */
  itemFobCost: number | null
}

export interface PurchaseDocumentFileDto {
  id: number
  fileName: string
  contentType: string
  sizeBytes: number
  createdAtUtc: string
  createdByName: string | null
}

export interface PurchaseDocumentAuditDto {
  action: string
  details: string | null
  userName: string | null
  atUtc: string
}

/** A document this one came from ("Source") or one made from it ("Child"). */
export interface LinkedPurchaseDocumentDto {
  relation: 'Source' | 'Child'
  id: number
  documentTypeCode: PurchaseDocumentTypeCode
  documentTypeName: string
  documentNumber: string | null
  documentDate: string
  status: PurchaseDocumentStatus
  totalAmount: number
  currencyCode: string
}

export interface PurchaseDocumentDto {
  id: number
  documentTypeId: number
  documentTypeCode: PurchaseDocumentTypeCode
  documentTypeName: string
  stockDirection: number
  numberOnPost: boolean
  documentNumber: string | null
  documentDate: string
  expectedDate: string | null
  branchId: number
  branchCode: string
  branchName: string
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  supplierId: number
  supplierCode: string
  supplierName: string
  supplierPhone: string | null
  supplierEmail: string | null
  supplierAddress: string | null
  currencyId: number
  currencyCode: string
  currencyName: string
  currencySymbol: string | null
  decimalPlaces: number
  isBaseCurrency: boolean
  rateType: SalesRateType
  exchangeRate: number
  baseCurrencyCode: string | null
  supplierReference: string | null
  /** Invoices: the exporter's reference and the supplier's commercial invoice number. */
  exporterReference: string | null
  commercialInvoiceNo: string | null
  /** Invoices: 1 = stock on posting, 2 = stock on container offload (forced once in a container). */
  receiptMode: ReceiptMode
  /** Invoices: "Shipped in containers" = receipt mode 2 - the goods enter the stock at the container offload. */
  shippedInContainers: boolean
  notes: string | null
  status: PurchaseDocumentStatus
  /** Invoices created from containers: the exporter reference is required to post. */
  isContainerBound: boolean
  /** Orders: containers carrying its lines; invoices: its containers. */
  containerCount: number
  /** Invoices: containers its pieces fill, summed over its items (null when no item has a Container unit). */
  containersNeeded: number | null
  /** Orders: loaded in containers (base units). */
  loadedBase: number | null
  /** Invoices from containers: the posted container charges falling on its lines. */
  containerChargesBase: number | null
  /* Orders: invoicing progress in base units. */
  orderedBase: number | null
  invoicedBase: number | null
  inDraftInvoicesBase: number
  /** Orders: 0 not, 1 partially, 2 fully invoiced. */
  invoicingStatus: number | null
  totalItems: number
  totalQuantity: number
  subtotal: number
  totalDiscount: number
  totalAmount: number
  totalAmountBase: number
  /** The landed charges on the goods: the invoice's own and its posted adjustments'. */
  totalChargesBase: number
  /** What the goods really cost: totalAmountBase + totalChargesBase. */
  totalLandedCostBase: number
  sourceDocumentId: number | null
  sourceDocumentNumber: string | null
  sourceDocumentTypeCode: PurchaseDocumentTypeCode | null
  /** The shortage plan this order was created from. */
  sourceShortageId: number | null
  sourceShortageNumber: string | null
  postedAtUtc: string | null
  postedByName: string | null
  cancelledAtUtc: string | null
  cancelledByName: string | null
  cancelReason: string | null
  closedAtUtc: string | null
  closedByName: string | null
  closeReason: string | null
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  updatedByName: string | null
  rowVersion: string
  canEdit: boolean
  canPost: boolean
  canDelete: boolean
  canCancel: boolean
  canClose: boolean
  /** Charges are typed on a DRAFT invoice; after posting they arrive as a landed cost adjustment. */
  canEditCharges: boolean
  /** A posted invoice can receive charges that arrived late. */
  canAdjustLandedCost: boolean
  /** An open (posted) order: shipped quantities can be recorded. */
  canMarkShipped: boolean
  canCreateInvoice: boolean
  canCreateReturn: boolean
  lines: PurchaseDocumentLineDto[]
  /** The invoice's own charges AND those of its adjustments, each saying which it came from. */
  charges: PurchaseChargeDto[]
  files: PurchaseDocumentFileDto[]
  audit: PurchaseDocumentAuditDto[]
  linked: LinkedPurchaseDocumentDto[]
  /** The containers of the order or of the invoice. */
  containers: PurchaseInvoiceContainerDto[]
}

export interface ImportCreatePurchaseDocumentsRequest {
  documentTypeCode: PurchaseDocumentTypeCode
  documentDate: string
  expectedDate?: string | null
  branchId: number
  supplierId: number
  currencyId: number | null
  rateType: SalesRateType
  exchangeRate: number | null
  supplierReference: string | null
  notes: string | null
  lines: ImportCreateLine[]
  postImmediately: boolean
}

export const purchaseDocumentsApi = {
  get: (id: number) => request<PurchaseDocumentDto>(`${BASE}/${id}`),

  list: (query: PurchaseDocumentQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams({ documentTypeCode: query.documentTypeCode })
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.branchId !== undefined) params.set('branchId', String(query.branchId))
    if (query.warehouseId !== undefined) params.set('warehouseId', String(query.warehouseId))
    if (query.supplierId !== undefined) params.set('supplierId', String(query.supplierId))
    if (query.status) params.set('status', query.status)
    if (query.dateFrom) params.set('dateFrom', query.dateFrom)
    if (query.dateTo) params.set('dateTo', query.dateTo)
    if (query.sortBy) params.set('sortBy', query.sortBy)
    if (query.sortDir) params.set('sortDir', query.sortDir)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    return request<PagedResult<PurchaseDocumentListDto>>(`${BASE}?${params.toString()}`, { signal })
  },

  create: (payload: SavePurchaseDocumentRequest) => request<PurchaseDocumentDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SavePurchaseDocumentRequest) =>
    request<PurchaseDocumentDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  post: (id: number, rowVersion: string | null) =>
    request<PurchaseDocumentDto>(`${BASE}/${id}/post`, { method: 'POST', body: { rowVersion } }),

  cancel: (id: number, reason: string, rowVersion: string | null) =>
    request<PurchaseDocumentDto>(`${BASE}/${id}/cancel`, { method: 'POST', body: { reason, rowVersion } }),

  /** Orders only: ends an open order that will not be received any further. */
  close: (id: number, reason: string | null, rowVersion: string | null) =>
    request<PurchaseDocumentDto>(`${BASE}/${id}/close`, { method: 'POST', body: { reason, rowVersion } }),

  /**
   * What the supplier has shipped on an open order — the TOTAL shipped so far per line, in base
   * units. No lines means everything was shipped. Needs purchase.orders.create.
   */
  markShipped: (id: number, lines: { lineId: number; shippedQuantityBase: number }[], rowVersion: string | null) =>
    request<PurchaseDocumentDto>(`${BASE}/${id}/mark-shipped`, { method: 'POST', body: { lines, rowVersion } }),

  /**
   * The charges of a DRAFT purchase invoice, replacing whatever was there. Sent apart from the
   * lines: the lines are the supplier's bill and the charges are everybody else's.
   */
  setCharges: (id: number, payload: SetPurchaseChargesRequest) =>
    request<PurchaseDocumentDto>(`${BASE}/${id}/charges`, { method: 'PUT', body: payload }),

  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  /** Purchase invoice drafts holding what remains to receive on the posted order: ONE PER ITEM. */
  createInvoice: (id: number, documentDate?: string | null, references?: InvoiceReferences) =>
    request<CreatedPurchaseInvoicesDto>(`${BASE}/${id}/create-invoice`, {
      method: 'POST',
      body: { documentDate: documentDate ?? null, ...referencesBody(references) },
    }),

  /** A purchase return draft holding what can still be returned from the posted invoice. */
  /** Draft invoices from container lines of the order, ONE PER ITEM; no lines = everything loaded and not yet invoiced. */
  invoiceFromContainers: (orderId: number, documentDate?: string | null, lines?: ContainerLineQuantity[], references?: InvoiceReferences) =>
    request<CreatedPurchaseInvoicesDto>(`${BASE}/${orderId}/invoice-from-containers`, {
      method: 'POST',
      body: { documentDate: documentDate ?? null, lines: lines ?? [], ...referencesBody(references) },
    }),

  /** A draft invoice holding several items (made before one item per invoice) into one invoice per item; the original first. */
  splitByItem: (id: number, rowVersion: string | null) =>
    request<SplitByItemResultDto>(`${BASE}/${id}/split-by-item`, { method: 'POST', body: { rowVersion } }),

  /** Posts each draft purchase invoice on its own, in order: one refusal does not stop the others. */
  postMany: (ids: number[]) => request<BulkActionItemResult[]>(`${BASE}/post-many`, { method: 'POST', body: { ids } }),

  createReturn: (id: number, documentDate?: string | null) =>
    request<PurchaseDocumentDto>(`${BASE}/${id}/create-return`, { method: 'POST', body: { documentDate: documentDate ?? null } }),

  /** The files with their type, date and note (script 48): list, upload, edit, download, delete. */
  files: documentFilesApi(BASE),

  bulkPost: (ids: number[]) => request<BulkActionResult>(`${BASE}/bulk-post`, { method: 'POST', body: { ids } }),

  bulkDelete: (ids: number[]) => request<BulkActionResult>(`${BASE}/bulk-delete`, { method: 'POST', body: { ids } }),

  importCreate: (payload: ImportCreatePurchaseDocumentsRequest) =>
    request<ImportCreateResult>(`${BASE}/import-create`, { method: 'POST', body: payload }),

  /** A currency's rate on a day. Any signed-in user. */
  rate: (currencyId: number, rateType: SalesRateType, date?: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ currencyId: String(currencyId), rateType: String(rateType) })
    if (date) params.set('date', date)
    return request<PurchaseRateResolutionDto>(`/api/purchase/rate?${params.toString()}`, { signal })
  },

  exportToExcel: async (id: number, fileName: string) => save(await fetchBlob(`${BASE}/${id}/export`), fileName),
}

function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
