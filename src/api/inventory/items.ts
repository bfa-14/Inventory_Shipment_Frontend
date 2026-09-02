import { fetchBlob, request, uploadFile } from '../http'
import type {
  ItemDetailsDto,
  ItemFileDto,
  ItemListDto,
  ItemLookupDto,
  ItemQuery,
  ItemUnitDto,
  PagedResult,
  SaveItemRequest,
  SaveItemUnitRequest,
} from '../types'

const BASE = '/api/inventory/items'

/** Builds the query string, leaving out anything the user did not set. */
function toQueryString(query: ItemQuery): string {
  const params = new URLSearchParams()

  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.itemFamilyId !== undefined) params.set('itemFamilyId', String(query.itemFamilyId))
  if (query.brandId !== undefined) params.set('brandId', String(query.brandId))
  if (query.defaultWarehouseId !== undefined) params.set('defaultWarehouseId', String(query.defaultWarehouseId))
  if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
  if (query.isBivac !== undefined) params.set('isBivac', String(query.isBivac))
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.sortDir) params.set('sortDir', query.sortDir)
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))

  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/**
 * Item definitions - guarded by the inventory.items.* permissions (except lookup, which any
 * signed-in user may read). Units and files are sub-resources of an item and have their own calls.
 */
export const itemsApi = {
  /** `signal` lets a grid abandon this request when the reader edits the filters again. */
  search: (query: ItemQuery = {}, signal?: AbortSignal) =>
    request<PagedResult<ItemListDto>>(`${BASE}${toQueryString(query)}`, { signal }),

  /** The item with its units and file metadata, in one round trip. */
  get: (id: number, signal?: AbortSignal) => request<ItemDetailsDto>(`${BASE}/${id}`, { signal }),

  /** Items for a dropdown, each with the SKU of its base unit. */
  lookup: (activeOnly = true, includeId?: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (includeId !== undefined) params.set('includeId', String(includeId))
    return request<ItemLookupDto[]>(`${BASE}/lookup?${params.toString()}`, { signal })
  },

  create: (payload: SaveItemRequest) => request<ItemDetailsDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveItemRequest) =>
    request<ItemDetailsDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  /** Answers 204. */
  setStatus: (id: number, isActive: boolean) =>
    request<void>(`${BASE}/${id}/status`, { method: 'PUT', body: { isActive } }),

  /** Removes the item with its units and files; 409 REFERENCED when anything points at it. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  // ----- units -----

  /** Adds a packing unit and answers with the item's refreshed unit list. */
  addUnit: (itemId: number, payload: SaveItemUnitRequest) =>
    request<ItemUnitDto[]>(`${BASE}/${itemId}/units`, { method: 'POST', body: payload }),

  /** Edits a packing unit and answers with the item's refreshed unit list. */
  updateUnit: (itemId: number, unitId: number, payload: SaveItemUnitRequest) =>
    request<ItemUnitDto[]>(`${BASE}/${itemId}/units/${unitId}`, { method: 'PUT', body: payload }),

  removeUnit: (itemId: number, unitId: number) =>
    request<void>(`${BASE}/${itemId}/units/${unitId}`, { method: 'DELETE' }),

  // ----- files -----

  /**
   * Uploads a file as multipart/form-data. With `isItemImage` it becomes the item's picture and
   * replaces whatever image the item had.
   */
  addFile: (itemId: number, file: File, isItemImage = false) =>
    uploadFile<ItemFileDto>(`${BASE}/${itemId}/files?isItemImage=${String(isItemImage)}`, file),

  /**
   * The file's bytes. An `<img src>` cannot carry the bearer token, so the caller turns this Blob
   * into an object URL and revokes it when it is finished with it.
   */
  fileBlob: (itemId: number, fileId: number, signal?: AbortSignal) =>
    fetchBlob(`${BASE}/${itemId}/files/${fileId}`, signal),

  removeFile: (itemId: number, fileId: number) =>
    request<void>(`${BASE}/${itemId}/files/${fileId}`, { method: 'DELETE' }),
}
