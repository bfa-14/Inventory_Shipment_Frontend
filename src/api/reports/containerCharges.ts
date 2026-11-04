import { fetchBlob, request } from '../http'

/**
 * Reports › Container Charges (script 105): the containers offloaded or dispatched in a period and, per charge type
 * asked, whether the charge is entered on the container, its amount, what is paid of it and its payments - the
 * logistics team's "charge per CONTAINER" sheet.
 *
 * Amounts in the base currency. Every paid figure and payment status is null for a reader without View Supplier
 * Payments (`seesPayments` false): the page then draws the charges only.
 */
const BASE = '/api/reports/container-charges'

export type DateBasis = 'Offload' | 'Dispatch'
export type EnteredFilter = 'All' | 'Entered' | 'Missing'
export type PaymentFilter = 'All' | 'Paid' | 'PartlyPaid' | 'Unpaid'
export type ChargeCellStatus = 'Entered' | 'Draft' | 'Missing'
export type ChargePaymentStatus = 'Paid' | 'PartlyPaid' | 'Unpaid' | 'NotPayable'

export interface ContainerChargeQuery {
  /** In the order of the column groups; at least one. */
  chargeTypeIds: number[]
  dateBasis: DateBasis
  /** yyyy-MM-dd, inclusive; empty = no bound. */
  dateFrom: string
  dateTo: string
  search: string
  supplierId: number | null
  entered: EnteredFilter
  payment: PaymentFilter
}

export interface ContainerChargeTypeDto {
  id: number
  chargeCode: string
  chargeName: string
  isDeduction: boolean
  isActive: boolean
}

export interface ContainerChargeOptions {
  chargeTypes: ContainerChargeTypeDto[]
  suppliers: { id: number; partyCode: string; partyName: string }[]
}

export interface ContainerChargeCellDto {
  status: ChargeCellStatus
  count: number
  amount: number | null
  paid: number | null
  balance: number | null
  paymentStatus: ChargePaymentStatus | null
  /** "EUR 1,200.00" when a charge is in another currency than the base. */
  original: string | null
}

export interface ContainerChargeRowDto {
  containerId: number
  containerRef: string
  containerNo: string | null
  blNo: string | null
  containerStatus: number
  items: string | null
  pieces: number
  suppliers: string | null
  orders: string | null
  finalDestination: string | null
  stageSort: number
  /** The current location, in the Container Report's words ("Offloaded in Lubumbashi", "In transit India → Dar es Salaam"). */
  stageLabel: string
  dispatchDate: string | null
  offloadedDate: string | null
  branchName: string | null
  warehouseName: string | null
  /** By charge type id. */
  charges: Record<string, ContainerChargeCellDto>
  amount: number
  paid: number | null
  balance: number | null
}

export interface ContainerChargeDetailDto {
  chargeId: number
  containerId: number
  chargeTypeId: number
  status: 'Draft' | 'Posted'
  chargeDate: string
  reference: string | null
  providerName: string | null
  currencyCode: string | null
  amount: number
  amountBase: number
  paidAmount: number | null
  paidBase: number | null
  /** "PAY-2026-0031 · 05/11/2026 · 1,200.00; …" in the charge's currency. */
  payments: string | null
  paymentStatus: ChargePaymentStatus | null
}

export interface ContainerChargeTypeTotalsDto {
  entered: number
  draft: number
  missing: number
  amount: number
  paid: number | null
  balance: number | null
}

export interface ContainerChargeReportResult {
  dateBasis: DateBasis
  dateFrom: string | null
  dateTo: string | null
  chargeTypes: ContainerChargeTypeDto[]
  rows: ContainerChargeRowDto[]
  charges: ContainerChargeDetailDto[]
  totals: {
    containers: number
    withMissing: number
    amount: number
    paid: number | null
    balance: number | null
    perType: Record<string, ContainerChargeTypeTotalsDto>
  }
  seesPayments: boolean
  baseCurrencyCode: string
  generatedAtUtc: string
  generatedBy: string
}

export function toParams(query: ContainerChargeQuery): URLSearchParams {
  const params = new URLSearchParams()
  for (const id of query.chargeTypeIds) params.append('chargeTypeIds', String(id))
  params.set('dateBasis', query.dateBasis)
  if (query.dateFrom) params.set('dateFrom', query.dateFrom)
  if (query.dateTo) params.set('dateTo', query.dateTo)
  if (query.search.trim()) params.set('search', query.search.trim())
  if (query.supplierId !== null) params.set('supplierId', String(query.supplierId))
  if (query.entered !== 'All') params.set('entered', query.entered)
  if (query.payment !== 'All') params.set('payment', query.payment)
  return params
}

/** The query in the address (a refresh or a shared link reruns it); null until a charge type is chosen. */
export function queryFromParams(params: URLSearchParams): ContainerChargeQuery | null {
  const chargeTypeIds = params.getAll('chargeTypeIds').map(Number).filter((n) => Number.isInteger(n) && n > 0)
  if (chargeTypeIds.length === 0) return null
  const supplier = Number(params.get('supplierId'))
  const entered = params.get('entered')
  const payment = params.get('payment')
  return {
    chargeTypeIds,
    dateBasis: params.get('dateBasis') === 'Dispatch' ? 'Dispatch' : 'Offload',
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
    search: params.get('search') ?? '',
    supplierId: Number.isInteger(supplier) && supplier > 0 ? supplier : null,
    entered: entered === 'Entered' || entered === 'Missing' ? entered : 'All',
    payment: payment === 'Paid' || payment === 'PartlyPaid' || payment === 'Unpaid' ? payment : 'All',
  }
}

export const containerChargesReportApi = {
  report: (query: ContainerChargeQuery, signal?: AbortSignal) =>
    request<ContainerChargeReportResult>(`${BASE}?${toParams(query).toString()}`, { signal }),

  options: (signal?: AbortSignal) => request<ContainerChargeOptions>(`${BASE}/options`, { signal }),

  exportToExcel: async (query: ContainerChargeQuery) => {
    const blob = await fetchBlob(`${BASE}/export?${toParams(query).toString()}`)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const period = query.dateFrom && query.dateTo ? `_${query.dateFrom.replaceAll('-', '')}-${query.dateTo.replaceAll('-', '')}` : ''
    link.download = `ContainerCharges${period}.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  },
}
