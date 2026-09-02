import { request } from '../http'
import type { BrandDto, BrandLookupDto, BrandQuery, PagedResult, SaveBrandRequest } from '../types'

/** Builds the query string, leaving out anything the user did not set. */
function toQueryString(query: BrandQuery): string {
  const params = new URLSearchParams()

  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.sortDir) params.set('sortDir', query.sortDir)
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))

  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Brands master data - guarded by the masterdata.brands.* permissions. */
export const brandsApi = {
  /** `signal` lets a grid abandon this request when the reader edits the filters again. */
  search: (query: BrandQuery = {}, signal?: AbortSignal) =>
    request<PagedResult<BrandDto>>(`/api/masterdata/brands${toQueryString(query)}`, { signal }),

  get: (id: number) => request<BrandDto>(`/api/masterdata/brands/${id}`),

  /**
   * Brands for a Brand dropdown. Readable by any signed-in user, because every form with a brand
   * picker needs it. `includeId` keeps one brand in the list even when it is inactive, so an edit
   * form still shows the brand the record currently points at.
   */
  lookup: (activeOnly = true, includeId?: number) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (includeId !== undefined) params.set('includeId', String(includeId))
    return request<BrandLookupDto[]>(`/api/masterdata/brands/lookup?${params.toString()}`)
  },

  create: (payload: SaveBrandRequest) =>
    request<BrandDto>('/api/masterdata/brands', { method: 'POST', body: payload }),

  update: (id: number, payload: SaveBrandRequest) =>
    request<BrandDto>(`/api/masterdata/brands/${id}`, { method: 'PUT', body: payload }),

  setStatus: (id: number, isActive: boolean) =>
    request<BrandDto>(`/api/masterdata/brands/${id}/status`, { method: 'PUT', body: { isActive } }),

  remove: (id: number) => request<void>(`/api/masterdata/brands/${id}`, { method: 'DELETE' }),
}
