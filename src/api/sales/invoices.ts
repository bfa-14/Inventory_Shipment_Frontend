import type { BulkActionResult, ImportCreateLine, ImportCreateResult } from '../documents'
import { fetchBlob, postForm, request } from '../http'
import type { PagedResult } from '../types'

/**
 * Sales invoices (script 17).
 *
 * TODAY ONE SCREEN USES THIS — Import Sales from Excel — and it uses one write: import-post, which
 * saves the lines as a draft and posts them in a single call, so a file becomes a posted invoice
 * and a set of stock movements without a draft ever being shown. The rest of the invoice API
 * (search, edit, cancel, attachments) exists on the server and gets its client here when the
 * invoice page arrives; the document types below are already the full shape so that page has
 * nothing to redefine.
 */

const BASE = '/api/sales/invoices'

/** 1 Official, 2 Non-official, 3 Market — the numbers the API takes. */
export type SalesRateType = 1 | 2 | 3

export const SALES_RATE_TYPES: readonly { value: SalesRateType; label: string }[] = [
  { value: 1, label: 'Official' },
  { value: 2, label: 'Non-official' },
  { value: 3, label: 'Market' },
]

export function salesRateTypeLabel(type: SalesRateType): string {
  return SALES_RATE_TYPES.find((t) => t.value === type)?.label ?? String(type)
}

/** What GET rate answers: the price list's currency and the rate in force on a date. */
export interface RateResolutionDto {
  priceListId: number
  currencyId: number
  currencyCode: string
  symbol: string | null
  decimalPlaces: number
  isBaseCurrency: boolean
  rateType: SalesRateType
  /** Null when no rate is defined for the date — the page then asks for one; it is not an error. */
  rate: number | null
  rateDate: string | null
  baseCurrencyCode: string | null
}

/** What import-post answers: the posted invoice in summary, and how many ledger rows it wrote. */
export interface ImportPostResult {
  id: number
  documentNumber: string
  totalItems: number
  totalQuantity: number
  subtotal: number
  totalDiscount: number
  totalAmount: number
  currencyCode: string
  currencySymbol: string | null
  decimalPlaces: number
  totalAmountBase: number
  baseCurrencyCode: string | null
  exchangeRate: number
  postedAtUtc: string | null
  /** One per line: the rows written to inventory.StockMovements. */
  movementsWritten: number
}

export interface SaveSalesInvoiceLine {
  lineNo: number
  itemId: number
  itemUnitId: number
  warehouseId: number
  expiryDate: string | null
  quantity: number
  /**
   * A manual price, or null to let the price list decide.
   *
   * SEND IT ONLY WHEN IT IS MANUAL. The server honours it for a caller with the price override
   * permission and records the line's source as Manual; a list price echoed back here would be
   * recorded as an override that never happened.
   */
  unitPrice: number | null
  discountPercent: number | null
  /** The Excel row the line came from, kept so a later error can point back at the file. */
  importRowNumber: number | null
  notes: string | null
}

export interface SaveSalesInvoiceRequest {
  documentDate: string
  dueDate?: string | null
  branchId: number
  /**
   * The invoice's warehouse, which is now only a label: the warehouse lives on each LINE. Null
   * lets the server keep the first line's, which is what the editor sends.
   */
  warehouseId?: number | null
  clientId: number
  salesmanId: number | null
  priceListId: number
  rateType: SalesRateType
  /** Null: the server takes the rate in force for the date. A value overrides it. */
  exchangeRate: number | null
  referenceNo: string | null
  notes: string | null
  lines: SaveSalesInvoiceLine[]
  /** The import wizard's reference, so its audit rows are stamped with the invoice's id. */
  draftReference?: string | null
  rowVersion?: string | null
}

export type SalesInvoiceStatus = 'Draft' | 'Posted' | 'Cancelled'

/** One row of the invoice list. */
export interface SalesInvoiceListDto {
  id: number
  documentTypeCode: string
  documentTypeName: string
  /** Null on a draft: the number is assigned on posting. */
  documentNumber: string | null
  documentDate: string
  dueDate: string | null
  branchId: number
  branchName: string
  warehouseId: number
  warehouseName: string
  clientId: number
  clientCode: string
  clientName: string
  salesmanId: number | null
  salesmanName: string | null
  priceListId: number
  priceListName: string
  currencyCode: string
  currencySymbol: string | null
  decimalPlaces: number
  exchangeRate: number
  referenceNo: string | null
  status: SalesInvoiceStatus
  totalItems: number
  totalQuantity: number
  subtotal: number
  totalDiscount: number
  totalAmount: number
  totalAmountBase: number
  postedAtUtc: string | null
  postedByName: string | null
  cancelledAtUtc: string | null
  createdAtUtc: string
  createdByName: string | null
  rowVersion: string
}

export interface SalesInvoiceQuery {
  search?: string
  branchId?: number
  warehouseId?: number
  clientId?: number
  salesmanId?: number
  status?: SalesInvoiceStatus
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/** An imported file becoming invoices: the header every invoice shares; the server groups the lines by warehouse. */
export interface ImportCreateSalesInvoicesRequest {
  documentDate: string
  dueDate?: string | null
  branchId: number
  clientId: number
  salesmanId: number | null
  priceListId: number
  rateType: SalesRateType
  exchangeRate: number | null
  referenceNo: string | null
  notes: string | null
  draftReference?: string | null
  lines: ImportCreateLine[]
  postImmediately: boolean
}

export interface SalesInvoiceLineDto {
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
  priceSource: 'PriceList' | 'Manual'
  /** The average cost snapshotted on posting; null on a draft. */
  /* THE COST SNAPSHOT, frozen when the invoice was posted. Null on a draft, and null for a reader
     without sales.profit.view — a price is everybody's business, a margin is not. */
  unitCostBase: number | null
  fobCostAtSale: number | null
  lastCostAtSale: number | null
  /** The line's sale after discount, in the base currency. */
  netSalesBase: number | null
  cogsBase: number | null
  grossProfitBase: number | null
  /** Gross profit as a percentage OF NET SALES. */
  grossProfitPct: number | null
  /** How much of this line has come back on a sales return, in base units. */
  returnedQuantityBase: number
  /** What can still be returned. */
  remainingBase: number
  /** The item's average cost as it stands NOW. Null without sales.profit.view. */
  itemAverageCost: number | null
  importRowNumber: number | null
  notes: string | null
  onHandBase: number
  systemPrice: number | null
}

export interface SalesInvoiceFileDto {
  id: number
  fileName: string
  contentType: string
  sizeBytes: number
  createdAtUtc: string
  createdByName: string | null
}

export interface SalesInvoiceAuditDto {
  action: string
  details: string | null
  userName: string | null
  atUtc: string
}

export interface SalesInvoiceDto {
  id: number
  documentTypeId: number
  documentTypeCode: string
  documentTypeName: string
  numberOnPost: boolean
  documentNumber: string | null
  documentDate: string
  dueDate: string | null
  branchId: number
  branchCode: string
  branchName: string
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  clientId: number
  clientCode: string
  clientName: string
  clientPhone: string | null
  clientEmail: string | null
  clientAddress: string | null
  salesmanId: number | null
  salesmanCode: string | null
  salesmanName: string | null
  priceListId: number
  priceListCode: string
  priceListName: string
  currencyId: number
  currencyCode: string
  currencyName: string
  currencySymbol: string | null
  decimalPlaces: number
  isBaseCurrency: boolean
  rateType: SalesRateType
  exchangeRate: number
  baseCurrencyCode: string | null
  referenceNo: string | null
  notes: string | null
  status: SalesInvoiceStatus
  totalItems: number
  totalQuantity: number
  subtotal: number
  totalDiscount: number
  totalAmount: number
  totalAmountBase: number
  /** Cost of the goods that left. Null on a draft and for a reader without sales.profit.view. */
  totalCostBase: number | null
  totalGrossProfitBase: number | null
  totalGrossProfitPct: number | null
  /** The invoice a return was created from. */
  sourceDocumentId: number | null
  sourceDocumentNumber: string | null
  postedAtUtc: string | null
  postedByName: string | null
  cancelledAtUtc: string | null
  cancelledByName: string | null
  cancelReason: string | null
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  updatedByName: string | null
  rowVersion: string
  canEdit: boolean
  canPost: boolean
  canCancel: boolean
  /** A posted invoice with something still not returned becomes a sales return draft. */
  canCreateReturn: boolean
  canDelete: boolean
  lines: SalesInvoiceLineDto[]
  files: SalesInvoiceFileDto[]
  audit: SalesInvoiceAuditDto[]
}

export const salesInvoicesApi = {
  /**
   * Saves the lines as a draft and posts it in one call.
   *
   * A REFUSAL LEAVES NOTHING BEHIND: the server deletes a draft whose posting failed, so the page
   * can show the error, let the reader fix the lines and call again without a stray invoice
   * accumulating somewhere it cannot see. Errors come back as problem details with a code —
   * INSUFFICIENT_STOCK, NO_PRICE, VALIDATION ("Line N: …"), MASTER_INACTIVE, NO_LINES.
   */
  importPost: (payload: SaveSalesInvoiceRequest) =>
    request<ImportPostResult>(`${BASE}/import-post`, { method: 'POST', body: payload }),

  get: (id: number) => request<SalesInvoiceDto>(`${BASE}/${id}`),

  /** `signal` lets the list abandon this request when the reader edits the filters again. */
  list: (query: SalesInvoiceQuery = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.branchId !== undefined) params.set('branchId', String(query.branchId))
    if (query.warehouseId !== undefined) params.set('warehouseId', String(query.warehouseId))
    if (query.clientId !== undefined) params.set('clientId', String(query.clientId))
    if (query.salesmanId !== undefined) params.set('salesmanId', String(query.salesmanId))
    if (query.status) params.set('status', query.status)
    if (query.dateFrom) params.set('dateFrom', query.dateFrom)
    if (query.dateTo) params.set('dateTo', query.dateTo)
    if (query.sortBy) params.set('sortBy', query.sortBy)
    if (query.sortDir) params.set('sortDir', query.sortDir)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    const qs = params.toString()
    return request<PagedResult<SalesInvoiceListDto>>(`${BASE}${qs ? `?${qs}` : ''}`, { signal })
  },

  create: (payload: SaveSalesInvoiceRequest) => request<SalesInvoiceDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveSalesInvoiceRequest) =>
    request<SalesInvoiceDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  post: (id: number, rowVersion: string | null) =>
    request<SalesInvoiceDto>(`${BASE}/${id}/post`, { method: 'POST', body: { rowVersion } }),

  cancel: (id: number, reason: string, rowVersion: string | null) =>
    request<SalesInvoiceDto>(`${BASE}/${id}/cancel`, { method: 'POST', body: { reason, rowVersion } }),

  /**
   * A sales return draft from a posted invoice: the remaining quantities, the invoice's prices and
   * its ORIGINAL cost of sales. There is no returns page yet — the caller shows the number.
   */
  createReturn: (id: number, documentDate?: string | null) =>
    request<SalesInvoiceDto>(`${BASE}/${id}/create-return`, { method: 'POST', body: { documentDate: documentDate ?? null } }),

  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  addFile: (id: number, file: File) => {
    const form = new FormData()
    form.append('file', file, file.name)
    return postForm<{ id: number }>(`${BASE}/${id}/files`, form)
  },

  downloadFile: async (id: number, fileId: number, fileName: string) =>
    save(await fetchBlob(`${BASE}/${id}/files/${fileId}`), fileName),

  removeFile: (id: number, fileId: number) => request<void>(`${BASE}/${id}/files/${fileId}`, { method: 'DELETE' }),

  /** Posts each id in its own transaction; the result says what happened to each. */
  bulkPost: (ids: number[]) => request<BulkActionResult>(`${BASE}/bulk-post`, { method: 'POST', body: { ids } }),

  bulkDelete: (ids: number[]) => request<BulkActionResult>(`${BASE}/bulk-delete`, { method: 'POST', body: { ids } }),

  /** One invoice per warehouse found in the lines, each posted at once when asked. */
  importCreate: (payload: ImportCreateSalesInvoicesRequest) =>
    request<ImportCreateResult>(`${BASE}/import-create`, { method: 'POST', body: payload }),

  /** The rate in force for a price list's currency on a date (today when omitted). */
  rate: (priceListId: number, rateType: SalesRateType, date?: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ priceListId: String(priceListId), rateType: String(rateType) })
    if (date) params.set('date', date)
    return request<RateResolutionDto>(`${BASE}/rate?${params.toString()}`, { signal })
  },

  /** The posted invoice as a workbook, saved by the browser. */
  exportToExcel: async (id: number, fileName: string) => save(await fetchBlob(`${BASE}/${id}/export`), fileName),
}

/** Hands a blob to the browser as a download — a plain link cannot carry the bearer token. */
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
