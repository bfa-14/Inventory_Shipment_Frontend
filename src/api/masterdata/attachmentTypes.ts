import { request } from '../http'
import type { PagedResult } from '../types'

/**
 * What a container file is: a category (Shipping, Customs...) and a sub type (Bill of Lading, FERI...).
 * Writes need `masterdata.attachmenttypes.manage`; the lookup is open to any signed-in user.
 */
const BASE = '/api/masterdata/attachment-types'

/** The categories the seed data uses. The column is free text; these are offered, not enforced. */
export const ATTACHMENT_CATEGORIES = ['Container', 'Purchase', 'Shipping', 'Customs', 'Transport', 'Delivery', 'Bank', 'Cheque', 'Other']

/** Which screens offer the type: the container pages (Logistics), customer receipts (Receipt) or supplier payments (Payment). */
export type AttachmentAppliesTo = 'Logistics' | 'Receipt' | 'Payment'

export const ATTACHMENT_APPLIES_TO: { value: AttachmentAppliesTo; label: string }[] = [
  { value: 'Logistics', label: 'Containers' },
  { value: 'Receipt', label: 'Receipts' },
  { value: 'Payment', label: 'Supplier payments' },
]

export function appliesToLabel(value: AttachmentAppliesTo): string {
  return ATTACHMENT_APPLIES_TO.find((a) => a.value === value)?.label ?? value
}

export interface AttachmentTypeDto {
  id: number
  category: string
  subType: string
  appliesTo: AttachmentAppliesTo
  sortOrder: number
  isActive: boolean
  createdAtUtc: string
  updatedAtUtc: string | null
  rowVersion: string
}

export interface AttachmentTypeLookupDto {
  id: number
  category: string
  subType: string
  /** "Shipping / Bill of Lading" */
  displayName: string
  sortOrder: number
  isActive: boolean
}

export interface AttachmentTypeQuery {
  search?: string
  category?: string
  isActive?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface SaveAttachmentTypeRequest {
  category: string
  subType: string
  appliesTo: AttachmentAppliesTo
  sortOrder: number
  isActive: boolean
  rowVersion?: string | null
}

export const attachmentTypesApi = {
  list: (query: AttachmentTypeQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.category) params.set('category', query.category)
    if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
    if (query.sortBy) params.set('sortBy', query.sortBy)
    if (query.sortDir) params.set('sortDir', query.sortDir)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    return request<PagedResult<AttachmentTypeDto>>(`${BASE}?${params.toString()}`, { signal })
  },

  /** `appliesTo` keeps the two worlds apart: 'Logistics' for container files, 'Receipt' for receipts. */
  lookup: (activeOnly = true, includeId?: number, appliesTo?: AttachmentAppliesTo) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (includeId !== undefined) params.set('includeId', String(includeId))
    if (appliesTo) params.set('appliesTo', appliesTo)
    return request<AttachmentTypeLookupDto[]>(`${BASE}/lookup?${params.toString()}`)
  },

  get: (id: number) => request<AttachmentTypeDto>(`${BASE}/${id}`),

  create: (payload: SaveAttachmentTypeRequest) => request<AttachmentTypeDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveAttachmentTypeRequest) =>
    request<AttachmentTypeDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  setActive: (id: number, isActive: boolean, rowVersion: string | null) =>
    request<AttachmentTypeDto>(`${BASE}/${id}/set-active`, { method: 'POST', body: { isActive, rowVersion } }),

  /** 409 IN_USE when container files use it. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
}
