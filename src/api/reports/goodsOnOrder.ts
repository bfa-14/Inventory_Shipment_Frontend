import { fetchBlob, request } from '../http'
import type { ContainerReportRowDto } from '../logistics/containerReport'

/**
 * Reports › Goods on Order (script 109): everything ordered and not received yet, one row per item, one Qty / Containers
 * pair per STAGE the goods are at now. The stages come from the containers' movements (the Container Report's stage), so
 * the columns follow the journey the containers really make; every order month of "Order pending" is one column.
 */
const BASE = '/api/reports/goods-on-order'

export interface GoodsOnOrderQuery {
  supplierId: number | null
  itemFamilyId: number | null
  itemId: number | null
  branchId: number | null
  /** yyyy-MM-dd: orders dated up to this day only; empty = every order. */
  orderDateTo: string
  search: string
}

export type GoodsOnOrderStageKind = 'Pending' | 'AtSea' | 'AtPort' | 'OnTheRoad' | 'AtPlace' | 'Delivered' | 'Other'

export interface GoodsOnOrderStageDto {
  /** "Pending", else the stage's label: the key of the cells. */
  key: string
  label: string
  sort: number
  kind: GoodsOnOrderStageKind
}

export interface GoodsOnOrderCellDto {
  quantity: number
  /** Containers carrying them; a container of two items counts in each item, once in a total. */
  containers: number
  /** Pieces on an order line, on no container yet. */
  piecesNotLoaded: number
  /** Their containers estimated from the item's container unit; null when there are none. */
  estimatedContainers: number | null
  /** Some of those pieces belong to an item without a container unit: their containers are unknown. */
  estimateIncomplete: boolean
}

export interface GoodsOnOrderItemDto {
  itemId: number
  itemCode: string
  itemName: string
  rootFamilyName: string | null
  pcsPerContainer: number | null
  cells: Record<string, GoodsOnOrderCellDto>
  total: GoodsOnOrderCellDto
}

export interface GoodsOnOrderFamilyDto {
  rootFamilyName: string
  cells: Record<string, GoodsOnOrderCellDto>
  total: GoodsOnOrderCellDto
}

export interface GoodsOnOrderReportResult {
  stages: GoodsOnOrderStageDto[]
  items: GoodsOnOrderItemDto[]
  families: GoodsOnOrderFamilyDto[]
  totals: Record<string, GoodsOnOrderCellDto>
  grandTotal: GoodsOnOrderCellDto
  /** The Container Report's rows behind the figures (the drill-down). */
  rows: (ContainerReportRowDto & { rootFamilyName: string | null })[]
  /** Each row's stage key, by rowKey. */
  stageKeys: Record<string, string>
  generatedAtUtc: string
  generatedBy: string
}

export function toParams(query: GoodsOnOrderQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.supplierId !== null) params.set('supplierId', String(query.supplierId))
  if (query.itemFamilyId !== null) params.set('itemFamilyId', String(query.itemFamilyId))
  if (query.itemId !== null) params.set('itemId', String(query.itemId))
  if (query.branchId !== null) params.set('branchId', String(query.branchId))
  if (query.orderDateTo) params.set('orderDateTo', query.orderDateTo)
  if (query.search.trim()) params.set('search', query.search.trim())
  return params
}

export const goodsOnOrderReportApi = {
  report: (query: GoodsOnOrderQuery, signal?: AbortSignal) =>
    request<GoodsOnOrderReportResult>(`${BASE}?${toParams(query).toString()}`, { signal }),

  exportToExcel: async (query: GoodsOnOrderQuery) => {
    const blob = await fetchBlob(`${BASE}/export?${toParams(query).toString()}`)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `GoodsOnOrder_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  },
}
