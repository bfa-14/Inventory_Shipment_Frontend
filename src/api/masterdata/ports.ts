import { request } from '../http'
import type { PagedResult } from '../types'

/**
 * Ports, border posts and inland places: where a container is loaded, where it lands, where it ends,
 * and where its route events happen. Writes need `masterdata.ports.manage`; the lookup is open.
 */
const BASE = '/api/masterdata/ports'

export type PortKind = 'Sea' | 'Inland' | 'Border' | 'Air'
export const PORT_KINDS: PortKind[] = ['Sea', 'Inland', 'Border', 'Air']

export interface PortDto {
  id: number
  portCode: string
  portName: string
  /** ISO 3166-1 alpha-2. */
  countryCode: string | null
  kind: PortKind
  isActive: boolean
  createdAtUtc: string
  updatedAtUtc: string | null
  rowVersion: string
}

export interface PortLookupDto {
  id: number
  portCode: string
  portName: string
  countryCode: string | null
  kind: PortKind
  isActive: boolean
}

export interface PortQuery {
  search?: string
  kind?: PortKind
  isActive?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface SavePortRequest {
  portCode: string
  portName: string
  countryCode: string | null
  kind: PortKind
  isActive: boolean
  rowVersion?: string | null
}

/** "Dar es Salaam (TZ)" */
export function portLabel(port: { portName: string; countryCode: string | null }): string {
  return port.countryCode ? `${port.portName} (${port.countryCode})` : port.portName
}

export const portsApi = {
  list: (query: PortQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.kind) params.set('kind', query.kind)
    if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
    if (query.sortBy) params.set('sortBy', query.sortBy)
    if (query.sortDir) params.set('sortDir', query.sortDir)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    return request<PagedResult<PortDto>>(`${BASE}?${params.toString()}`, { signal })
  },

  lookup: (activeOnly = true, kind?: PortKind, includeId?: number) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (kind) params.set('kind', kind)
    if (includeId !== undefined) params.set('includeId', String(includeId))
    return request<PortLookupDto[]>(`${BASE}/lookup?${params.toString()}`)
  },

  get: (id: number) => request<PortDto>(`${BASE}/${id}`),

  create: (payload: SavePortRequest) => request<PortDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SavePortRequest) => request<PortDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  setActive: (id: number, isActive: boolean, rowVersion: string | null) =>
    request<PortDto>(`${BASE}/${id}/set-active`, { method: 'POST', body: { isActive, rowVersion } }),

  /** 409 IN_USE when a container or a route event uses it. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
}
