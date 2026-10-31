import { fetchBlob, request } from '../http'

/**
 * Reports › Container Report (script 95): every container line and every approved order line still to load, with its
 * order, invoices, payments, journey, charges and cost, grouped by where the goods are now - the purchasing team's
 * tracking sheet, worked out by the system.
 *
 * AMOUNTS ARE IN THE BASE CURRENCY. A figure the reader may not see is null (never 0) and its columns are left out:
 * the charges without View Container Charges (`chargesVisible`), the payments without View Supplier Payments
 * (`paymentsVisible`).
 */
const BASE = '/api/logistics/container-report'

export interface ContainerReportRowDto {
  /** "C{container line id}" or "P{order line id}" (an order line still to load). */
  rowKey: string
  isPending: boolean
  /** Orders the stages the way the tracking sheet reads them: pending (newest month first) … offloaded. */
  stageSort: number
  /** "Order pending - November 2026", "In transit India → Dar es Salaam", "Dar es Salaam → Mokambo", "Offloaded in Lubumbashi". */
  stageLabel: string
  orderDate: string
  purchaseOrderId: number
  poNumber: string | null
  /** "Sep-25". */
  orderMonth: string | null
  invoiceDate: string | null
  invoiceDates: string | null
  invoiceNumbers: string | null
  commercialInvoiceNos: string | null
  exporterReferences: string | null
  containerId: number | null
  containerRef: string | null
  containerNo: string | null
  containerStatus: number | null
  /** Draft … Closed; "Not loaded" for an order line still to load. */
  statusName: string
  itemId: number
  itemCode: string
  /** The item's name: the sheet's MODEL. */
  model: string
  quantity: number
  /** The order's supplier reference. */
  piNumber: string | null
  supplierId: number
  supplierName: string | null
  branchName: string | null
  warehouseCode: string | null
  fobAmountBase: number | null
  fobIsEstimate: boolean
  oilQtyPerUnit: number | null
  paidDates: string | null
  paymentReferences: string | null
  /** Paid, Partly paid, Not paid, Not invoiced. */
  paymentStatus: string | null
  dispatchDate: string | null
  arrivedPortDate: string | null
  leftPortDate: string | null
  /** "Mokambo → Lubumbashi". */
  finalDestination: string | null
  trucks: string | null
  offloadedDate: string | null
  goodsReceiptNumbers: string | null
  leadTimeMonths: number | null
  /** Not offloaded yet: the lead time is counted to today. */
  leadTimeSoFar: boolean
  blNo: string | null
  feriNo: string | null
  transportReferences: string | null
  /** "05/11/2025 · 2500323 · 10,000.00; …": the container's transport invoices. */
  transportInvoices: string | null
  transportBase: number | null
  chargesBase: number | null
  /** The line's share of the posted charges, by charge type id. */
  charges: Record<string, number> | null
  totalExpensesBase: number | null
  costPerUnitBase: number | null
  costIsEstimate: boolean
  isLate: boolean
  isFreeTimeOver: boolean
  /** Late, Free time over, Not invoiced, Not paid, Partly paid, No container no., No B/L. */
  alerts: string[]
}

export interface ContainerReportChargeTypeDto {
  id: number
  chargeCode: string
  chargeName: string
  isTransport: boolean
}

export interface ContainerReportResult {
  rows: ContainerReportRowDto[]
  /** One column each: the charge types the rows carry, the transport ones excepted. */
  chargeTypes: ContainerReportChargeTypeDto[]
  chargesVisible: boolean
  paymentsVisible: boolean
}

export interface ContainerReportQuery {
  search?: string
  supplierId?: number
  itemId?: number
  itemFamilyId?: number
  branchId?: number
  orderDateFrom?: string
  orderDateTo?: string
  /** Narrow the received containers only. */
  offloadedFrom?: string
  offloadedTo?: string
  includePending: boolean
  includeReceived: boolean
}

function toParams(query: ContainerReportQuery): URLSearchParams {
  const params = new URLSearchParams({
    includePending: String(query.includePending),
    includeReceived: String(query.includeReceived),
  })
  if (query.search) params.set('search', query.search)
  if (query.supplierId !== undefined) params.set('supplierId', String(query.supplierId))
  if (query.itemId !== undefined) params.set('itemId', String(query.itemId))
  if (query.itemFamilyId !== undefined) params.set('itemFamilyId', String(query.itemFamilyId))
  if (query.branchId !== undefined) params.set('branchId', String(query.branchId))
  if (query.orderDateFrom) params.set('orderDateFrom', query.orderDateFrom)
  if (query.orderDateTo) params.set('orderDateTo', query.orderDateTo)
  if (query.offloadedFrom) params.set('offloadedFrom', query.offloadedFrom)
  if (query.offloadedTo) params.set('offloadedTo', query.offloadedTo)
  return params
}

export const containerReportApi = {
  report: (query: ContainerReportQuery, signal?: AbortSignal) =>
    request<ContainerReportResult>(`${BASE}?${toParams(query).toString()}`, { signal }),

  exportToExcel: async (query: ContainerReportQuery) =>
    save(await fetchBlob(`${BASE}/export?${toParams(query).toString()}`), 'ContainerReport.xlsx'),
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
