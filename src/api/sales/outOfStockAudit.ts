import { request } from '../http'
import type { PagedResult } from '../types'

/**
 * The log of out-of-stock sales: every time a user confirmed selling more than a warehouse held.
 * Written by the invoice post itself; this is read-only. Needs `sales.outofstockaudit.view`.
 */
const BASE = '/api/sales/out-of-stock-audit'

export interface OutOfStockAuditDto {
  id: number
  salesDocumentId: number
  documentNumber: string
  itemId: number
  itemCode: string
  itemName: string
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  /** Base units the invoice took from this warehouse. */
  quantitySold: number
  /** What the warehouse held before the invoice. */
  stockBefore: number
  /** What it held right after; negative when the sale took it below zero. */
  inventoryAfter: number
  soldAtUtc: string
  userId: number | null
  userName: string | null
  saleStatus: string
  /** Which level allowed the sale. */
  policySource: 'Warehouse' | 'Global'
  /** The invoice as it stands now: Posted, or Cancelled if it was undone afterwards. */
  invoiceStatus: 'Posted' | 'Cancelled' | 'Draft' | 'Unknown'
}

export interface OutOfStockAuditQuery {
  search?: string
  warehouseId?: number
  /** ISO dates (yyyy-MM-dd), inclusive: the day the sale was confirmed. */
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

export const outOfStockAuditApi = {
  list: (query: OutOfStockAuditQuery = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.warehouseId !== undefined) params.set('warehouseId', String(query.warehouseId))
    if (query.dateFrom) params.set('dateFrom', query.dateFrom)
    if (query.dateTo) params.set('dateTo', query.dateTo)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    const qs = params.toString()
    return request<PagedResult<OutOfStockAuditDto>>(`${BASE}${qs ? `?${qs}` : ''}`, { signal })
  },
}
