import { request } from '../http'
import type { ExchangeRateDto, ExchangeRateQuery, PagedResult, SaveExchangeRateRequest } from '../types'

/** Builds the query string, leaving out anything the user did not set. */
function toQueryString(query: ExchangeRateQuery): string {
  const params = new URLSearchParams()

  if (query.currencyId !== undefined) params.set('currencyId', String(query.currencyId))
  if (query.rateType) params.set('rateType', query.rateType)
  if (query.dateFrom) params.set('dateFrom', query.dateFrom)
  if (query.dateTo) params.set('dateTo', query.dateTo)
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.sortDir) params.set('sortDir', query.sortDir)
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))

  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Exchange rates master data - guarded by the masterdata.exchangerates.* permissions (except latest). */
export const exchangeRatesApi = {
  /** `signal` lets a grid abandon this request when the reader edits the filters again. */
  search: (query: ExchangeRateQuery = {}, signal?: AbortSignal) =>
    request<PagedResult<ExchangeRateDto>>(`/api/masterdata/exchange-rates${toQueryString(query)}`, { signal }),

  get: (id: number) => request<ExchangeRateDto>(`/api/masterdata/exchange-rates/${id}`),

  /**
   * The rate in force per rate type for one currency - 0 to 3 rows, newest date on or before
   * `asOf` (today when omitted). Readable by any signed-in user, because screens that convert an
   * amount need the rate, not only the users who maintain rates.
   */
  latest: (currencyId: number, asOf?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ currencyId: String(currencyId) })
    if (asOf) params.set('asOf', asOf)
    return request<ExchangeRateDto[]>(`/api/masterdata/exchange-rates/latest?${params.toString()}`, { signal })
  },

  create: (payload: SaveExchangeRateRequest) =>
    request<ExchangeRateDto>('/api/masterdata/exchange-rates', { method: 'POST', body: payload }),

  update: (id: number, payload: SaveExchangeRateRequest) =>
    request<ExchangeRateDto>(`/api/masterdata/exchange-rates/${id}`, { method: 'PUT', body: payload }),

  remove: (id: number) => request<void>(`/api/masterdata/exchange-rates/${id}`, { method: 'DELETE' }),
}
