import { request } from '../http'
import type { BranchDto, BranchLookupDto, BranchQuery, PagedResult, SaveBranchRequest } from '../types'

/** Builds the query string, leaving out anything the user did not set. */
function toQueryString(query: BranchQuery): string {
  const params = new URLSearchParams()

  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.isActive !== undefined) params.set('isActive', String(query.isActive))
  if (query.isMainBranch !== undefined) params.set('isMainBranch', String(query.isMainBranch))
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.sortDir) params.set('sortDir', query.sortDir)
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))

  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Branches / sites master data - guarded by the masterdata.branches.* permissions. */
export const branchesApi = {
  search: (query: BranchQuery = {}) =>
    request<PagedResult<BranchDto>>(`/api/masterdata/branches${toQueryString(query)}`),

  get: (id: number) => request<BranchDto>(`/api/masterdata/branches/${id}`),

  /** The branch currently flagged as the Main Branch; 404 when there is none. */
  getMain: () => request<BranchDto>('/api/masterdata/branches/main'),

  /**
   * Branches for a Branch / Site dropdown. Readable by any signed-in user, because every master-data
   * form with a branch picker needs it. `includeId` keeps one branch in the list even when it is
   * inactive, so an edit form still shows the branch the record currently points at.
   */
  lookup: (activeOnly = true, includeId?: number) => {
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (includeId !== undefined) params.set('includeId', String(includeId))
    return request<BranchLookupDto[]>(`/api/masterdata/branches/lookup?${params.toString()}`)
  },

  create: (payload: SaveBranchRequest) =>
    request<BranchDto>('/api/masterdata/branches', { method: 'POST', body: payload }),

  update: (id: number, payload: SaveBranchRequest) =>
    request<BranchDto>(`/api/masterdata/branches/${id}`, { method: 'PUT', body: payload }),

  setStatus: (id: number, isActive: boolean) =>
    request<BranchDto>(`/api/masterdata/branches/${id}/status`, { method: 'PATCH', body: { isActive } }),

  remove: (id: number) => request<void>(`/api/masterdata/branches/${id}`, { method: 'DELETE' }),
}
