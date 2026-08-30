import type { AuthResponse, UserDto } from '../api/types'

/**
 * What survives a page reload. Kept in sessionStorage: it is cleared when the tab closes and is
 * not shared between tabs. (For a hardened production setup, keep the access token in memory only
 * and have the API issue the refresh token as an HttpOnly cookie.)
 */
export interface StoredSession {
  accessToken: string
  accessTokenExpiresAtUtc: string
  refreshToken: string
  refreshTokenExpiresAtUtc: string
  user: UserDto
}

const STORAGE_KEY = 'inventory_shipment.session'

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredSession>
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user) return null
    return parsed as StoredSession
  } catch {
    return null
  }
}

export function saveSession(session: StoredSession | null): void {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode, quota): the app keeps working in memory only.
  }
}

export function toSession(response: AuthResponse): StoredSession {
  return {
    accessToken: response.accessToken,
    accessTokenExpiresAtUtc: response.accessTokenExpiresAtUtc,
    refreshToken: response.refreshToken,
    refreshTokenExpiresAtUtc: response.refreshTokenExpiresAtUtc,
    user: response.user,
  }
}
