import type { BulkActionResult, ImportCreateLine, ImportCreateResult } from '../documents'
import { documentFilesApi } from '../documentFiles'
import { fetchBlob, request } from '../http'
import type { PagedResult } from '../types'

/**
 * Inventory In / Out documents, the stock ledger behind them, and the configuration they read.
 *
 * THE FIRST DOCUMENT FAMILY. Purchase and Sales will have the same shape — a header, lines, files,
 * an audit trail, and a Draft → Posted → Cancelled lifecycle — so the types here are named for what
 * they are rather than for inventory, and the screens are built to be reused.
 */

/** Draft is editable and has no stock effect; Posted has written the ledger; Cancelled has reversed it. */
export type StockDocumentStatus = 'Draft' | 'Posted' | 'Cancelled'

/** The two inventory kinds. The other six document types exist but belong to families not built yet. */
export type StockDocumentTypeCode = 'INV_IN' | 'INV_OUT'

export interface DocumentTypeDto {
  id: number
  code: string
  name: string
  /** Inventory | Purchase | Sales. */
  family: string
  /** +1 adds stock, -1 removes it, 0 no ledger effect (orders). */
  stockDirection: number
  numberPrefix: string
  nextNumber: number
  numberLength: number
  /**
   * False: the number is assigned on the first save, so a draft already has one.
   * True: drafts show DRAFT and the number is assigned on posting, so the series has no gaps.
   */
  numberOnPost: boolean
  requiresReason: boolean
  /** Cost: a typed or average cost; PriceList: the price list price; None: no money on the lines. */
  defaultPricing: 'Cost' | 'PriceList' | 'None'
  /** Whether the price / cost column may be typed. False on an Out: the average is applied. */
  priceEditable: boolean
  /** True: one sequence per branch ("IN-KLW-000012"); false: one for the company. */
  numberPerBranch: boolean
  /** True: the year is part of the number and the sequence restarts every year ("SHR-2026-000001"). */
  yearInNumber: boolean
  isActive: boolean
  updatedAtUtc: string | null
  /** Base64 ROWVERSION; sent back on update so concurrent edits are detected. */
  rowVersion: string
}

/** The configuration page's save. Code, family and direction are not editable. */
export interface UpdateDocumentTypeRequest {
  name: string
  numberPrefix: string
  numberLength: number
  numberOnPost: boolean
  requiresReason: boolean
  defaultPricing: string
  priceEditable: boolean
  numberPerBranch: boolean
  yearInNumber: boolean
  isActive: boolean
  rowVersion: string | null
}

/** An imported file becoming stock documents: the shared header and the lines, grouped by warehouse on the server. */
export interface ImportCreateStockDocumentsRequest {
  documentTypeCode: StockDocumentTypeCode
  documentDate: string
  branchId: number
  reasonId?: number | null
  referenceNo?: string | null
  notes?: string | null
  lines: ImportCreateLine[]
  postImmediately: boolean
}

export interface StockReasonDto {
  id: number
  reasonCode: string
  reasonName: string
  /** In | Out | Both. */
  appliesTo: string
  isActive: boolean
}

export interface StockDocumentListDto {
  id: number
  documentTypeCode: string
  documentTypeName: string
  stockDirection: number
  /** Null on a draft of a type that numbers on posting — the list shows a DRAFT badge for those. */
  documentNumber: string | null
  documentDate: string
  branchId: number
  branchName: string
  warehouseId: number
  warehouseName: string
  reasonId: number | null
  reasonName: string | null
  referenceNo: string | null
  currencyCode: string
  status: StockDocumentStatus
  totalItems: number
  /** Base units, so a Box of 12 counts as 12 — the measure the ledger uses. */
  totalQuantity: number
  totalCost: number
  postedAtUtc: string | null
  postedByName: string | null
  createdAtUtc: string
  createdByName: string | null
  rowVersion: string
}

export interface StockDocumentLineDto {
  id: number
  lineNo: number
  itemId: number
  itemCode: string
  itemName: string
  itemUnitId: number
  unitTypeName: string
  skuCode: string | null
  barcode: string | null
  /** How many base units this unit holds; snapshotted at save time so a later change cannot restate a posted document. */
  packingFormula: number
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  expiryDate: string | null
  /** In the chosen unit. */
  quantity: number
  /** quantity x packingFormula: what actually moves in the ledger. */
  quantityBase: number
  unitCost: number
  lineTotal: number
  notes: string | null
  /** Stock in this item and warehouse right now, so an Out can be warned about before it is posted. */
  onHandBase: number
}

export interface StockDocumentFileDto {
  id: number
  fileName: string
  contentType: string
  sizeBytes: number
  createdAtUtc: string
  createdByName: string | null
}

export interface StockDocumentAuditDto {
  action: string
  details: string | null
  userName: string | null
  atUtc: string
}

export interface StockDocumentDto {
  id: number
  documentTypeId: number
  documentTypeCode: string
  documentTypeName: string
  stockDirection: number
  numberOnPost: boolean
  documentNumber: string | null
  documentDate: string
  branchId: number
  branchCode: string
  branchName: string
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  reasonId: number | null
  reasonCode: string | null
  reasonName: string | null
  referenceNo: string | null
  currencyId: number
  currencyCode: string
  decimalPlaces: number
  notes: string | null
  status: StockDocumentStatus
  totalItems: number
  totalQuantity: number
  totalCost: number
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
  /**
   * What the DOCUMENT allows, computed by the server from its status. Whether this USER may do it is
   * a permission checked separately — both have to be true before a button is offered.
   */
  canEdit: boolean
  canPost: boolean
  canCancel: boolean
  canDelete: boolean
  lines: StockDocumentLineDto[]
  files: StockDocumentFileDto[]
  audit: StockDocumentAuditDto[]
}

export interface SaveStockDocumentLine {
  lineNo: number
  itemId: number
  itemUnitId: number
  warehouseId: number
  expiryDate?: string | null
  quantity: number
  /** Per unit. Ignored on an Out, which takes the current average cost. */
  unitCost?: number | null
  notes?: string | null
}

/**
 * Creating or replacing a draft.
 *
 * THE LINES ARE A FULL REPLACE, not a patch: a grid where rows are added, reordered and deleted has
 * no stable identity to patch against, and the procedure rewrites them in one transaction.
 */
export interface SaveStockDocumentRequest {
  documentTypeCode: StockDocumentTypeCode
  /** 'yyyy-MM-dd'. */
  documentDate: string
  branchId: number
  /**
   * The document's warehouse, which is now only a label: the warehouse lives on each LINE. Null
   * lets the server keep the first line's, which is what the editor sends.
   */
  warehouseId?: number | null
  reasonId?: number | null
  referenceNo?: string | null
  notes?: string | null
  lines: SaveStockDocumentLine[]
  rowVersion?: string | null
}

export interface StockDocumentQuery {
  documentTypeCode: StockDocumentTypeCode
  search?: string
  branchId?: number
  warehouseId?: number
  status?: StockDocumentStatus
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

const BASE = '/api/inventory/stock-documents'

function toQueryString(query: StockDocumentQuery): string {
  const params = new URLSearchParams({ documentTypeCode: query.documentTypeCode })
  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.branchId !== undefined) params.set('branchId', String(query.branchId))
  if (query.warehouseId !== undefined) params.set('warehouseId', String(query.warehouseId))
  if (query.status) params.set('status', query.status)
  if (query.dateFrom) params.set('dateFrom', query.dateFrom)
  if (query.dateTo) params.set('dateTo', query.dateTo)
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.sortDir) params.set('sortDir', query.sortDir)
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
  return `?${params.toString()}`
}

export const stockDocumentsApi = {
  search: (query: StockDocumentQuery, signal?: AbortSignal) =>
    request<PagedResult<StockDocumentListDto>>(`${BASE}${toQueryString(query)}`, { signal }),

  get: (id: number) => request<StockDocumentDto>(`${BASE}/${id}`),

  create: (payload: SaveStockDocumentRequest) =>
    request<StockDocumentDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveStockDocumentRequest) =>
    request<StockDocumentDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  /** Writes the ledger and closes the document. Assigns the number where the type numbers on posting. */
  post: (id: number, rowVersion: string | null) =>
    request<StockDocumentDto>(`${BASE}/${id}/post`, { method: 'POST', body: { rowVersion } }),

  /** Writes reversal movements. The reason is required: a reversal nobody can account for is worse than none. */
  cancel: (id: number, reason: string, rowVersion: string | null) =>
    request<StockDocumentDto>(`${BASE}/${id}/cancel`, { method: 'POST', body: { reason, rowVersion } }),

  /** Drafts only. A posted document is a record of something that happened and is never removed. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  exportToExcel: async (id: number, fileName: string) =>
    save(await fetchBlob(`${BASE}/${id}/export`), fileName),

  /** Posts each id in its own transaction; the result says what happened to each. */
  bulkPost: (ids: number[]) => request<BulkActionResult>(`${BASE}/bulk-post`, { method: 'POST', body: { ids } }),

  /** Deletes each draft in its own call; a posted document among the ids fails alone with NOT_DRAFT. */
  bulkDelete: (ids: number[]) => request<BulkActionResult>(`${BASE}/bulk-delete`, { method: 'POST', body: { ids } }),

  /** ONE document holding every line, each in the warehouse it names; posted at once when asked. */
  importCreate: (payload: ImportCreateStockDocumentsRequest) =>
    request<ImportCreateResult>(`${BASE}/import-create`, { method: 'POST', body: payload }),


  /** The files with their type, date and note (script 48): list, upload, edit, download, delete. */
  files: documentFilesApi(BASE),
}

export const inventoryLookupsApi = {
  /** All eight document kinds and their numbering rules. Readable by any signed-in user. */
  documentTypes: () => request<DocumentTypeDto[]>('/api/inventory/document-types'),

  /** The configuration page's save; needs inventory.documenttypes.manage. */
  updateDocumentType: (id: number, payload: UpdateDocumentTypeRequest) =>
    request<DocumentTypeDto>(`/api/inventory/document-types/${id}`, { method: 'PUT', body: payload }),


  /** Reasons for one direction: 1 for In, -1 for Out. */
  stockReasons: (direction: number) =>
    request<StockReasonDto[]>(`/api/inventory/stock-reasons?direction=${direction}`),

  /** Stock in one item and warehouse, in base units — the line grid's On Hand column. */
  onHand: (itemId: number, warehouseId: number, signal?: AbortSignal) =>
    request<{ onHandBase: number }>(
      `/api/inventory/stock/on-hand?itemId=${itemId}&warehouseId=${warehouseId}`,
      { signal },
    ),
}

/**
 * Hands a blob to the browser as a download.
 *
 * A plain <a href> cannot carry the Authorization header, so the bytes are fetched first and the
 * link is synthesised around the object URL — revoked on the next tick, because revoking it
 * synchronously can beat the browser to the download.
 */
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
