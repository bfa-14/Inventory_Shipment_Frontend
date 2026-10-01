import { request } from '../http'
import type { PagedResult } from '../types'

/**
 * The cash boxes and bank accounts a customer receipt is paid into. Each holds ONE currency. Writes
 * need `masterdata.cashbankaccounts.manage`; the lookup is open to any signed-in user because the
 * receipt page picks from it.
 */
const BASE = '/api/masterdata/cash-bank-accounts'

export type CashBankAccountType = 'Cash' | 'Bank'

export const CASH_BANK_ACCOUNT_TYPES: { value: CashBankAccountType; label: string }[] = [
  { value: 'Cash', label: 'Cash' },
  { value: 'Bank', label: 'Bank' },
]

export interface CashBankAccountDto {
  id: number
  accountCode: string
  accountName: string
  accountType: CashBankAccountType
  currencyId: number
  currencyCode: string
  /** Null = usable from every branch. */
  branchId: number | null
  branchName: string | null
  description: string | null
  isActive: boolean
  /** Receipt lines using it (the list only). */
  usedCount: number
  createdAtUtc: string
  updatedAtUtc: string | null
  rowVersion: string
}

export interface CashBankAccountLookupDto {
  id: number
  accountCode: string
  accountName: string
  accountType: CashBankAccountType
  currencyId: number
  currencyCode: string
  branchId: number | null
  isActive: boolean
}

export interface CashBankAccountQuery {
  search?: string
  accountType?: CashBankAccountType
  currencyId?: number
  isActive?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface SaveCashBankAccountRequest {
  accountCode: string
  accountName: string
  accountType: CashBankAccountType
  currencyId: number
  branchId: number | null
  description: string | null
  isActive: boolean
  rowVersion?: string | null
}

export const cashBankAccountsApi = {
  list: (query: CashBankAccountQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.accountType) params.set('accountType', query.accountType)
    if (query.currencyId !== undefined) params.set('currencyId', String(query.currencyId))
    if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
    if (query.sortBy) params.set('sortBy', query.sortBy)
    if (query.sortDir) params.set('sortDir', query.sortDir)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    return request<PagedResult<CashBankAccountDto>>(`${BASE}?${params.toString()}`, { signal })
  },

  /**
   * What a receipt line's account picker offers. `currencyId` keeps only accounts holding the
   * line's currency; `branchId` keeps those the receipt's branch may use (an account with no branch
   * belongs to everybody); `includeId` keeps one account visible whatever the filters say.
   */
  lookup: (options: { activeOnly?: boolean; currencyId?: number; branchId?: number; includeId?: number } = {}) => {
    const params = new URLSearchParams({ activeOnly: String(options.activeOnly ?? true) })
    if (options.currencyId !== undefined) params.set('currencyId', String(options.currencyId))
    if (options.branchId !== undefined) params.set('branchId', String(options.branchId))
    if (options.includeId !== undefined) params.set('includeId', String(options.includeId))
    return request<CashBankAccountLookupDto[]>(`${BASE}/lookup?${params.toString()}`)
  },

  get: (id: number) => request<CashBankAccountDto>(`${BASE}/${id}`),

  create: (payload: SaveCashBankAccountRequest) => request<CashBankAccountDto>(BASE, { method: 'POST', body: payload }),

  /** The currency of an account receipts already use cannot change (400). */
  update: (id: number, payload: SaveCashBankAccountRequest) =>
    request<CashBankAccountDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  setActive: (id: number, isActive: boolean, rowVersion: string | null) =>
    request<CashBankAccountDto>(`${BASE}/${id}/set-active`, { method: 'POST', body: { isActive, rowVersion } }),

  /** 409 IN_USE when receipts use it. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
}
