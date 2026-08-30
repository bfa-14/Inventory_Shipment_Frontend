import { request } from './http'
import type { PermissionModuleDto } from './types'

/** The read-only permission catalog - guarded by security.permissions.view. */
export const permissionsApi = {
  catalog: () => request<PermissionModuleDto[]>('/api/permissions'),
}
