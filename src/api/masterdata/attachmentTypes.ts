import type { AttachmentDocumentKind } from '../documentFiles'
import { request } from '../http'
import type { PagedResult } from '../types'

/**
 * What a file is: a category (Shipping, Purchase...) and a sub type (Bill of Lading, Proforma Invoice...), and the
 * document kinds whose upload dialogs offer it ("Used for"). The list page and the writes need
 * `masterdata.attachmenttypes.manage`; what an upload dialog reads (a kind's types, the lookup, the kinds) is open
 * to any signed-in user.
 */
const BASE = '/api/masterdata/attachment-types'

/** The categories the seed data uses. The column is free text; these are offered, not enforced. */
export const ATTACHMENT_CATEGORIES = [
  'Container', 'Purchase', 'Sales', 'Shipping', 'Customs', 'Transport', 'Delivery', 'Returns', 'Payment', 'Bank', 'Cheque', 'Other',
]

/** The type's former single list (Logistics / Receipt). Kept by the API, no longer read: "Used for" replaced it. */
export type AttachmentAppliesTo = 'Logistics' | 'Receipt'

/** A document kind a type can be used for: { code: 'PO', name: 'Purchase orders' }. */
export interface AttachmentDocumentKindDto {
  code: AttachmentDocumentKind
  name: string
}

export interface AttachmentTypeDto {
  id: number
  category: string
  subType: string
  appliesTo: AttachmentAppliesTo
  sortOrder: number
  isActive: boolean
  /** The document kinds whose upload dialogs offer it, in the order of the kinds list. */
  usedFor: AttachmentDocumentKind[]
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
  /** Without a document kind: both; with one, the API answers the active ones unless this says otherwise. */
  isActive?: boolean
  /** The types used for this kind. */
  documentKind?: AttachmentDocumentKind
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface SaveAttachmentTypeRequest {
  category: string
  subType: string
  /** At least one. */
  usedFor: AttachmentDocumentKind[]
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
    if (query.documentKind) params.set('documentKind', query.documentKind)
    if (query.sortBy) params.set('sortBy', query.sortBy)
    if (query.sortDir) params.set('sortDir', query.sortDir)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    return request<PagedResult<AttachmentTypeDto>>(`${BASE}?${params.toString()}`, { signal })
  },

  /**
   * What an upload dialog offers: the active types used for the document kind. `includeId` adds the type a file
   * already has (an inactive one, or one no longer used for the kind) so its edit dialog can show it.
   */
  forKind: (documentKind: AttachmentDocumentKind, includeId?: number | null) => {
    const params = new URLSearchParams({ documentKind })
    if (includeId) params.set('includeId', String(includeId))
    return request<AttachmentTypeLookupDto[]>(`${BASE}/lookup?${params.toString()}`)
  },

  /** The kinds a type can be used for, in the order of the pages. */
  documentKinds: () => request<AttachmentDocumentKindDto[]>(`${BASE}/document-kinds`),

  get: (id: number) => request<AttachmentTypeDto>(`${BASE}/${id}`),

  create: (payload: SaveAttachmentTypeRequest) => request<AttachmentTypeDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveAttachmentTypeRequest) =>
    request<AttachmentTypeDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  setActive: (id: number, isActive: boolean, rowVersion: string | null) =>
    request<AttachmentTypeDto>(`${BASE}/${id}/set-active`, { method: 'POST', body: { isActive, rowVersion } }),

  /** 409 IN_USE when files use it. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
}
