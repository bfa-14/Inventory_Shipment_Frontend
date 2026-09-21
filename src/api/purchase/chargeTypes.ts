import { request } from '../http'
import type { PagedResult } from '../types'

/**
 * Purchase charge types (US-MD-008): freight, customs, clearing — what each is called, how it is
 * spread over the goods, and whether it reaches the item cost at all.
 *
 * SETUP RATHER THAN BUYING: the writes need `purchase.chargetypes.manage`, which lives under
 * Configuration. The LOOKUP is open to any signed-in user, because every charge line names one.
 */
const BASE = '/api/purchase/charge-types'

export type ChargeAllocationMethod = 'Value' | 'Quantity' | 'Weight' | 'Volume' | 'Manual'

export const CHARGE_ALLOCATION_METHODS: ChargeAllocationMethod[] = ['Value', 'Quantity', 'Weight', 'Volume', 'Manual']

/** What the reader sees instead of the stored word. "Value" alone does not say value of what. */
export const ALLOCATION_METHOD_LABELS: Record<ChargeAllocationMethod, string> = {
  Value: 'By Item Value',
  Quantity: 'By Quantity',
  Weight: 'By Weight',
  Volume: 'By Volume (CBM)',
  Manual: 'Manual',
}

/** The two methods that need a figure on the item; the posting refuses when an item has none. */
export const METHODS_NEEDING_ITEM_DATA: Record<string, string> = {
  Weight: 'Items need Weight (kg) in Item Definition',
  Volume: 'Items need Volume (CBM) in Item Definition',
}

export function allocationMethodLabel(method: string): string {
  return ALLOCATION_METHOD_LABELS[method as ChargeAllocationMethod] ?? method
}

export interface ChargeTypeDto {
  id: number
  chargeCode: string
  chargeName: string
  allocationMethod: ChargeAllocationMethod
  includeInLandedCost: boolean
  isRecoverableTax: boolean
  description: string | null
  isActive: boolean
  /** How many charge lines use it. Zero is what makes it deletable. */
  usageCount: number
  createdAtUtc: string
  updatedAtUtc: string | null
  rowVersion: string
  canDelete: boolean
}

/** What a charge line's dropdown needs: the defaults picking a type fills in. */
export interface ChargeTypeLookupDto {
  id: number
  chargeCode: string
  chargeName: string
  allocationMethod: ChargeAllocationMethod
  includeInLandedCost: boolean
  isRecoverableTax: boolean
  isActive: boolean
}

export interface ChargeTypeQuery {
  search?: string
  allocationMethod?: string
  /** The "cost impact" filter: true = included in the landed cost. */
  includeInLandedCost?: boolean
  isActive?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface SaveChargeTypeRequest {
  chargeCode: string
  chargeName: string
  allocationMethod: ChargeAllocationMethod
  includeInLandedCost: boolean
  isRecoverableTax: boolean
  description: string | null
  isActive: boolean
  rowVersion?: string | null
}

export const chargeTypesApi = {
  list: (query: ChargeTypeQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.allocationMethod) params.set('allocationMethod', query.allocationMethod)
    if (query.includeInLandedCost !== undefined) params.set('includeInLandedCost', String(query.includeInLandedCost))
    if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
    if (query.sortBy) params.set('sortBy', query.sortBy)
    if (query.sortDir) params.set('sortDir', query.sortDir)
    if (query.page !== undefined) params.set('page', String(query.page))
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
    return request<PagedResult<ChargeTypeDto>>(`${BASE}?${params.toString()}`, { signal })
  },

  /** For the charge lines of an invoice or an adjustment. Any signed-in user. */
  lookup: (activeOnly = true, includeId?: number) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (includeId !== undefined) params.set('includeId', String(includeId))
    return request<ChargeTypeLookupDto[]>(`${BASE}/lookup?${params.toString()}`)
  },

  get: (id: number) => request<ChargeTypeDto>(`${BASE}/${id}`),

  create: (payload: SaveChargeTypeRequest) => request<ChargeTypeDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveChargeTypeRequest) =>
    request<ChargeTypeDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  setActive: (id: number, isActive: boolean, rowVersion: string | null) =>
    request<ChargeTypeDto>(`${BASE}/${id}/active`, { method: 'PATCH', body: { isActive, rowVersion } }),

  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
}
