import { fetchBlob, request } from '../http'
import type { ContainerReportRowDto } from '../logistics/containerReport'

/**
 * Reports › Dispatched Items (script 106): the items dispatched in a period - from India by default - as the item
 * balance and as the items / containers. Its rows are the Container Report's, by dispatch date.
 *
 * Amounts in the base currency. The oil deduction is null for a reader without View Container Charges
 * (`deductionVisible` false), the payment columns without View Supplier Payments (`paymentsVisible` false).
 */
const BASE = '/api/reports/dispatched-items'

export type DispatchedLocation = 'AtSea' | 'AtPort' | 'OnTheRoad' | 'Offloaded'
export type LocationFilter = 'All' | DispatchedLocation

export const LOCATION_TEXT: Record<DispatchedLocation, string> = {
  AtSea: 'At sea',
  AtPort: 'At port',
  OnTheRoad: 'On the road',
  Offloaded: 'Offloaded',
}

export interface DispatchedItemsQuery {
  /** yyyy-MM-dd, inclusive; both required. */
  dispatchFrom: string
  dispatchTo: string
  /** "IN"; empty = any country. */
  loadingCountry: string
  supplierId: number | null
  itemFamilyId: number | null
  itemId: number | null
  search: string
  location: LocationFilter
}

/** A Container Report row with what script 106 added to it. */
export interface DispatchedRowDto extends ContainerReportRowDto {
  oilIncluded: boolean | null
  /** The oil typed on the container line; null when none. */
  totalOilQty: number | null
  itemFamilyName: string | null
  /** "Main Items" (the vehicles), "Maintenance and Accessories". */
  rootFamilyName: string | null
  loadingCountry: string | null
  /** Its share of the oil deduction, positive; null without View Container Charges or when none. */
  deductionBase: number | null
}

export interface DispatchedItemDto {
  itemId: number
  itemCode: string
  itemName: string
  itemFamilyName: string | null
  rootFamilyName: string | null
  containers: number
  quantity: number
  fobAmountBase: number
  fobIsEstimate: boolean
  fobPerUnitBase: number | null
  oilQty: number | null
  oilIncludedLines: number
  deductionBase: number | null
  atSea: number
  atPort: number
  onTheRoad: number
  offloaded: number
}

export interface DispatchedFamilyTotalDto {
  rootFamilyName: string
  containers: number
  quantity: number
  fobAmountBase: number
  deductionBase: number | null
}

export interface DispatchedItemsReportResult {
  dispatchFrom: string
  dispatchTo: string
  loadingCountry: string | null
  items: DispatchedItemDto[]
  families: DispatchedFamilyTotalDto[]
  totals: {
    containers: number
    fobAmountBase: number
    oilQty: number | null
    deductionBase: number | null
    containersAtSea: number
    containersAtPort: number
    containersOnTheRoad: number
    containersOffloaded: number
  }
  rows: DispatchedRowDto[]
  /** Each row's place now, by rowKey. */
  locations: Record<string, DispatchedLocation>
  /** "OIL Deduction / refund"; null when no deduction type exists. */
  deductionName: string | null
  deductionVisible: boolean
  paymentsVisible: boolean
  baseCurrencyCode: string
  generatedAtUtc: string
  generatedBy: string
}

export function toParams(query: DispatchedItemsQuery): URLSearchParams {
  const params = new URLSearchParams()
  params.set('dispatchFrom', query.dispatchFrom)
  params.set('dispatchTo', query.dispatchTo)
  // Always sent, empty included: an empty country is "any", not "the default India".
  params.set('loadingCountry', query.loadingCountry)
  if (query.supplierId !== null) params.set('supplierId', String(query.supplierId))
  if (query.itemFamilyId !== null) params.set('itemFamilyId', String(query.itemFamilyId))
  if (query.itemId !== null) params.set('itemId', String(query.itemId))
  if (query.search.trim()) params.set('search', query.search.trim())
  if (query.location !== 'All') params.set('location', query.location)
  return params
}

const positive = (value: string | null) => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** The query in the address (a refresh or a shared link reruns it); null until both dates are there. */
export function queryFromParams(params: URLSearchParams): DispatchedItemsQuery | null {
  const dispatchFrom = params.get('dispatchFrom') ?? ''
  const dispatchTo = params.get('dispatchTo') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dispatchFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dispatchTo)) return null
  const location = params.get('location')
  return {
    dispatchFrom,
    dispatchTo,
    loadingCountry: params.get('loadingCountry') ?? 'IN',
    supplierId: positive(params.get('supplierId')),
    itemFamilyId: positive(params.get('itemFamilyId')),
    itemId: positive(params.get('itemId')),
    search: params.get('search') ?? '',
    location: location === 'AtSea' || location === 'AtPort' || location === 'OnTheRoad' || location === 'Offloaded' ? location : 'All',
  }
}

export const dispatchedItemsReportApi = {
  report: (query: DispatchedItemsQuery, signal?: AbortSignal) =>
    request<DispatchedItemsReportResult>(`${BASE}?${toParams(query).toString()}`, { signal }),

  exportToExcel: async (query: DispatchedItemsQuery) => {
    const blob = await fetchBlob(`${BASE}/export?${toParams(query).toString()}`)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `DispatchedItems_${query.dispatchFrom.replaceAll('-', '')}-${query.dispatchTo.replaceAll('-', '')}.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  },
}
