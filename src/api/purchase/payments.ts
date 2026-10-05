import { documentFilesApi } from '../documentFiles'
import { request } from '../http'
import type { PagedResult } from '../types'

/**
 * Supplier payments (US-PAY-001, scripts 46-47): money going out to a supplier or service provider.
 *
 * THE PAYMENT'S OWN CURRENCY IS THE CONTROL CURRENCY. Each line converts to it with a multiplier
 * (rateToPayment: 28,000,000 CDF x 0.00035 = 9,800 USD), allocations do the same from their document's
 * currency, and the lines (and allocations) must add up to the payment amount in that currency.
 *
 * The header's exchangeRate keeps the system convention: units of the payment currency per 1 base
 * (USD base, CDF 2800), so amountBase = amount / exchangeRate.
 *
 * A PAYMENT COMES BACK WHOLE from every write, so the page replaces its copy instead of guessing.
 */
const BASE = '/api/purchase/payments'

export type SupplierPaymentStatus = 'Draft' | 'Posted' | 'Reversed'

/** 1 Free Payment, 2 Purchase Invoice Payment, 3 Container Charge Payment. */
export type SupplierPaymentType = 1 | 2 | 3

export const SUPPLIER_PAYMENT_TYPES: readonly { value: SupplierPaymentType; label: string }[] = [
  { value: 1, label: 'Free Payment' },
  { value: 2, label: 'Purchase Invoice Payment' },
  { value: 3, label: 'Container Charge Payment' },
]

/** PINV (purchase invoice) or CHARGE (container charge). */
export type PayableKind = 'PINV' | 'CHARGE'

/** The document kind a payment type allocates to; null for a Free Payment. */
export function kindOfType(type: SupplierPaymentType): PayableKind | null {
  return type === 2 ? 'PINV' : type === 3 ? 'CHARGE' : null
}

export const CLEARANCE_STATUSES = [
  { value: 1, label: 'Pending', colour: 'yellow' },
  { value: 2, label: 'Cleared', colour: 'green' },
  { value: 3, label: 'Returned', colour: 'red' },
] as const

export interface PaymentListDto {
  id: number
  paymentNumber: string | null
  paymentDate: string
  payeeId: number
  payeeCode: string
  payeeName: string
  branchId: number
  branchName: string
  paymentType: SupplierPaymentType
  paymentTypeName: string
  currencyId: number
  currencyCode: string
  decimalPlaces: number
  amount: number
  exchangeRate: number
  amountBase: number
  reference: string | null
  status: SupplierPaymentStatus
  methods: string | null
  /** In the payment currency. */
  allocatedAmount: number
  /** A posted Free Payment's advance still to allocate, in the payment currency. */
  unappliedAmount: number
  documentCount: number
  postedAtUtc: string | null
  postedByName: string | null
  reversedAtUtc: string | null
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  rowVersion: string
}

export interface PaymentLineDto {
  id: number
  lineNo: number
  paymentMethodId: number
  methodCode: string
  methodName: string
  isCheque: boolean
  currencyId: number
  currencyCode: string
  decimalPlaces: number
  amount: number
  rateToPayment: number
  amountPaymentCurrency: number
  amountBase: number
  cashBankAccountId: number
  accountCode: string
  accountName: string
  reference: string | null
  chequeNo: string | null
  chequeDate: string | null
  chequeDueDate: string | null
  /** Cheque lines: 1 Pending, 2 Cleared, 3 Returned. */
  clearanceStatus: number | null
  clearanceStatusName: string | null
  clearanceUpdatedAtUtc: string | null
  clearanceUpdatedByName: string | null
}

export interface PaymentAllocationDto {
  id: number
  documentKind: PayableKind
  documentId: number
  documentNumber: string
  documentDate: string
  containerRef: string | null
  chargeTypeName: string | null
  documentReference: string | null
  documentCurrencyId: number
  documentCurrencyCode: string
  documentDecimalPlaces: number
  documentTotal: number
  returnedAmount: number
  /** What OTHER posted payments have paid it, in its currency. */
  previouslyPaid: number
  outstandingAmount: number | null
  paymentStatus: string | null
  amountDocCurrency: number
  docExchangeRate: number
  rateToPayment: number
  amountPaymentCurrency: number
  amountBase: number
  allocatedAtUtc: string
  allocatedByName: string | null
  removedAtUtc: string | null
  removedByName: string | null
  isLive: boolean
}

export interface PaymentFileDto {
  id: number
  attachmentTypeId: number | null
  category: string | null
  subType: string | null
  note: string | null
  fileName: string
  contentType: string
  sizeBytes: number
  createdAtUtc: string
  createdByName: string | null
}

export interface PaymentAuditDto {
  id: number
  action: string
  details: string | null
  userId: number | null
  userName: string | null
  atUtc: string
}

export interface PaymentDto {
  id: number
  paymentNumber: string | null
  paymentDate: string
  payeeId: number
  payeeCode: string
  payeeName: string
  payeeAddress: string | null
  branchId: number
  branchCode: string
  branchName: string
  paymentType: SupplierPaymentType
  paymentTypeName: string
  currencyId: number
  currencyCode: string
  currencyName: string
  currencySymbol: string | null
  decimalPlaces: number
  isBaseCurrency: boolean
  amount: number
  exchangeRate: number
  amountBase: number
  baseCurrencyCode: string | null
  reference: string | null
  notes: string | null
  status: SupplierPaymentStatus
  /** In the payment currency: must equal amount to post. */
  linesTotal: number
  allocatedTotal: number
  unappliedAmount: number
  allocationKind: PayableKind | null
  postedAtUtc: string | null
  postedBy: number | null
  postedByName: string | null
  reversedAtUtc: string | null
  reversedBy: number | null
  reversedByName: string | null
  reverseReason: string | null
  createdAtUtc: string
  createdBy: number | null
  createdByName: string | null
  updatedAtUtc: string | null
  updatedBy: number | null
  updatedByName: string | null
  rowVersion: string
  lines: PaymentLineDto[]
  allocations: PaymentAllocationDto[]
  files: PaymentFileDto[]
  audit: PaymentAuditDto[]
}

/** A posted invoice / charge of the payee with something left to pay. Amounts in its own currency. */
export interface OpenPayableDocumentDto {
  documentKind: PayableKind
  documentId: number
  documentNumber: string
  documentDate: string
  containerRef: string | null
  chargeTypeName: string | null
  documentReference: string | null
  currencyId: number
  currencyCode: string
  decimalPlaces: number
  exchangeRate: number
  documentTotal: number
  returnedAmount: number
  previouslyPaid: number
  outstandingAmount: number
  paymentStatus: string
  outstandingBase: number
  /** The multiplier to the payment currency the row pre-fills (when the payment currency was given). */
  defaultRateToPayment: number | null
}

export interface PaymentRateDto {
  fromCurrencyId: number
  paymentCurrencyId: number
  paymentRate: number | null
  fromRate: number | null
  /** Null when a rate is missing: a warning, not an error. */
  rateToPayment: number | null
}

export interface PaymentQuery {
  search?: string
  payeeId?: number
  branchId?: number
  status?: SupplierPaymentStatus
  paymentType?: SupplierPaymentType
  currencyId?: number
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface SavePaymentLine {
  paymentMethodId: number
  currencyId: number
  amount: number
  /** Null = from the official rates (1 for the payment's own currency). */
  rateToPayment: number | null
  cashBankAccountId: number
  reference: string | null
  chequeNo: string | null
  chequeDate: string | null
  chequeDueDate: string | null
}

export interface SavePaymentAllocation {
  documentKind: PayableKind
  documentId: number
  /** In the DOCUMENT's currency. */
  amount: number
  rateToPayment: number | null
}

export interface SavePaymentRequest {
  paymentDate: string
  payeeId: number
  branchId: number
  paymentType: SupplierPaymentType
  currencyId: number
  amount: number
  exchangeRate: number | null
  reference: string | null
  notes: string | null
  lines: SavePaymentLine[]
  allocations: SavePaymentAllocation[]
  rowVersion?: string | null
}

export const paymentsApi = {
  list: (query: PaymentQuery = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.payeeId !== undefined) params.set('payeeId', String(query.payeeId))
    if (query.branchId !== undefined) params.set('branchId', String(query.branchId))
    if (query.status) params.set('status', query.status)
    if (query.paymentType !== undefined) params.set('paymentType', String(query.paymentType))
    if (query.currencyId !== undefined) params.set('currencyId', String(query.currencyId))
    if (query.dateFrom) params.set('dateFrom', query.dateFrom)
    if (query.dateTo) params.set('dateTo', query.dateTo)
    if (query.sortBy) params.set('sortBy', query.sortBy)
    if (query.sortDir) params.set('sortDir', query.sortDir)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    const qs = params.toString()
    return request<PagedResult<PaymentListDto>>(`${BASE}${qs ? `?${qs}` : ''}`, { signal })
  },

  get: (id: number) => request<PaymentDto>(`${BASE}/${id}`),

  /** The multiplier from a currency to the payment currency on a date. */
  rate: (fromCurrencyId: number, paymentCurrencyId: number, paymentRate: number | null, date: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ fromCurrencyId: String(fromCurrencyId), paymentCurrencyId: String(paymentCurrencyId) })
    if (paymentRate !== null) params.set('paymentRate', String(paymentRate))
    if (date) params.set('date', date)
    return request<PaymentRateDto>(`${BASE}/rate?${params.toString()}`, { signal })
  },

  openDocuments: (
    payeeId: number,
    kind: PayableKind,
    payment: { currencyId: number | null; rate: number | null; date: string | null },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ payeeId: String(payeeId), kind })
    if (payment.currencyId !== null) params.set('paymentCurrencyId', String(payment.currencyId))
    if (payment.rate !== null) params.set('paymentRate', String(payment.rate))
    if (payment.date) params.set('date', payment.date)
    return request<OpenPayableDocumentDto[]>(`${BASE}/open-documents?${params.toString()}`, { signal })
  },

  create: (payload: SavePaymentRequest) => request<PaymentDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SavePaymentRequest) => request<PaymentDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  post: (id: number, rowVersion: string | null) => request<PaymentDto>(`${BASE}/${id}/post`, { method: 'POST', body: { rowVersion } }),

  reverse: (id: number, reason: string, rowVersion: string | null) =>
    request<PaymentDto>(`${BASE}/${id}/reverse`, { method: 'POST', body: { reason, rowVersion } }),

  /** Applies the unapplied advance of a posted Free Payment to invoices OR charges. */
  allocate: (id: number, allocations: SavePaymentAllocation[], rowVersion: string | null) =>
    request<PaymentDto>(`${BASE}/${id}/allocations`, { method: 'POST', body: { allocations, rowVersion } }),

  deallocate: (id: number, allocationId: number) => request<PaymentDto>(`${BASE}/${id}/allocations/${allocationId}`, { method: 'DELETE' }),

  setChequeStatus: (id: number, lineId: number, clearanceStatus: number) =>
    request<PaymentDto>(`${BASE}/${id}/lines/${lineId}/cheque-status`, { method: 'POST', body: { clearanceStatus } }),

  /** Drafts only. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  /** The files with their type, date and note (script 55): list, upload, edit, download, delete. */
  files: documentFilesApi(BASE),
}
