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
  /** (94) valueBase is null without View item costs (inventory.costs.view); the count stays. */
  inventory: { valueBase: number | null; itemsInStock: number } | null
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
  stockAlerts: {
    /** Items whose company stock is below Item Definition's Minimum Quantity (the company's, script 72). */
    belowMinimum: number
    negativeStock: number
    outOfStockSales: number | null
    /**
     * (91) "Warehouse levels below Min": stock levels per warehouse (active item, active warehouse) whose Projected is below
     * their Min - Stock Levels' "Below Min" tile for the same branch. Null without View Stock Levels, or from an older API.
     */
    belowWarehouseMin?: number | null
  } | null
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
  /** (94) Null without View item costs (stock at the average cost), as without View items. */
  stockByWarehouse: { label: string; valueBase: number }[] | null
  /** dayNo 1 = Monday. */
  salesByWeekday: { dayNo: number; invoiceCount: number; salesBase: number }[] | null

  /* (115) the cards; each is missing from an older API, null when the reader may not see it */
  /** Containers by shipment stage (script 111), in the stages' order. Null without View Containers. */
  containerStages?: DashboardStageDto[] | null
  /** What we owe by payment status: the invoice half or the charge half is null when the reader may not see it. */
  payablesDetail?: {
    unpaidInvoiceCount: number | null
    unpaidInvoicesBase: number | null
    partialInvoiceCount: number | null
    partialInvoicesBase: number | null
    unpaidChargeCount: number | null
    unpaidChargesBase: number | null
    partialChargeCount: number | null
    partialChargesBase: number | null
  } | null
  /** The five creditors owed the most, on the halves the reader may see (partyId null: charges without a provider). */
  creditors?: { partyId: number | null; partyName: string; invoicesBase: number; invoiceCount: number; chargesBase: number; chargeCount: number }[] | null
  /** What customers owe by days past the due date (on the reader's today). */
  receivablesAging?: {
    notDueCount: number
    notDueBase: number
    days1To30Count: number
    days1To30Base: number
    days31To60Count: number
    days31To60Base: number
    days61To90Count: number
    days61To90Base: number
    over90Count: number
    over90Base: number
    debtorCount: number
  } | null
  /** The five customers owing the most. */
  debtors?: { clientId: number; clientName: string; outstandingBase: number; overdueBase: number; invoiceCount: number; oldestDueDate: string | null }[] | null
  /** The twelve months to the period's end; each figure null when the reader may not see it. */
  purchasesByMonth?: {
    monthStart: string
    /** Supplier invoices less returns (View Purchase Invoices). */
    invoicedBase: number | null
    /** Posted goods receipts at their value at receipt (View Goods Receipts and View item costs). */
    receivedBase: number | null
    /** Their pieces (View Goods Receipts). */
    receivedPieces: number | null
    /** Container charges posted (View Container Charges). */
    chargesBase: number | null
  }[] | null
}

/**
 * (115) One shipment stage and its containers. filterId is the Containers list's Stage filter (a stage's id, 0 Pending,
 * -1 not on a stage; null: received without an Offload stage). Open: not delivered yet; toReceive: delivered, goods
 * receipt not posted; received: received in the period.
 */
export interface DashboardStageDto {
  filterId: number | null
  stageName: string
  /** 0 Pending, 1 Leg, 2 Arrive, 3 Offload; null: not on a stage. */
  stageKind: number | null
  openContainers: number
  openPieces: number
  toReceiveContainers: number
  toReceivePieces: number
  receivedContainers: number
  receivedPieces: number
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
