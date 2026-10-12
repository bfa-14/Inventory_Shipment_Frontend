import { request } from './http'

/** The Dashboard's figures. A section is null when the reader may not open the screen it comes from. */
export interface DashboardSummaryDto {
  from: string
  to: string
  prevFrom: string
  prevTo: string
  today: string
  baseCurrencyCode: string | null
  sales: {
    salesBase: number
    grossProfitBase: number | null
    invoiceCount: number
    prevSalesBase: number
    prevGrossProfitBase: number | null
  } | null
  receivables: { outstandingBase: number; overdueBase: number; openCount: number; overdueCount: number } | null
  payables: {
    invoicesBase: number | null
    invoiceCount: number | null
    chargesBase: number | null
    chargeCount: number | null
  } | null
  inventory: { valueBase: number; itemsInStock: number } | null
  onTheWay: {
    /** The orders' still to receive, less the pieces in containers (inTransitPieces); with them when that one is null. */
    onOrderPieces: number | null
    openOrders: number | null
    /** Posted invoices without an order whose goods are not received yet (script 72). */
    invoicedNotReceivedPieces?: number | null
    inTransitPieces: number | null
    containersInTransit: number | null
  } | null
  drafts: { kind: string; typeCode: string; draftCount: number }[]
  stockAlerts: { belowMinimum: number; negativeStock: number; outOfStockSales: number | null } | null
  belowMinimum: { itemId: number; itemCode: string; itemName: string; onHand: number; minQuantity: number; missing: number }[] | null
  containers: { arrivingSoon: number; atPort: number; nearLastFreeDay: number } | null
  containerList: {
    containerId: number
    containerRef: string
    containerNo: string | null
    statusCode: number
    eta: string | null
    lastFreeDay: string | null
    reason: 'ArrivingSoon' | 'AtPort' | 'NearLastFreeDay' | 'PastLastFreeDay'
  }[] | null
  overdueInvoices: {
    documentId: number
    documentNumber: string | null
    clientName: string
    dueDate: string | null
    daysOverdue: number
    outstandingBase: number
  }[] | null
  cheques: { pendingCount: number; pendingBase: number; dueCount: number } | null
  chequeList: {
    paymentId: number
    paymentNumber: string | null
    payeeName: string
    chequeNo: string | null
    chequeDueDate: string | null
    amountBase: number
  }[] | null
  /** The twelve months ending with the period's month; a figure is null when the reader may not see it. */
  trend: { monthStart: string; salesBase: number | null; grossProfitBase: number | null; purchasesBase: number | null }[] | null
  salesByFamily: { label: string; valueBase: number }[] | null
  stockByWarehouse: { label: string; valueBase: number }[] | null
  /** dayNo 1 = Monday. */
  salesByWeekday: { dayNo: number; invoiceCount: number; salesBase: number }[] | null
}

export interface DashboardSummaryQuery {
  branchId: number | null
  from: string
  to: string
  prevFrom: string
  prevTo: string
  today: string
}

export const dashboardApi = {
  summary: (query: DashboardSummaryQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams({
      from: query.from,
      to: query.to,
      prevFrom: query.prevFrom,
      prevTo: query.prevTo,
      today: query.today,
    })
    if (query.branchId !== null) params.set('branchId', String(query.branchId))
    return request<DashboardSummaryDto>(`/api/dashboard/summary?${params}`, { signal })
  },
}
