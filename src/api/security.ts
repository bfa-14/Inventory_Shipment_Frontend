import { request } from './http'
import type { LoginAuditDto, LoginAuditQuery } from './types'

/** Security reporting - guarded by security.audit.view. */
export const securityApi = {
  loginAudit: (query: LoginAuditQuery = {}) => {
    const params = new URLSearchParams()
    if (query.username?.trim()) params.set('username', query.username.trim())
    if (query.onlyFailed) params.set('onlyFailed', 'true')
    if (query.take) params.set('take', String(query.take))

    const qs = params.toString()
    return request<LoginAuditDto[]>(`/api/security/login-audit${qs ? `?${qs}` : ''}`)
  },
}
