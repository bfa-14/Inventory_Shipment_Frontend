import { fetchBlob, request } from '../http'
import type { PagedResult } from '../types'
import type { ChargeAllocationMethod } from './chargeTypes'

/**
 * Landed cost adjustments: the freight bill that arrives three weeks after the goods.
 *
 * POSTING ONE MOVES VALUE, NOT STOCK. The charges are spread over the invoice's lines and then
 * split — what is still on the shelf raises the inventory value and the item's average cost, what
 * has already been sold lands in the period's cost of sales.
 */
const BASE = '/api/purchase/landed-cost-adjustments'

export type LandedCostAdjustmentStatus = 'Draft' | 'Posted' | 'Cancelled'

export const LANDED_COST_STATUSES: LandedCostAdjustmentStatus[] = ['Draft', 'Posted', 'Cancelled']

export const LANDED_COST_STATUS_COLOURS: Record<LandedCostAdjustmentStatus, string> = {
  Draft: 'gray',
  Posted: 'green',
  Cancelled: 'red',
}

/** One charge on an invoice or an adjustment, as the API returns it. */
export interface PurchaseChargeDto {
  id: number
  /** PINV (typed on the invoice) or LCA (on an adjustment). */
  documentKind: 'PINV' | 'LCA'
  documentId: number
  /** The number of the document it belongs to — the invoice's, or the adjustment's. */
  sourceNumber: string | null
  lineNumber: number
  chargeTypeId: number
  chargeCode: string
  chargeName: string
  description: string | null
  providerPartyId: number | null
  providerName: string | null
  reference: string | null
  currencyId: number
  currencyCode: string
  rateType: number
  exchangeRate: number
  amount: number
  amountBase: number
  allocationMethod: ChargeAllocationMethod
  includeInLandedCost: boolean
  includedInSupplierInvoice: boolean
  notes: string | null
  /** What reached the lines. Null until the document is posted. */
  allocatedBase: number | null
  /** On a charge of an adjustment: 1 Draft, 2 Posted, 3 Cancelled. Null on the invoice's own. */
  adjustmentStatus: number | null
}

/** One charge as the page sends it. What is left null is taken from the type or the document. */
export interface PurchaseChargeRequest {
  lineNumber: number
  chargeTypeId: number
  description?: string | null
  providerPartyId?: number | null
  reference?: string | null
  /** Null = the invoice's currency (an adjustment: the base currency). */
  currencyId?: number | null
  rateType?: number | null
  /** Null = the rate of the document date. */
  exchangeRate?: number | null
  amount: number
  /** Null = the charge type's own method. */
  allocationMethod?: string | null
  includedInSupplierInvoice: boolean
  notes?: string | null
}

/** One cell of a manually allocated charge: what this INVOICE line takes of it, in the base currency. */
export interface ManualAllocationRequest {
  chargeLineNumber: number
  purchaseLineId: number
  amountBase: number
}

export interface SetPurchaseChargesRequest {
  charges: PurchaseChargeRequest[]
  manualAllocations: ManualAllocationRequest[]
  rowVersion?: string | null
}

export interface LandedCostAdjustmentListDto {
  id: number
  documentNumber: string
  documentDate: string
  branchId: number
  branchName: string
  sourceInvoiceId: number
  sourceInvoiceNumber: string | null
  supplierId: number
  supplierName: string
  status: LandedCostAdjustmentStatus
  totalChargesBase: number
  inventoryPortionBase: number
  cogsPortionBase: number
  postedAtUtc: string | null
  postedByName: string | null
  createdAtUtc: string
  createdByName: string | null
  rowVersion: string
  canEdit: boolean
  canPost: boolean
  canCancel: boolean
  canDelete: boolean
}

/** One invoice line as the adjustment touched it — the split, filled in at posting. */
export interface LandedCostAdjustmentLineDto {
  id: number
  purchaseLineId: number
  /** The line's number on the INVOICE. */
  lineNo: number
  itemId: number
  itemCode: string
  itemName: string
  warehouseId: number
  warehouseCode: string
  receivedBase: number
  netReceivedBase: number
  /** Still in stock — the part that becomes inventory value rather than cost of sales. */
  remainingBase: number
  allocatedBase: number
  extraPerBaseUnit: number
  inventoryPortionBase: number
  cogsPortionBase: number
  landedCostBefore: number
  landedCostAfter: number
}

export interface LandedCostAdjustmentDto {
  id: number
  documentNumber: string
  documentDate: string
  branchId: number
  branchName: string
  sourceInvoiceId: number
  sourceInvoiceNumber: string | null
  supplierId: number
  supplierCode: string
  supplierName: string
  warehouseId: number
  warehouseName: string
  notes: string | null
  status: LandedCostAdjustmentStatus
  totalChargesBase: number
  inventoryPortionBase: number
  cogsPortionBase: number
  postedAtUtc: string | null
  postedBy: number | null
  postedByName: string | null
  cancelledAtUtc: string | null
  cancelReason: string | null
  createdAtUtc: string
  createdBy: number | null
  createdByName: string | null
  updatedAtUtc: string | null
  rowVersion: string
  canEdit: boolean
  canPost: boolean
  canCancel: boolean
  canDelete: boolean
  charges: PurchaseChargeDto[]
  /** The split over the invoice's lines. Empty while the adjustment is a draft. */
  lines: LandedCostAdjustmentLineDto[]
}

export interface SaveLandedCostAdjustmentRequest {
  sourceInvoiceId: number
  documentDate: string
  notes: string | null
  charges: PurchaseChargeRequest[]
  manualAllocations: ManualAllocationRequest[]
  rowVersion?: string | null
}

export interface LandedCostAdjustmentQuery {
  search?: string
  sourceInvoiceId?: number
  branchId?: number
  status?: LandedCostAdjustmentStatus
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

export const landedCostAdjustmentsApi = {
  list: (query: LandedCostAdjustmentQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.sourceInvoiceId !== undefined) params.set('sourceInvoiceId', String(query.sourceInvoiceId))
    if (query.branchId !== undefined) params.set('branchId', String(query.branchId))
    if (query.status) params.set('status', query.status)
    if (query.dateFrom) params.set('dateFrom', query.dateFrom)
    if (query.dateTo) params.set('dateTo', query.dateTo)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    return request<PagedResult<LandedCostAdjustmentListDto>>(`${BASE}?${params.toString()}`, { signal })
  },

  get: (id: number) => request<LandedCostAdjustmentDto>(`${BASE}/${id}`),

  create: (payload: SaveLandedCostAdjustmentRequest) =>
    request<LandedCostAdjustmentDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveLandedCostAdjustmentRequest) =>
    request<LandedCostAdjustmentDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  post: (id: number, rowVersion: string | null) =>
    request<LandedCostAdjustmentDto>(`${BASE}/${id}/post`, { method: 'POST', body: { rowVersion } }),

  cancel: (id: number, reason: string, rowVersion: string | null) =>
    request<LandedCostAdjustmentDto>(`${BASE}/${id}/cancel`, { method: 'POST', body: { reason, rowVersion } }),

  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  exportToExcel: async (id: number, documentNumber: string) =>
    save(await fetchBlob(`${BASE}/${id}/export`), `LandedCost_${documentNumber}.xlsx`),
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
