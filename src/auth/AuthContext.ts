import { createContext } from 'react'
import type { UserDto } from '../api/types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthContextValue {
  status: AuthStatus
  user: UserDto | null
  accessTokenExpiresAtUtc: string | null
  /** Signs in and returns the profile, so callers can route by permission immediately. */
  login(username: string, password: string): Promise<UserDto>
  logout(): Promise<void>
  logoutEverywhere(): Promise<void>
  /** Force a token rotation now (normally happens automatically on the first 401). */
  refresh(): Promise<boolean>
  /** Re-read the profile from the API (e.g. after a change). */
  reloadUser(): Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
