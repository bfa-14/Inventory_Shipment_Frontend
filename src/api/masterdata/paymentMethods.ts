import { request } from '../http'
import type { PagedResult } from '../types'

/**
 * Payment methods (Cash, Bank Transfer, Cheque...) a customer receipt line is paid by. Writes need
 * `masterdata.paymentmethods.manage`; the lookup is open to any signed-in user because the receipt
 * page picks from it.
 */
const BASE = '/api/masterdata/payment-methods'

export interface PaymentMethodDto {
  id: number
  methodCode: string
  methodName: string
  description: string | null
  isActive: boolean
  /** Receipt lines using it (the list only). */
  usedCount: number
  createdAtUtc: string
  updatedAtUtc: string | null
  rowVersion: string
}

export interface PaymentMethodLookupDto {
  id: number
  methodCode: string
  methodName: string
  isActive: boolean
}

export interface PaymentMethodQuery {
  search?: string
  isActive?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface SavePaymentMethodRequest {
  methodCode: string
  methodName: string
  description: string | null
  isActive: boolean
  rowVersion?: string | null
}

export const paymentMethodsApi = {
  list: (query: PaymentMethodQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
    if (query.sortBy) params.set('sortBy', query.sortBy)
    if (query.sortDir) params.set('sortDir', query.sortDir)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    return request<PagedResult<PaymentMethodDto>>(`${BASE}?${params.toString()}`, { signal })
  },

  lookup: (activeOnly = true, includeId?: number) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (includeId !== undefined) params.set('includeId', String(includeId))
    return request<PaymentMethodLookupDto[]>(`${BASE}/lookup?${params.toString()}`)
  },

  get: (id: number) => request<PaymentMethodDto>(`${BASE}/${id}`),

  create: (payload: SavePaymentMethodRequest) => request<PaymentMethodDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SavePaymentMethodRequest) =>
    request<PaymentMethodDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  setActive: (id: number, isActive: boolean, rowVersion: string | null) =>
    request<PaymentMethodDto>(`${BASE}/${id}/set-active`, { method: 'POST', body: { isActive, rowVersion } }),

  /** 409 IN_USE when receipts use it. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
}
