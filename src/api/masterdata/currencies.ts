import { request } from '../http'
import type {
  CurrencyDto,
  CurrencyLookupDto,
  CurrencyQuery,
  PagedResult,
  SaveCurrencyRequest,
} from '../types'

/** Builds the query string, leaving out anything the user did not set. */
function toQueryString(query: CurrencyQuery): string {
  const params = new URLSearchParams()

  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
  if (query.isBaseCurrency !== undefined) params.set('isBaseCurrency', String(query.isBaseCurrency))
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.sortDir) params.set('sortDir', query.sortDir)
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))

  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Currencies master data - guarded by the masterdata.currencies.* permissions (except base and lookup). */
export const currenciesApi = {
  /** `signal` lets a grid abandon this request when the reader edits the filters again. */
  search: (query: CurrencyQuery = {}, signal?: AbortSignal) =>
    request<PagedResult<CurrencyDto>>(`/api/masterdata/currencies${toQueryString(query)}`, { signal }),

  get: (id: number) => request<CurrencyDto>(`/api/masterdata/currencies/${id}`),

  /**
   * The currency currently flagged as the base currency; 404 when there is none. Readable by any
   * signed-in user, because every screen showing an amount needs to know what it is expressed in.
   */
  getBase: () => request<CurrencyDto>('/api/masterdata/currencies/base'),

  /**
   * Currencies for a dropdown, base currency first. Readable by any signed-in user.
   * `includeId` keeps one currency in the list even when it is inactive, so an edit form still
   * shows the currency the record currently points at.
   */
  lookup: (activeOnly = true, includeId?: number) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (includeId !== undefined) params.set('includeId', String(includeId))
    return request<CurrencyLookupDto[]>(`/api/masterdata/currencies/lookup?${params.toString()}`)
  },

  create: (payload: SaveCurrencyRequest) =>
    request<CurrencyDto>('/api/masterdata/currencies', { method: 'POST', body: payload }),

  update: (id: number, payload: SaveCurrencyRequest) =>
    request<CurrencyDto>(`/api/masterdata/currencies/${id}`, { method: 'PUT', body: payload }),

  /** Answers 204: activating or deactivating returns no body. */
  setStatus: (id: number, isActive: boolean) =>
    request<void>(`/api/masterdata/currencies/${id}/status`, { method: 'PUT', body: { isActive } }),

  remove: (id: number) => request<void>(`/api/masterdata/currencies/${id}`, { method: 'DELETE' }),
}
