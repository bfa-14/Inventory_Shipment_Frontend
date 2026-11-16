import { fetchBlob, request } from '../http'

/**
 * Reports › Item Balance Report by Warehouse (script 103): each item in each warehouse - the opening on Date From, one
 * quantity and amount per kind of movement in the period, the closing on Date To - at the company's average cost, in the
 * base currency or translated into another one.
 *
 * Quantities are in the item's base unit and SIGNED (out is negative). Every amount is null for a reader without View
 * item costs (`seesAmounts` false): the page then draws quantities only. The warehouses are the reader's own.
 */
const BASE = '/api/reports/item-balance'

export interface ItemBalanceQuery {
  /** Empty = every warehouse the reader may use; a parent takes every warehouse under it. */
  warehouseIds: number[]
  /** yyyy-MM-dd, inclusive. */
  dateFrom: string
  dateTo: string
  /** Null = the base currency. */
  currencyId: number | null
  /** 1 Official, 2 Non-official, 3 Market. */
  rateType: number
  itemIds: number[]
  familyIds: number[]
  showZeroBalance: boolean
  hideEmptyColumns: boolean
}

export interface ItemBalanceWarehouseDto {
  id: number
  warehouseCode: string
  warehouseName: string
  parentId: number | null
  level: number
  isTransit: boolean
  isActive: boolean
  branchCode: string
  hasChildren: boolean
}

/** A kind of movement: In / Out add to Total in / Total out; Value (ADJ, cost adjustments) is an amount without quantity. */
export interface ItemBalanceGroupDto {
  code: string
  label: string
  direction: 'In' | 'Out' | 'Value'
  hasActivity: boolean
}

export interface ItemBalanceCellDto {
  quantity: number
  amount: number | null
}

export interface ItemBalanceRowDto {
  itemId: number
  itemCode: string
  itemName: string
  unit: string | null
  familyName: string | null
  /** The warehouse the stock is in (the drill-down's key), shown as its top warehouse and, under it, its location. */
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  locationCode: string | null
  locationName: string | null
  isTransit: boolean
  openingQuantity: number
  openingAmount: number | null
  /** By group code; only the groups the row moved in. */
  movements: Record<string, ItemBalanceCellDto>
  totalInQuantity: number
  totalInAmount: number | null
  totalOutQuantity: number
  totalOutAmount: number | null
  averageCostChange: number | null
  closingQuantity: number
  closingAmount: number | null
  unitCost: number | null
  translationDifference: number | null
  isNegative: boolean
  integrityOk: boolean
  ledgerQuantity: number
}

export interface ItemBalanceTotalsDto {
  openingQuantity: number
  openingAmount: number | null
  movements: Record<string, ItemBalanceCellDto>
  totalInQuantity: number
  totalInAmount: number | null
  totalOutQuantity: number
  totalOutAmount: number | null
  averageCostChange: number | null
  closingQuantity: number
  closingAmount: number | null
  translationDifference: number | null
}

export interface ItemBalanceRateDto {
  /** The day the rate is for (Date From − 1, Date To) and the day of the rate in force then. */
  asOf: string
  rateDate: string | null
  rate: number
}

export interface ItemBalanceReportResult {
  dateFrom: string
  dateTo: string
  seesAmounts: boolean
  currency: { id: number; currencyCode: string; currencyName: string; decimalPlaces: number; isBaseCurrency: boolean } | null
  rateType: number | null
  rateTypeName: string | null
  openingRate: ItemBalanceRateDto | null
  closingRate: ItemBalanceRateDto | null
  warehousesLabel: string
  itemsLabel: string | null
  groups: ItemBalanceGroupDto[]
  rows: ItemBalanceRowDto[]
  totals: ItemBalanceTotalsDto
  integrityFailures: number
  negativeRows: number
  roundingNotes: string[]
  generatedAtUtc: string
  generatedBy: string
}

export interface ItemBalanceMovementDto {
  eventAt: string
  groupCode: string
  groupLabel: string
  documentTypeCode: string | null
  documentId: number | null
  documentNumber: string | null
  transferOrderId: number | null
  quantity: number
  unitCost: number | null
  amount: number | null
}

export interface ItemBalanceMovementsResult {
  itemCode: string
  itemName: string
  warehouseCode: string
  warehouseName: string
  currencyCode: string | null
  movements: ItemBalanceMovementDto[]
}

/** The query in the address: the print page and a shared link read it back with {@link queryFromParams}. */
export function toParams(query: ItemBalanceQuery): URLSearchParams {
  const params = new URLSearchParams()
  for (const id of query.warehouseIds) params.append('warehouseIds', String(id))
  params.set('dateFrom', query.dateFrom)
  params.set('dateTo', query.dateTo)
  if (query.currencyId !== null) params.set('currencyId', String(query.currencyId))
  params.set('rateType', String(query.rateType))
  for (const id of query.itemIds) params.append('itemIds', String(id))
  for (const id of query.familyIds) params.append('familyIds', String(id))
  params.set('showZeroBalance', String(query.showZeroBalance))
  params.set('hideEmptyColumns', String(query.hideEmptyColumns))
  return params
}

export function queryFromParams(params: URLSearchParams): ItemBalanceQuery | null {
  const dateFrom = params.get('dateFrom')
  const dateTo = params.get('dateTo')
  if (!dateFrom || !dateTo) return null
  const ids = (key: string) => params.getAll(key).map(Number).filter((n) => Number.isInteger(n) && n > 0)
  const currency = Number(params.get('currencyId'))
  return {
    warehouseIds: ids('warehouseIds'),
    dateFrom,
    dateTo,
    currencyId: Number.isInteger(currency) && currency > 0 ? currency : null,
    rateType: Number(params.get('rateType')) || 1,
    itemIds: ids('itemIds'),
    familyIds: ids('familyIds'),
    showZeroBalance: params.get('showZeroBalance') === 'true',
    hideEmptyColumns: params.get('hideEmptyColumns') !== 'false',
  }
}

export const itemBalanceApi = {
  /** `print`: asked by the print page, so the run log says Print. */
  report: (query: ItemBalanceQuery, signal?: AbortSignal, print = false) => {
    const params = toParams(query)
    if (print) params.set('print', 'true')
    return request<ItemBalanceReportResult>(`${BASE}?${params.toString()}`, { signal })
  },

  warehouses: (signal?: AbortSignal) => request<ItemBalanceWarehouseDto[]>(`${BASE}/warehouses`, { signal }),

  movements: (
    query: ItemBalanceQuery,
    cell: { itemId: number; warehouseId: number; group: string | null },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({
      itemId: String(cell.itemId),
      warehouseId: String(cell.warehouseId),
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      rateType: String(query.rateType),
    })
    if (cell.group) params.set('group', cell.group)
    if (query.currencyId !== null) params.set('currencyId', String(query.currencyId))
    return request<ItemBalanceMovementsResult>(`${BASE}/movements?${params.toString()}`, { signal })
  },

  exportToExcel: async (query: ItemBalanceQuery) => {
    const blob = await fetchBlob(`${BASE}/export?${toParams(query).toString()}`)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ItemBalance_${query.dateFrom.replaceAll('-', '')}-${query.dateTo.replaceAll('-', '')}.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  },
}
