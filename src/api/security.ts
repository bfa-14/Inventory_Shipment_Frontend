import { request } from './http'
import type { LoginAuditDto, LoginAuditQuery, UserLookupDto } from './types'

/** Security reporting (security.audit.view) and the users dropdown (any signed-in user). */
export const securityApi = {
  /** `signal` lets a grid abandon this request when the reader edits the filters again. */
  loginAudit: (query: LoginAuditQuery = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.username?.trim()) params.set('username', query.username.trim())
    if (query.onlyFailed) params.set('onlyFailed', 'true')
    if (query.take) params.set('take', String(query.take))

    const qs = params.toString()
    return request<LoginAuditDto[]>(`/api/security/login-audit${qs ? `?${qs}` : ''}`, { signal })
  },

  /**
   * Users for a "pick a user" dropdown - the Parties form's Linked user field. Readable by any
   * signed-in user and deliberately thin: no e-mail, roles or sign-in history. `includeId` keeps
   * one user in the result even when it is inactive, so an edit form still shows the linked user.
   */
  userLookup: (
    options: { search?: string; activeOnly?: boolean; includeId?: number; top?: number } = {},
  ) => {
    const { search, activeOnly = true, includeId, top } = options
    const params = new URLSearchParams({ activeOnly: String(activeOnly) })
    if (search?.trim()) params.set('search', search.trim())
    if (includeId !== undefined) params.set('includeId', String(includeId))
    if (top !== undefined) params.set('top', String(top))
    return request<UserLookupDto[]>(`/api/security/users/lookup?${params.toString()}`)
  },
}
