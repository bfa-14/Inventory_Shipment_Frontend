import { request } from '../http'
import type { PagedResult, SaveUnitTypeRequest, UnitTypeDto, UnitTypeLookupDto, UnitTypeQuery } from '../types'

const BASE = '/api/masterdata/unit-types'

/** Builds the query string, leaving out anything the user did not set. */
function toQueryString(query: UnitTypeQuery): string {
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

/** Unit types master data - guarded by the masterdata.unittypes.* permissions (except lookup). */
export const unitTypesApi = {
  /** `signal` lets a grid abandon this request when the reader edits the filters again. */
  search: (query: UnitTypeQuery = {}, signal?: AbortSignal) =>
    request<PagedResult<UnitTypeDto>>(`${BASE}${toQueryString(query)}`, { signal }),

  get: (id: number) => request<UnitTypeDto>(`${BASE}/${id}`),

  /**
   * Unit types for a dropdown. Readable by any signed-in user, because the item form needs it.
   * `includeId` keeps one unit type in the list even when it is inactive, so an edit form still
   * shows the unit type the record currently points at.
   */
  lookup: (activeOnly = true, includeId?: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (includeId !== undefined) params.set('includeId', String(includeId))
    return request<UnitTypeLookupDto[]>(`${BASE}/lookup?${params.toString()}`, { signal })
  },

  create: (payload: SaveUnitTypeRequest) => request<UnitTypeDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveUnitTypeRequest) =>
    request<UnitTypeDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  setStatus: (id: number, isActive: boolean) =>
    request<UnitTypeDto>(`${BASE}/${id}/status`, { method: 'PUT', body: { isActive } }),

  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
}
