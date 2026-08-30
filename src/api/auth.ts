import { request } from './http'
import type { AuthResponse, ChangePasswordRequest, LoginRequest, UserDto } from './types'

export const authApi = {
  login: (credentials: LoginRequest) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: credentials, auth: false }),

  refresh: (refreshToken: string) =>
    request<AuthResponse>('/api/auth/refresh', { method: 'POST', body: { refreshToken }, auth: false }),

  logout: (refreshToken: string) =>
    request<void>('/api/auth/logout', { method: 'POST', body: { refreshToken } }),

  logoutAll: () => request<void>('/api/auth/logout-all', { method: 'POST' }),

  me: () => request<UserDto>('/api/auth/me'),

  changePassword: (payload: ChangePasswordRequest) =>
    request<void>('/api/auth/change-password', { method: 'POST', body: payload }),
}
