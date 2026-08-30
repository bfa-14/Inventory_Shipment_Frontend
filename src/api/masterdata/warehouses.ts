import { request } from '../http'
import type { PagedResult, SaveWarehouseRequest, WarehouseDto, WarehouseLookupDto, WarehouseQuery } from '../types'

/** Builds the query string, leaving out anything the user did not set. */
function toQueryString(query: WarehouseQuery): string {
  const params = new URLSearchParams()

  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.branchId !== undefined) params.set('branchId', String(query.branchId))
  if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
  if (query.isMainWarehouse !== undefined) params.set('isMainWarehouse', String(query.isMainWarehouse))
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.sortDir) params.set('sortDir', query.sortDir)
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))

  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Warehouses master data - guarded by the masterdata.warehouses.* permissions (except the lookup). */
export const warehousesApi = {
  search: (query: WarehouseQuery = {}) =>
    request<PagedResult<WarehouseDto>>(`/api/masterdata/warehouses${toQueryString(query)}`),

  get: (id: number) => request<WarehouseDto>(`/api/masterdata/warehouses/${id}`),

  /** The warehouse currently flagged as the Main Warehouse; 404 when there is none. */
  getMain: () => request<WarehouseDto>('/api/masterdata/warehouses/main'),

  /**
   * Warehouses for a dropdown. Readable by any signed-in user.
   * `includeId` keeps one warehouse in the list even when it is inactive.
   */
  lookup: (activeOnly = true, branchId?: number, includeId?: number) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (branchId !== undefined) params.set('branchId', String(branchId))
    if (includeId !== undefined) params.set('includeId', String(includeId))
    return request<WarehouseLookupDto[]>(`/api/masterdata/warehouses/lookup?${params.toString()}`)
  },

  create: (payload: SaveWarehouseRequest) =>
    request<WarehouseDto>('/api/masterdata/warehouses', { method: 'POST', body: payload }),

  update: (id: number, payload: SaveWarehouseRequest) =>
    request<WarehouseDto>(`/api/masterdata/warehouses/${id}`, { method: 'PUT', body: payload }),

  setStatus: (id: number, isActive: boolean) =>
    request<WarehouseDto>(`/api/masterdata/warehouses/${id}/status`, { method: 'PATCH', body: { isActive } }),

  remove: (id: number) => request<void>(`/api/masterdata/warehouses/${id}`, { method: 'DELETE' }),
}
