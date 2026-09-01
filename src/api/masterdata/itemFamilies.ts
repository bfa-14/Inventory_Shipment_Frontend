import { request } from '../http'
import type { ItemFamilyDto, ItemFamilyLookupDto, NextCodeDto, SaveItemFamilyRequest } from '../types'

const BASE = '/api/masterdata/item-families'

/**
 * Item families master data - guarded by the masterdata.itemfamilies.* permissions (except lookup
 * and next-code, which any signed-in user may read).
 *
 * There is no search endpoint: the tree comes down whole and the page filters it in the browser,
 * because paging cannot work on a hierarchy.
 */
export const itemFamiliesApi = {
  /**
   * Every family as a flat list, ordered by level then code. `signal` lets a reload abandon the
   * request when another one starts.
   */
  tree: (signal?: AbortSignal) => request<ItemFamilyDto[]>(`${BASE}/tree`, { signal }),

  get: (id: number) => request<ItemFamilyDto>(`${BASE}/${id}`),

  /**
   * Families for a dropdown. `includeId` keeps one family in the list even when it is inactive, so
   * an edit form still shows the family the record currently points at.
   */
  lookup: (activeOnly = true, includeId?: number) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (includeId !== undefined) params.set('includeId', String(includeId))
    return request<ItemFamilyLookupDto[]>(`${BASE}/lookup?${params.toString()}`)
  },

  /**
   * The code the API suggests for a new family under `parentId` - `FAM-###` for a root,
   * `<parent code>-##` below one. Only a suggestion: the user may replace it before saving.
   */
  nextCode: (parentId?: number | null, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (parentId != null) params.set('parentId', String(parentId))
    const qs = params.toString()
    return request<NextCodeDto>(`${BASE}/next-code${qs ? `?${qs}` : ''}`, { signal })
  },

  create: (payload: SaveItemFamilyRequest) =>
    request<ItemFamilyDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveItemFamilyRequest) =>
    request<ItemFamilyDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  /** Answers 204. Deactivating cascades to the whole subtree; activating touches only this family. */
  setStatus: (id: number, isActive: boolean) =>
    request<void>(`${BASE}/${id}/status`, { method: 'PUT', body: { isActive } }),

  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),
}
