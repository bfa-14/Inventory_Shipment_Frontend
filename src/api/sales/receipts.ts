import { fetchBlob, postForm, request } from '../http'
import type { PagedResult } from '../types'

/**
 * Customer receipts (scripts 35-36).
 *
 * A RECEIPT COMES BACK WHOLE from every write: post, reverse and allocate answer with the re-read
 * receipt, so the page replaces its copy instead of working out which fields moved.
 *
 * RATES ARE "units of the currency per 1 base currency" (USD base, CDF 2800), the same convention
 * as the exchange-rate master data. An amount in base is therefore amount / rate.
 */
const BASE = '/api/sales/receipts'

export type ReceiptStatus = 'Draft' | 'Posted' | 'Reversed'

/** 1 Free Receipt, 2 Sales Allocation — the numbers the API takes. */
export type ReceiptPaymentType = 1 | 2

export const RECEIPT_PAYMENT_TYPES: readonly { value: ReceiptPaymentType; label: string }[] = [
  { value: 1, label: 'Free Receipt' },
  { value: 2, label: 'Sales Allocation' },
]

export interface ReceiptListDto {
  id: number
  receiptNumber: string | null
  receiptDate: string
  clientId: number
  clientCode: string
  clientName: string
  branchId: number
  branchName: string
  paymentType: ReceiptPaymentType
  paymentTypeName: string
  currencyId: number
  currencyCode: string
  decimalPlaces: number
  amount: number
  exchangeRate: number
  amountBase: number
  status: ReceiptStatus
  /** The invoice that made this receipt automatically (a Cash sale); null for an ordinary receipt. */
  sourceSalesDocumentId: number | null
  sourceInvoiceNumber: string | null
  allocatedBase: number
  unappliedBase: number
  postedAtUtc: string | null
  postedByName: string | null
  reversedAtUtc: string | null
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  rowVersion: string
}

export interface ReceiptLineDto {
  id: number
  lineNo: number
  paymentMethodId: number
  methodCode: string
  methodName: string
  currencyId: number
  currencyCode: string
  decimalPlaces: number
  amount: number
  exchangeRate: number
  amountBase: number
  cashBankAccountId: number
  accountCode: string
  accountName: string
  reference: string | null
}

export interface ReceiptAllocationDto {
  id: number
  salesDocumentId: number
  invoiceNumber: string
  invoiceDate: string
  invoiceCurrencyId: number
  invoiceCurrencyCode: string
  invoiceDecimalPlaces: number
  invoiceTotal: number
  amountInvoiceCurrency: number
  invoiceExchangeRate: number
  amountBase: number
  allocatedAtUtc: string
  allocatedByName: string | null
  removedAtUtc: string | null
  removedByName: string | null
  isLive: boolean
}

export interface ReceiptFileDto {
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

export interface ReceiptAuditDto {
  id: number
  action: string
  details: string | null
  userName: string | null
  atUtc: string
}

export interface ReceiptDto {
  id: number
  receiptNumber: string | null
  receiptDate: string
  clientId: number
  clientCode: string
  clientName: string
  clientAddress: string | null
  branchId: number
  branchCode: string
  branchName: string
  paymentType: ReceiptPaymentType
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
  notes: string | null
  status: ReceiptStatus
  /** The invoice that made this receipt automatically. Such a receipt is reversed by cancelling that invoice. */
  sourceSalesDocumentId: number | null
  sourceInvoiceNumber: string | null
  linesBase: number
  allocatedBase: number
  unappliedBase: number
  postedAtUtc: string | null
  postedByName: string | null
  reversedAtUtc: string | null
  reversedByName: string | null
  reverseReason: string | null
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  updatedByName: string | null
  rowVersion: string
  lines: ReceiptLineDto[]
  allocations: ReceiptAllocationDto[]
  files: ReceiptFileDto[]
  audit: ReceiptAuditDto[]
}

/** A posted invoice of the customer with something left to pay. Outstanding is in the invoice's currency. */
export interface OpenInvoiceDto {
  id: number
  documentNumber: string
  documentDate: string
  dueDate: string | null
  currencyId: number
  currencyCode: string
  decimalPlaces: number
  exchangeRate: number
  invoiceTotal: number
  paidAmount: number
  outstandingAmount: number
  paymentStatus: string
  outstandingBase: number
}

/** Rate is null when none is defined for the date: a warning and an editable box, not an error. */
export interface ReceiptRateDto {
  currencyId: number
  currencyCode: string
  symbol: string | null
  decimalPlaces: number
  isBaseCurrency: boolean
  rate: number | null
  rateDate: string | null
  baseCurrencyCode: string | null
}

/** One line of a customer's ledger, in the base currency. */
export interface CustomerStatementEntryDto {
  entryDate: string
  /** Invoice, Invoice cancelled, Sales return, Receipt or Receipt reversed. */
  entryType: string
  documentId: number
  documentNumber: string | null
  currencyCode: string | null
  decimalPlaces: number
  docAmount: number
  debit: number
  credit: number
  balance: number
}

export interface CustomerStatementDto {
  clientId: number
  clientCode: string
  clientName: string
  baseCurrencyCode: string | null
  openingBalance: number
  totalDebit: number
  totalCredit: number
  closingBalance: number
  entries: CustomerStatementEntryDto[]
}

export interface ReceiptQuery {
  search?: string
  clientId?: number
  branchId?: number
  status?: ReceiptStatus
  paymentType?: ReceiptPaymentType
  currencyId?: number
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface SaveReceiptLine {
  paymentMethodId: number
  currencyId: number
  amount: number
  /** Null: the server takes the official rate for the receipt date. */
  exchangeRate: number | null
  cashBankAccountId: number
  reference: string | null
}

export interface SaveReceiptAllocation {
  salesDocumentId: number
  /** In the INVOICE's currency. */
  amount: number
}

export interface SaveReceiptRequest {
  receiptDate: string
  clientId: number
  branchId: number
  paymentType: ReceiptPaymentType
  currencyId: number
  amount: number
  exchangeRate: number | null
  notes: string | null
  lines: SaveReceiptLine[]
  allocations: SaveReceiptAllocation[]
  rowVersion?: string | null
}

export const receiptsApi = {
  list: (query: ReceiptQuery = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.clientId !== undefined) params.set('clientId', String(query.clientId))
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
    return request<PagedResult<ReceiptListDto>>(`${BASE}${qs ? `?${qs}` : ''}`, { signal })
  },

  get: (id: number) => request<ReceiptDto>(`${BASE}/${id}`),

  /** The rate a payment line pre-fills for a currency on a date (today when omitted). */
  rate: (currencyId: number, date?: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ currencyId: String(currencyId) })
    if (date) params.set('date', date)
    return request<ReceiptRateDto>(`${BASE}/rate?${params.toString()}`, { signal })
  },

  statement: (clientId: number, dateFrom?: string | null, dateTo?: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ clientId: String(clientId) })
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    return request<CustomerStatementDto>(`${BASE}/statement?${params.toString()}`, { signal })
  },

  openInvoices: (clientId: number, signal?: AbortSignal) =>
    request<OpenInvoiceDto[]>(`${BASE}/open-invoices?clientId=${clientId}`, { signal }),

  create: (payload: SaveReceiptRequest) => request<ReceiptDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveReceiptRequest) => request<ReceiptDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  post: (id: number, rowVersion: string | null) =>
    request<ReceiptDto>(`${BASE}/${id}/post`, { method: 'POST', body: { rowVersion } }),

  reverse: (id: number, reason: string, rowVersion: string | null) =>
    request<ReceiptDto>(`${BASE}/${id}/reverse`, { method: 'POST', body: { reason, rowVersion } }),

  /** Applies the unapplied credit of a posted Free Receipt to invoices. */
  allocate: (id: number, allocations: SaveReceiptAllocation[], rowVersion: string | null) =>
    request<ReceiptDto>(`${BASE}/${id}/allocations`, { method: 'POST', body: { allocations, rowVersion } }),

  deallocate: (id: number, allocationId: number) =>
    request<ReceiptDto>(`${BASE}/${id}/allocations/${allocationId}`, { method: 'DELETE' }),

  /** Drafts only. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  addFile: (id: number, file: File, attachmentTypeId: number | null, note: string | null) => {
    const form = new FormData()
    form.append('file', file, file.name)
    if (attachmentTypeId !== null) form.append('attachmentTypeId', String(attachmentTypeId))
    if (note?.trim()) form.append('note', note.trim())
    return postForm<{ id: number }>(`${BASE}/${id}/files`, form)
  },

  downloadFile: async (id: number, fileId: number, fileName: string) => saveBlob(await fetchBlob(`${BASE}/${id}/files/${fileId}`), fileName),

  removeFile: (id: number, fileId: number) => request<void>(`${BASE}/${id}/files/${fileId}`, { method: 'DELETE' }),
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
