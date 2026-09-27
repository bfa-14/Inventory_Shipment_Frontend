import { request } from '../http'
import type { PagedResult } from '../types'

/**
 * Movement types: the legs a container's route is made of. The STAGE is what moves the container
 * status when a movement of the type starts or completes. Writes need
 * `masterdata.movementtypes.manage`; the lookup needs `containers.view`.
 */
const BASE = '/api/masterdata/movement-types'

export type MovementStage = 'Origin' | 'Sea' | 'Transit' | 'Port' | 'Border' | 'Customs' | 'Delivery'

/** Each stage and, in one line, what it does to the containers. */
export const MOVEMENT_STAGES: { value: MovementStage; label: string; explanation: string }[] = [
  { value: 'Origin', label: 'Origin', explanation: 'Loading at the supplier - no status change.' },
  { value: 'Sea', label: 'Sea', explanation: 'In transit when started, at port when completed.' },
  { value: 'Transit', label: 'Transit', explanation: 'In transit (transshipment, inland transport).' },
  { value: 'Port', label: 'Port', explanation: 'At port (port arrival).' },
  { value: 'Border', label: 'Border', explanation: 'In transit, records the border crossing date.' },
  { value: 'Customs', label: 'Customs', explanation: 'Cleared when completed (customs release date).' },
  { value: 'Delivery', label: 'Delivery', explanation: 'Cleared - on its way to the warehouse.' },
]

export function stageExplanation(stage: string): string {
  return MOVEMENT_STAGES.find((s) => s.value === stage)?.explanation ?? ''
}

/** Stages whose movement stays at one place: "to" defaults to "from". */
export const SINGLE_PLACE_STAGES: MovementStage[] = ['Port', 'Customs', 'Border']

export interface MovementTypeDto {
  id: number
  typeCode: string
  typeName: string
  stage: MovementStage
  sortOrder: number
  isActive: boolean
  /** Movements using the type (list only). */
  usedCount: number
  createdAtUtc: string
  updatedAtUtc: string | null
  rowVersion: string
}

export interface MovementTypeLookupDto {
  id: number
  typeCode: string
  typeName: string
  stage: MovementStage
  sortOrder: number
  isActive: boolean
}

export interface MovementTypeQuery {
  search?: string
  stage?: MovementStage
  isActive?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface SaveMovementTypeRequest {
  typeCode: string
  typeName: string
  stage: MovementStage
  sortOrder: number
  isActive: boolean
  rowVersion?: string | null
}

function qs(query: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || String(value).trim() === '') continue
    params.set(key, String(value).trim())
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export const movementTypesApi = {
  list: (query: MovementTypeQuery, signal?: AbortSignal) =>
    request<PagedResult<MovementTypeDto>>(`${BASE}${qs(query)}`, { signal }),

  lookup: (activeOnly = true, includeId?: number) =>
    request<MovementTypeLookupDto[]>(`${BASE}/lookup${qs({ activeOnly, includeId })}`),

  get: (id: number) => request<MovementTypeDto>(`${BASE}/${id}`),

  /** 409 DUPLICATE when the code is taken. */
  create: (payload: SaveMovementTypeRequest) => request<MovementTypeDto>(BASE, { method: 'POST', body: payload }),

  /** 409 IN_USE when the stage of a type used by movements is changed. */
  update: (id: number, payload: SaveMovementTypeRequest) =>
    request<MovementTypeDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  setActive: (id: number, isActive: boolean, rowVersion?: string | null) =>
    request<MovementTypeDto>(`${BASE}/${id}/set-active`, { method: 'POST', body: { isActive, rowVersion: rowVersion ?? null } }),

  /** 409 IN_USE when movements use it. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
}
