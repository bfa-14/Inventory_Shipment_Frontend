import { request } from './http'
import type { CreateRoleRequest, RoleDetailDto, RoleDto, UpdateRoleRequest } from './types'

/** Roles and their permissions - guarded by security.roles.view / security.roles.manage. */
export const rolesApi = {
  list: () => request<RoleDto[]>('/api/roles'),

  get: (id: number) => request<RoleDetailDto>(`/api/roles/${id}`),

  create: (payload: CreateRoleRequest) => request<RoleDetailDto>('/api/roles', { method: 'POST', body: payload }),

  update: (id: number, payload: UpdateRoleRequest) =>
    request<void>(`/api/roles/${id}`, { method: 'PUT', body: payload }),

  remove: (id: number) => request<void>(`/api/roles/${id}`, { method: 'DELETE' }),

  setPermissions: (id: number, permissionIds: number[]) =>
    request<void>(`/api/roles/${id}/permissions`, { method: 'PUT', body: { permissionIds } }),
}
