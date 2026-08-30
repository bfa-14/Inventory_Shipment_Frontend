import { request } from './http'
import type { LoginAuditDto, LoginAuditQuery } from './types'

/** Security reporting - guarded by security.audit.view. */
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
}
