import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { authApi } from '../api/auth'
import { ApiError, configureHttp } from '../api/http'
import type { UserDto } from '../api/types'
import { AuthContext, type AuthContextValue, type AuthStatus } from './AuthContext'
import { loadSession, saveSession, toSession, type StoredSession } from './session'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<UserDto | null>(null)
  const [accessTokenExpiresAtUtc, setAccessTokenExpiresAtUtc] = useState<string | null>(null)

  // The session lives in a ref so the HTTP layer always sees the latest tokens without re-renders.
  const sessionRef = useRef<StoredSession | null>(null)
  const refreshInFlight = useRef<Promise<string | null> | null>(null)

  const applySession = useCallback((session: StoredSession | null) => {
    sessionRef.current = session
    saveSession(session)
    setUser(session?.user ?? null)
    setAccessTokenExpiresAtUtc(session?.accessTokenExpiresAtUtc ?? null)
    setStatus(session ? 'authenticated' : 'anonymous')
  }, [])

  /** Rotates the refresh token. Concurrent callers share one in-flight request. */
  const refreshAccessToken = useCallback((): Promise<string | null> => {
    if (refreshInFlight.current) return refreshInFlight.current

    const current = sessionRef.current
    if (!current) return Promise.resolve(null)

    const task = (async () => {
      try {
        const response = await authApi.refresh(current.refreshToken)
        const next = toSession(response)
        applySession(next)
        return next.accessToken
      } catch {
        applySession(null)
        return null
      } finally {
        refreshInFlight.current = null
      }
    })()

    refreshInFlight.current = task
    return task
  }, [applySession])

  // Plug the token hooks into the HTTP layer.
  useEffect(() => {
    configureHttp({
      getAccessToken: () => sessionRef.current?.accessToken ?? null,
      refreshAccessToken,
      onSessionExpired: () => applySession(null),
    })
    return () => configureHttp(null)
  }, [refreshAccessToken, applySession])

  // On start-up: restore the stored session and confirm it with the API.
  useEffect(() => {
    let cancelled = false

    async function restore() {
      const stored = loadSession()
      if (!stored) {
        if (!cancelled) setStatus('anonymous')
        return
      }

      sessionRef.current = stored
      try {
        const profile = await authApi.me() // renews the access token automatically if it expired
        if (cancelled) return
        applySession({ ...(sessionRef.current ?? stored), user: profile })
      } catch (error) {
        if (cancelled) return
        // 401 after a failed refresh -> onSessionExpired already cleared the session.
        // Any other error (API down): keep the stored session so a reload works once the API is back.
        if (error instanceof ApiError && error.status === 401) applySession(null)
        else if (sessionRef.current) applySession(sessionRef.current)
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [applySession])

  const login = useCallback(
    async (username: string, password: string) => {
      const response = await authApi.login({ username, password })
      applySession(toSession(response))
      return response.user
    },
    [applySession],
  )

  const logout = useCallback(async () => {
    const current = sessionRef.current
    if (current) {
      try {
        await authApi.logout(current.refreshToken)
      } catch {
        // The server-side token may already be gone; the local session is cleared regardless.
      }
    }
    applySession(null)
  }, [applySession])

  const logoutEverywhere = useCallback(async () => {
    try {
      await authApi.logoutAll()
    } finally {
      applySession(null)
    }
  }, [applySession])

  const refresh = useCallback(async () => (await refreshAccessToken()) !== null, [refreshAccessToken])

  const reloadUser = useCallback(async () => {
    const profile = await authApi.me()
    const current = sessionRef.current
    if (current) applySession({ ...current, user: profile })
  }, [applySession])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, accessTokenExpiresAtUtc, login, logout, logoutEverywhere, refresh, reloadUser }),
    [status, user, accessTokenExpiresAtUtc, login, logout, logoutEverywhere, refresh, reloadUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
