import { request } from './http'
import type {
  CreateUserRequest,
  SetUserWarehousesRequest,
  UpdateUserRequest,
  UserDto,
  UserWarehousesDto,
} from './types'

/** User administration - guarded by the security.users.* permissions. */
export const usersApi = {
  list: () => request<UserDto[]>('/api/users'),

  get: (id: number) => request<UserDto>(`/api/users/${id}`),

  create: (payload: CreateUserRequest) => request<UserDto>('/api/users', { method: 'POST', body: payload }),

  update: (id: number, payload: UpdateUserRequest) =>
    request<void>(`/api/users/${id}`, { method: 'PUT', body: payload }),

  setStatus: (id: number, isActive: boolean) =>
    request<void>(`/api/users/${id}/status`, { method: 'PATCH', body: { isActive } }),

  resetPassword: (id: number, newPassword: string) =>
    request<void>(`/api/users/${id}/reset-password`, { method: 'POST', body: { newPassword } }),

  setRoles: (id: number, roleIds: number[]) =>
    request<void>(`/api/users/${id}/roles`, { method: 'PUT', body: { roleIds } }),

  /** (92) Where the user may move stock: the ticks, how many warehouses they give, and every change made. */
  getWarehouses: (id: number) => request<UserWarehousesDto>(`/api/users/${id}/warehouses`),

  /** (92) Needs `security.users.edit`. Answers the dialog read again (the server's `usableCount`, the new history row). */
  setWarehouses: (id: number, payload: SetUserWarehousesRequest) =>
    request<UserWarehousesDto>(`/api/users/${id}/warehouses`, { method: 'PUT', body: payload }),
}
