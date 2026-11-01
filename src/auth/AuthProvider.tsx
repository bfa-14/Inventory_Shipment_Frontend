import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { authApi } from '../api/auth'
import { ApiError, configureHttp } from '../api/http'
import type { UserDto } from '../api/types'
import { AuthContext, type AuthContextValue, type AuthStatus } from './AuthContext'
import { hasTabMark, loadSession, parseSession, saveSession, STORAGE_KEY, toSession, type StoredSession } from './session'

/** Where the tabs of the app speak to each other: "is anyone signed in?" and its answer. */
const CHANNEL_NAME = 'inventory_shipment.auth'
/** The browser lock one tab holds while it rotates the refresh token. */
const REFRESH_LOCK = 'inventory_shipment.auth.refresh'
/** How long a new tab waits for an open tab to answer for the stored session. */
const PING_TIMEOUT_MS = 700

type AuthMessage = { type: 'ping'; id: string } | { type: 'pong'; id: string }

function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
}

/** True when another open tab of the app answers that it is signed in, within {@link PING_TIMEOUT_MS}. */
function anotherTabIsSignedIn(): Promise<boolean> {
  const channel = openChannel()
  if (!channel) return Promise.resolve(false)
  const id = Math.random().toString(36).slice(2)
  return new Promise((resolve) => {
    const done = (answer: boolean) => {
      window.clearTimeout(timer)
      channel.close()
      resolve(answer)
    }
    const timer = window.setTimeout(() => done(false), PING_TIMEOUT_MS)
    channel.onmessage = (event: MessageEvent<AuthMessage>) => {
      if (event.data?.type === 'pong' && event.data.id === id) done(true)
    }
    channel.postMessage({ type: 'ping', id } satisfies AuthMessage)
  })
}

/** Runs `task` while holding the refresh lock across every tab (Web Locks); alone where the browser has none. */
function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(REFRESH_LOCK, task)
    : task()
}

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

    // ONE TAB ROTATES AT A TIME, and never a token another tab already rotated: the API would take a rotated token
    // presented again for a stolen one and sign the user out everywhere. So under the lock the shared store is read
    // first: a session newer than ours (another tab refreshed meanwhile) is taken as it is, without asking the API.
    const task = withRefreshLock(async () => {
      try {
        const latest = loadSession()
        if (!latest) {
          applySession(null)
          return null
        }
        if (latest.refreshToken !== current.refreshToken) {
          applySession(latest)
          return latest.accessToken
        }
        const response = await authApi.refresh(current.refreshToken)
        const next = toSession(response)
        applySession(next)
        return next.accessToken
      } catch {
        applySession(null)
        return null
      }
    }).finally(() => {
      refreshInFlight.current = null
    })

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

  // THE OTHER TABS: one that signs in, refreshes or signs out writes the shared store, and this tab follows it (the
  // `storage` event fires in every tab but the writer). Signing out in one tab signs out them all: they share one session.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return
      const next = event.key === null ? null : parseSession(event.newValue)
      if (next?.refreshToken === sessionRef.current?.refreshToken) return
      applySession(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [applySession])

  // A NEW TAB ASKS "is anyone signed in?": this tab answers while it is.
  useEffect(() => {
    const channel = openChannel()
    if (!channel) return
    channel.onmessage = (event: MessageEvent<AuthMessage>) => {
      if (event.data?.type === 'ping' && sessionRef.current) {
        channel.postMessage({ type: 'pong', id: event.data.id } satisfies AuthMessage)
      }
    }
    return () => channel.close()
  }, [])

  // On start-up: restore the stored session and confirm it with the API.
  useEffect(() => {
    let cancelled = false

    async function restore() {
      let stored = loadSession()
      // A TAB OPENED AFRESH takes the session over only from a tab still open: with every tab closed (the browser
      // closed) the stored session is left behind, and cleared, so closing the browser still signs out.
      if (stored && !hasTabMark() && !(await anotherTabIsSignedIn())) {
        if (cancelled) return
        if (loadSession()?.refreshToken === stored.refreshToken) saveSession(null)
        stored = null
      }
      if (cancelled) return
      if (!stored) {
        setStatus('anonymous')
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
