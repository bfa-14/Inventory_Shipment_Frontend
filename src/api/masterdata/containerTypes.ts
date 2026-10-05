import { request } from '../http'
import type { PagedResult } from '../types'

/**
 * Container types (20GP, 40HC...) and their capacity in units — copied onto a new container and
 * editable there. Writes need `masterdata.containertypes.manage`; the lookup is open to any signed-in
 * user because the container page picks from it.
 */
const BASE = '/api/masterdata/container-types'

export interface ContainerTypeDto {
  id: number
  typeCode: string
  typeName: string
  maxWeightKg: number | null
  maxVolumeCbm: number | null
  description: string | null
  isActive: boolean
  /** Containers using it (the list only). */
  usedCount: number
  createdAtUtc: string
  updatedAtUtc: string | null
  rowVersion: string
}

export interface ContainerTypeLookupDto {
  id: number
  typeCode: string
  typeName: string
  maxWeightKg: number | null
  maxVolumeCbm: number | null
  isActive: boolean
}

export interface ContainerTypeQuery {
  search?: string
  isActive?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface SaveContainerTypeRequest {
  typeCode: string
  typeName: string
  maxWeightKg: number | null
  maxVolumeCbm: number | null
  description: string | null
  isActive: boolean
  rowVersion?: string | null
}

export const containerTypesApi = {
  list: (query: ContainerTypeQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
    if (query.sortBy) params.set('sortBy', query.sortBy)
    if (query.sortDir) params.set('sortDir', query.sortDir)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    return request<PagedResult<ContainerTypeDto>>(`${BASE}?${params.toString()}`, { signal })
  },

  lookup: (activeOnly = true, includeId?: number) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (includeId !== undefined) params.set('includeId', String(includeId))
    return request<ContainerTypeLookupDto[]>(`${BASE}/lookup?${params.toString()}`)
  },

  get: (id: number) => request<ContainerTypeDto>(`${BASE}/${id}`),

  create: (payload: SaveContainerTypeRequest) => request<ContainerTypeDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveContainerTypeRequest) =>
    request<ContainerTypeDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  setActive: (id: number, isActive: boolean, rowVersion: string | null) =>
    request<ContainerTypeDto>(`${BASE}/${id}/set-active`, { method: 'POST', body: { isActive, rowVersion } }),

  /** 409 IN_USE when containers use it. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
}
