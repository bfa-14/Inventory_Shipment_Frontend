import { request } from '../http'
import type {
  PagedResult,
  PriceListDto,
  PriceListLookupDto,
  PriceListQuery,
  SavePriceListRequest,
} from '../types'

/** Builds the query string, leaving out anything the user did not set. */
function toQueryString(query: PriceListQuery): string {
  const params = new URLSearchParams()

  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.currencyId !== undefined) params.set('currencyId', String(query.currencyId))
  if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.sortDir) params.set('sortDir', query.sortDir)
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))

  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Price lists master data - guarded by the masterdata.pricelists.* permissions (except lookup). */
export const priceListsApi = {
  /** `signal` lets a grid abandon this request when the reader edits the filters again. */
  search: (query: PriceListQuery = {}, signal?: AbortSignal) =>
    request<PagedResult<PriceListDto>>(`/api/masterdata/price-lists${toQueryString(query)}`, { signal }),

  get: (id: number) => request<PriceListDto>(`/api/masterdata/price-lists/${id}`),

  /**
   * Price lists for a Price List dropdown. Readable by any signed-in user, because every form with
   * a price list picker needs it. `includeId` keeps one list in the result even when it is
   * inactive, so an edit form still shows the list the record currently points at.
   */
  lookup: (activeOnly = true, includeId?: number) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (includeId !== undefined) params.set('includeId', String(includeId))
    return request<PriceListLookupDto[]>(`/api/masterdata/price-lists/lookup?${params.toString()}`)
  },

  create: (payload: SavePriceListRequest) =>
    request<PriceListDto>('/api/masterdata/price-lists', { method: 'POST', body: payload }),

  update: (id: number, payload: SavePriceListRequest) =>
    request<PriceListDto>(`/api/masterdata/price-lists/${id}`, { method: 'PUT', body: payload }),

  setStatus: (id: number, isActive: boolean) =>
    request<PriceListDto>(`/api/masterdata/price-lists/${id}/status`, { method: 'PUT', body: { isActive } }),

  remove: (id: number) => request<void>(`/api/masterdata/price-lists/${id}`, { method: 'DELETE' }),
}
