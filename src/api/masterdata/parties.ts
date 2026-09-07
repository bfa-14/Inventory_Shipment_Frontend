import { request } from '../http'
import type {
  NextCodeDto,
  PagedResult,
  PartyDto,
  PartyLookupDto,
  PartyQuery,
  PartyTypeName,
  SavePartyRequest,
} from '../types'

/** Builds the query string, leaving out anything the user did not set. */
function toQueryString(query: PartyQuery): string {
  const params = new URLSearchParams()

  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.partyType) params.set('partyType', query.partyType)
  if (query.branchId !== undefined) params.set('branchId', String(query.branchId))
  if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.sortDir) params.set('sortDir', query.sortDir)
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))

  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Parties master data - guarded by the masterdata.parties.* permissions (except lookup and next-code). */
export const partiesApi = {
  /** `signal` lets a grid abandon this request when the reader edits the filters again. */
  search: (query: PartyQuery = {}, signal?: AbortSignal) =>
    request<PagedResult<PartyDto>>(`/api/masterdata/parties${toQueryString(query)}`, { signal }),

  get: (id: number) => request<PartyDto>(`/api/masterdata/parties/${id}`),

  /**
   * Parties for a typed dropdown - the suppliers on a purchase order, the clients on an invoice.
   * Readable by any signed-in user, because every form with a party picker needs it. `includeId`
   * keeps one party in the result even when it is inactive or of another type, so an edit form
   * still shows the party the record currently points at.
   */
  lookup: (
    options: {
      partyType?: PartyTypeName
      search?: string
      activeOnly?: boolean
      includeId?: number
      top?: number
    } = {},
  ) => {
    const { partyType, search, activeOnly = true, includeId, top } = options
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (partyType) params.set('partyType', partyType)
    if (search?.trim()) params.set('search', search.trim())
    if (includeId !== undefined) params.set('includeId', String(includeId))
    if (top !== undefined) params.set('top', String(top))
    return request<PartyLookupDto[]>(`/api/masterdata/parties/lookup?${params.toString()}`)
  },

  /**
   * The code the server suggests for a new party of that type (SUP-0001, CLI-0001...). Only a
   * suggestion: the form leaves it editable.
   */
  nextCode: (partyType: PartyTypeName) =>
    request<NextCodeDto>(`/api/masterdata/parties/next-code?partyType=${partyType}`),

  create: (payload: SavePartyRequest) =>
    request<PartyDto>('/api/masterdata/parties', { method: 'POST', body: payload }),

  update: (id: number, payload: SavePartyRequest) =>
    request<PartyDto>(`/api/masterdata/parties/${id}`, { method: 'PUT', body: payload }),

  setStatus: (id: number, isActive: boolean) =>
    request<PartyDto>(`/api/masterdata/parties/${id}/status`, { method: 'PUT', body: { isActive } }),

  remove: (id: number) => request<void>(`/api/masterdata/parties/${id}`, { method: 'DELETE' }),
}
