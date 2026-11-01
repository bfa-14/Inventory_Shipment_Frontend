import type { AuthResponse, UserDto } from '../api/types'

/**
 * What survives a page reload, and what a NEW TAB of the same browser takes over: kept in localStorage, the one store
 * every tab of the app can read. (For a hardened production setup, keep the access token in memory only and have the
 * API issue the refresh token as an HttpOnly cookie.)
 *
 * ONE SESSION FOR EVERY TAB, ROTATED BY ONE TAB AT A TIME. The API rotates the refresh token at each refresh and treats
 * a rotated token presented again as stolen - it then signs the user out everywhere. So the tabs share one session: a
 * tab that refreshes writes the new one here and the others follow it (AuthProvider, the `storage` event), and a refresh
 * re-reads this store under a browser lock first, so a tab never presents a token another tab already rotated.
 *
 * CLOSING THE BROWSER STILL SIGNS OUT, as when the session lived in sessionStorage: a tab that was signed in marks its
 * own sessionStorage ({@link hasTabMark}, which a reload keeps and the browser's end clears); a tab without the mark
 * takes the stored session over only when another open tab of the app answers for it (AuthProvider), else it clears it.
 */
export interface StoredSession {
  accessToken: string
  accessTokenExpiresAtUtc: string
  refreshToken: string
  refreshTokenExpiresAtUtc: string
  user: UserDto
}

export const STORAGE_KEY = 'inventory_shipment.session'
const TAB_MARK_KEY = 'inventory_shipment.tab-signed-in'

export function parseSession(raw: string | null): StoredSession | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user) return null
    return parsed as StoredSession
  } catch {
    return null
  }
}

export function loadSession(): StoredSession | null {
  try {
    // A tab left open across the release still holds its session in sessionStorage: carried over once.
    const legacy = sessionStorage.getItem(STORAGE_KEY)
    if (legacy !== null) {
      sessionStorage.removeItem(STORAGE_KEY)
      const moved = parseSession(legacy)
      if (moved && !localStorage.getItem(STORAGE_KEY)) {
        localStorage.setItem(STORAGE_KEY, legacy)
        sessionStorage.setItem(TAB_MARK_KEY, '1')
      }
    }
    return parseSession(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export function saveSession(session: StoredSession | null): void {
  try {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
      sessionStorage.setItem(TAB_MARK_KEY, '1')
    } else {
      localStorage.removeItem(STORAGE_KEY)
      sessionStorage.removeItem(TAB_MARK_KEY)
    }
  } catch {
    // Storage unavailable (private mode, quota): the app keeps working in memory only.
  }
}

/** Was THIS tab signed in before (a reload)? A tab opened afresh has no mark. */
export function hasTabMark(): boolean {
  try {
    return sessionStorage.getItem(TAB_MARK_KEY) === '1'
  } catch {
    return false
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
