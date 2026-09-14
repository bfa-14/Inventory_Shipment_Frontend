import { request } from '../http'

/** What one unit costs in one price list — or that the list has no price for it. */
export interface UnitPriceResolutionDto {
  itemUnitId: number
  priceListId: number
  /** Null when the list has no price for the unit: the line is shown red and the save is blocked. */
  price: number | null
  /** Branch | AllBranches — which row answered. */
  source: string | null
  currencyCode: string | null
  decimalPlaces: number | null
  branchName: string | null
}

export const unitPricesApi = {
  /** The branch price first, then the All Branches price. Answers 200 with a null price when there is none. */
  resolve: (itemUnitId: number, priceListId: number, branchId?: number | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ itemUnitId: String(itemUnitId), priceListId: String(priceListId) })
    if (branchId !== null && branchId !== undefined) params.set('branchId', String(branchId))
    return request<UnitPriceResolutionDto>(`/api/masterdata/unit-prices/resolve?${params.toString()}`, { signal })
  },
}
