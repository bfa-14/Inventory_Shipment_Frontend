import { fetchBlob, request } from '../http'

/**
 * What the stock is worth: on hand × the item's moving average cost.
 *
 * THE AVERAGE IS THE ITEM'S, not the warehouse's — one moving average is kept per item, and a sale
 * out of any warehouse is costed at it. A warehouse view is that warehouse's quantities at the
 * same average.
 */
const BASE = '/api/inventory/valuation'

export interface InventoryValuationRowDto {
  itemId: number
  itemCode: string
  itemName: string
  /** Null on the company-wide view. */
  warehouseId: number | null
  warehouseCode: string | null
  warehouseName: string | null
  onHandBase: number
  averageCost: number | null
  inventoryValue: number
}

export interface InventoryValuationResult {
  items: InventoryValuationRowDto[]
  /** Items with stock on hand; a zero-stock item is listed but is not a line of inventory. */
  itemsWithStock: number
  totalOnHandBase: number
  totalInventoryValue: number
  warehouseId: number | null
  warehouseName: string | null
}

export const inventoryValuationApi = {
  get: (warehouseId?: number, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (warehouseId !== undefined) params.set('warehouseId', String(warehouseId))
    return request<InventoryValuationResult>(`${BASE}?${params.toString()}`, { signal })
  },

  exportToExcel: async (warehouseId?: number) => {
    const params = new URLSearchParams()
    if (warehouseId !== undefined) params.set('warehouseId', String(warehouseId))
    save(await fetchBlob(`${BASE}/export?${params.toString()}`), 'StockValuation.xlsx')
  },
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
