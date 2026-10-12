import { documentFilesApi } from '../documentFiles'
import { fetchBlob, request, uploadFile } from '../http'
import type {
  ItemContainersDto,
  ItemPurchaseOrdersDto,
  ItemStockBalanceDto,
  ItemStockStatementDto,
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

  /** The item's on hand in every warehouse that has held it, with the totals. */
  stockBalance: (id: number, signal?: AbortSignal) => request<ItemStockBalanceDto>(`${BASE}/${id}/stock-balance`, { signal }),

  /** The containers carrying the item, and what is still on the way. Needs containers.view. */
  containers: (id: number, signal?: AbortSignal) => request<ItemContainersDto>(`${BASE}/${id}/containers`, { signal }),

  /** The purchase orders with the item on them, and what is still on order. Needs purchase.orders.view. */
  purchaseOrders: (id: number, signal?: AbortSignal) => request<ItemPurchaseOrdersDto>(`${BASE}/${id}/purchase-orders`, { signal }),

  /** The item's stock statement across every warehouse, optionally for a date range (yyyy-MM-dd). */
  stockMovements: (id: number, filter: { from: string | null; to: string | null }, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (filter.from) params.set('from', filter.from)
    if (filter.to) params.set('to', filter.to)
    const query = params.toString()
    return request<ItemStockStatementDto>(`${BASE}/${id}/stock-movements${query ? `?${query}` : ''}`, { signal })
  },

  /**
   * Items for a dropdown, each with the SKU of its base unit: EVERY matching item (no row limit since
   * script 66), loaded once and searched in the browser.
   *
   * `salesOnly` keeps only the items with a unit that may be sold, and reports that unit rather
   * than the base one — the sales invoice passes it, because it cannot sell the others.
   * `bivacOnly` keeps only the items with "BIVAC Item" ticked — a document type whose
   * `bivacItemsOnly` is set (BIVAC Out) passes it, because the server refuses the others.
   */
  lookup: (activeOnly = true, includeId?: number, signal?: AbortSignal, salesOnly = false, bivacOnly = false) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (includeId !== undefined) params.set('includeId', String(includeId))
    if (salesOnly) params.set('salesOnly', 'true')
    if (bivacOnly) params.set('bivacOnly', 'true')
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
   * The item's documents (script 67): the same calls, fields and rules as every document's files - a type (only
   * the types used for items), the date on the document, a note, up to 20 MB - so the Item Definition page lists them
   * with the shared AttachmentsPanel (kind ITEM). The list never holds the item's picture.
   */
  files: documentFilesApi(BASE),

  /**
   * The item's PICTURE (JPEG, PNG or WebP, up to 5 MB, no type): it replaces whatever image the item had. Not one of
   * the documents - those go through `files.add` - and never in their list.
   */
  addImage: (itemId: number, file: File) =>
    uploadFile<ItemFileDto>(`${BASE}/${itemId}/files?isItemImage=true`, file),

  /**
   * The file's bytes. An `<img src>` cannot carry the bearer token, so the caller turns this Blob
   * into an object URL and revokes it when it is finished with it.
   */
  fileBlob: (itemId: number, fileId: number, signal?: AbortSignal) =>
    fetchBlob(`${BASE}/${itemId}/files/${fileId}`, signal),

  /** Removes the picture (a document is removed through `files.remove`). */
  removeFile: (itemId: number, fileId: number) =>
    request<void>(`${BASE}/${itemId}/files/${fileId}`, { method: 'DELETE' }),
}
