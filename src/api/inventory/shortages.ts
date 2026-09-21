import { fetchBlob, request } from '../http'
import type { PurchaseDocumentDto, PurchaseDocumentStatus } from '../purchase/documents'
import type { PagedResult } from '../types'

/**
 * Shortage plans — saved planning documents.
 *
 * DRAFT → POSTED, AND NOTHING ELSE. A draft is a working sheet: edited, recalculated, deleted. A
 * posted plan is a HISTORICAL SNAPSHOT — the API never computes its figures again — and purchase
 * orders are created from it, carrying the Shortage No.
 *
 * THE FIGURES ARE NEVER SENT. A save carries the items and what the planner typed (required
 * quantity, a manual monthly sales figure, a PC per container); the server takes the live figures
 * itself, so what comes back is the truth and replaces whatever the page had computed meanwhile.
 */
const BASE = '/api/inventory/shortages'

export type ShortageDocumentStatus = 'Draft' | 'Posted'

/** The figures every shortage row carries, live or saved. Base units, except where a name says otherwise. */
export interface ShortageFigures {
  itemId: number
  itemCode: string
  itemName: string
  brandName: string
  familyName: string
  isBivac: boolean
  currentInventoryBase: number
  /** Marked as shipped on open purchase orders for the warehouse, not yet received. */
  transitBase: number
  /** Still to receive on open purchase orders, EXCLUDING what is already in transit. */
  outstandingOrderBase: number
  stockPlusTransitBase: number
  totalExpectedStockBase: number
  /** Sales of the last "months of history" ÷ months. The computed value, never the override. */
  expectedMonthlySalesBase: number
  leadTimeMonths: number
  expectedRequirementBase: number
  shortageBase: number
  /** Null when nothing sells: a coverage in months has no meaning then. */
  coverageMonths: number | null
  purchaseItemUnitId: number
  purchaseUnitName: string
  purchasePackingFormula: number
  pcPerContainer: number | null
  containerRequirement: number | null
  minQuantity: number | null
  maxQuantity: number | null
  lastCost: number | null
}

/** One LIVE row of `calculate` — what "Load items" offers to a draft. */
export interface ShortageLiveRowDto extends ShortageFigures {
  soldInPeriodBase: number
  monthsOfHistory: number
  /** The shortage rounded up to whole purchase units — the default Required Qty of a new line. */
  suggestedRequiredQty: number
  averageCost: number | null
  leadTimeDays: number | null
  /** The default supplier, else the last one the item was bought from. */
  supplierId: number | null
  supplierName: string | null
  supplierIsDefault: boolean
}

export interface ShortageDocumentLineDto extends ShortageFigures {
  id: number
  lineNo: number
  expectedMonthlySalesManual: number | null
  effectiveMonthlySales: number
  /** Purchase units. */
  requiredQty: number
  requiredBase: number
  notes: string | null
}

export interface ShortagePurchaseOrderDto {
  id: number
  documentNumber: string | null
  documentDate: string
  status: PurchaseDocumentStatus
  totalAmount: number
  currencyCode: string
  createdAtUtc: string
}

export interface ShortageDocumentAuditDto {
  id: number
  /** Created | Updated | Recalculated | Posted | POCreated */
  action: string
  details: string | null
  userId: number | null
  userName: string | null
  atUtc: string
}

export interface ShortageDocumentListDto {
  id: number
  documentNumber: string
  description: string
  documentDate: string
  branchId: number
  branchName: string
  warehouseId: number
  warehouseName: string
  supplierId: number
  supplierCode: string
  supplierName: string
  leadTimeMonths: number
  monthsOfHistory: number
  status: ShortageDocumentStatus
  totalLines: number
  totalShortageBase: number
  totalRequiredBase: number
  totalContainers: number
  containersRounded: number
  /** Purchase orders created from the plan, cancelled ones not counted. */
  purchaseOrders: number
  postedAtUtc: string | null
  postedByName: string | null
  createdAtUtc: string
  createdBy: number | null
  createdByName: string | null
  updatedAtUtc: string | null
  rowVersion: string
  canEdit: boolean
  canDelete: boolean
}

export interface ShortageDocumentDto {
  id: number
  documentNumber: string
  description: string
  documentDate: string
  branchId: number
  branchCode: string
  branchName: string
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  supplierId: number
  supplierCode: string
  supplierName: string
  leadTimeMonths: number
  monthsOfHistory: number
  notes: string | null
  status: ShortageDocumentStatus
  totalLines: number
  totalShortageBase: number
  totalRequiredBase: number
  /** The sum of the lines' container requirements, e.g. 7.35. */
  totalContainers: number
  /** That sum rounded up: 8. */
  containersRounded: number
  /** 7.35 ÷ 8 = 91.88. Null when no line has a container requirement. */
  containerUtilizationPct: number | null
  calculatedAtUtc: string | null
  postedAtUtc: string | null
  postedBy: number | null
  postedByName: string | null
  createdAtUtc: string
  createdBy: number | null
  createdByName: string | null
  updatedAtUtc: string | null
  updatedBy: number | null
  updatedByName: string | null
  rowVersion: string
  canEdit: boolean
  canRecalculate: boolean
  canPost: boolean
  canDelete: boolean
  canCreatePurchaseOrder: boolean
  lines: ShortageDocumentLineDto[]
  purchaseOrders: ShortagePurchaseOrderDto[]
  audit: ShortageDocumentAuditDto[]
}

export interface SaveShortageDocumentLine {
  lineNo: number
  itemId: number
  /** Purchase units. Null = the suggested quantity (the shortage rounded up). */
  requiredQty: number | null
  /** Null = the computed monthly sales. */
  expectedMonthlySalesManual: number | null
  /** Null = the item's own PC per container. */
  pcPerContainer: number | null
  notes: string | null
}

export interface SaveShortageDocumentRequest {
  description: string
  documentDate: string
  branchId: number
  warehouseId: number
  supplierId: number
  leadTimeMonths: number
  monthsOfHistory: number
  notes: string | null
  lines: SaveShortageDocumentLine[]
  rowVersion?: string | null
}

export interface ShortageCalculateQuery {
  warehouseId: number
  supplierId?: number
  leadTimeMonths: number
  monthsOfHistory: number
  itemFamilyId?: number
  brandId?: number
  search?: string
  onlyShortages: boolean
}

export interface ShortageDocumentQuery {
  search?: string
  warehouseId?: number
  branchId?: number
  supplierId?: number
  status?: ShortageDocumentStatus
  createdBy?: number
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export const shortagesApi = {
  /** The LIVE rows of one warehouse. Not paged: the drawer shows them all and the reader ticks. */
  calculate: (query: ShortageCalculateQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams({
      warehouseId: String(query.warehouseId),
      leadTimeMonths: String(query.leadTimeMonths),
      monthsOfHistory: String(query.monthsOfHistory),
      onlyShortages: String(query.onlyShortages),
    })
    if (query.supplierId !== undefined) params.set('supplierId', String(query.supplierId))
    if (query.itemFamilyId !== undefined) params.set('itemFamilyId', String(query.itemFamilyId))
    if (query.brandId !== undefined) params.set('brandId', String(query.brandId))
    if (query.search?.trim()) params.set('search', query.search.trim())
    return request<ShortageLiveRowDto[]>(`${BASE}/calculate?${params.toString()}`, { signal })
  },

  list: (query: ShortageDocumentQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.warehouseId !== undefined) params.set('warehouseId', String(query.warehouseId))
    if (query.branchId !== undefined) params.set('branchId', String(query.branchId))
    if (query.supplierId !== undefined) params.set('supplierId', String(query.supplierId))
    if (query.status) params.set('status', query.status)
    if (query.createdBy !== undefined) params.set('createdBy', String(query.createdBy))
    if (query.dateFrom) params.set('dateFrom', query.dateFrom)
    if (query.dateTo) params.set('dateTo', query.dateTo)
    if (query.sortBy) params.set('sortBy', query.sortBy)
    if (query.sortDir) params.set('sortDir', query.sortDir)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    return request<PagedResult<ShortageDocumentListDto>>(`${BASE}?${params.toString()}`, { signal })
  },

  get: (id: number) => request<ShortageDocumentDto>(`${BASE}/${id}`),

  create: (payload: SaveShortageDocumentRequest) => request<ShortageDocumentDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveShortageDocumentRequest) =>
    request<ShortageDocumentDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  /** Draft only: the live figures again; what was typed is kept. */
  recalculate: (id: number, rowVersion: string | null) =>
    request<ShortageDocumentDto>(`${BASE}/${id}/recalculate`, { method: 'POST', body: { rowVersion } }),

  post: (id: number, rowVersion: string | null) =>
    request<ShortageDocumentDto>(`${BASE}/${id}/post`, { method: 'POST', body: { rowVersion } }),

  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  /** Posted only: one purchase order draft for the plan's supplier, branch and warehouse. Needs purchase.orders.create. */
  createPurchaseOrder: (id: number, payload: { documentDate?: string | null; expectedDate?: string | null } = {}) =>
    request<PurchaseDocumentDto>(`${BASE}/${id}/create-purchase-order`, { method: 'POST', body: payload }),

  exportToExcel: async (id: number, documentNumber: string) =>
    save(await fetchBlob(`${BASE}/${id}/export`), `Shortage_${documentNumber}.xlsx`),
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
