import { fetchBlob, request } from '../http'

/**
 * What selling the goods earned: net sales less the cost frozen on each line when it was posted.
 *
 * EVERY FIGURE IS FROZEN, not recomputed — a report run today and the same report next year agree.
 * Behind `sales.profit.view`: a price is everybody's business, a margin is not.
 */
const BASE = '/api/sales/profit'

export type SalesProfitGrouping =
  | 'Invoice' | 'Item' | 'Family' | 'Brand' | 'Client' | 'Salesman' | 'Branch' | 'Month' | 'All'

export const SALES_PROFIT_GROUPINGS: SalesProfitGrouping[] =
  ['Invoice', 'Item', 'Family', 'Brand', 'Client', 'Salesman', 'Branch', 'Month', 'All']

/** The groupings a landed cost adjustment can be attributed to: it knows its item and its date, never its invoice. */
const GROUPINGS_WITH_ADJUSTMENTS = new Set<SalesProfitGrouping>(['All', 'Month', 'Branch', 'Item', 'Family', 'Brand'])

export const showsCogsAdjustments = (grouping: SalesProfitGrouping) => GROUPINGS_WITH_ADJUSTMENTS.has(grouping)

export interface SalesProfitRowDto {
  /** The identity of the group (an id, a month "2026-09", or "ALL"). The label is for reading. */
  groupKey: string
  groupLabel: string
  invoiceCount: number
  returnCount: number
  quantityBase: number
  grossSalesBase: number
  discountBase: number
  netSalesBase: number
  cogsBase: number
  grossProfitBase: number
  /** On net sales. Null when nothing was sold in the group. */
  grossProfitPct: number | null
  /** Cost of sales that belongs to no invoice: the already-sold part of a landed cost adjustment. */
  cogsAdjustmentsBase: number
}

export interface SalesProfitQuery {
  dateFrom?: string
  dateTo?: string
  branchId?: number
  clientId?: number
  salesmanId?: number
  itemFamilyId?: number
  brandId?: number
  itemId?: number
  groupBy: SalesProfitGrouping
}

function toParams(query: SalesProfitQuery): URLSearchParams {
  const params = new URLSearchParams({ groupBy: query.groupBy })
  if (query.dateFrom) params.set('dateFrom', query.dateFrom)
  if (query.dateTo) params.set('dateTo', query.dateTo)
  if (query.branchId !== undefined) params.set('branchId', String(query.branchId))
  if (query.clientId !== undefined) params.set('clientId', String(query.clientId))
  if (query.salesmanId !== undefined) params.set('salesmanId', String(query.salesmanId))
  if (query.itemFamilyId !== undefined) params.set('itemFamilyId', String(query.itemFamilyId))
  if (query.brandId !== undefined) params.set('brandId', String(query.brandId))
  if (query.itemId !== undefined) params.set('itemId', String(query.itemId))
  return params
}

export const salesProfitApi = {
  report: (query: SalesProfitQuery, signal?: AbortSignal) =>
    request<SalesProfitRowDto[]>(`${BASE}?${toParams(query).toString()}`, { signal }),

  exportToExcel: async (query: SalesProfitQuery) =>
    save(await fetchBlob(`${BASE}/export?${toParams(query).toString()}`), `SalesProfit_${query.groupBy}.xlsx`),
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
