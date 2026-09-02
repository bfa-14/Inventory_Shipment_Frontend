import type { ProblemDetails } from './types'

/** Base URL of the API. Empty means "same origin" (the Vite dev proxy or a reverse proxy in production). */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly problem: ProblemDetails | null

  constructor(status: number, problem: ProblemDetails | null, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
  }

  /** Machine-readable reason the API sent, e.g. 'DUPLICATE_CODE' or 'MAIN_BRANCH_EXISTS'. */
  get code(): string | undefined {
    return this.problem?.code
  }

  /** Extra payload that goes with {@link code}; shape depends on the endpoint. */
  get data(): unknown {
    return this.problem?.data
  }

  /** Field name -> messages, as returned by ASP.NET model validation (empty when there are none). */
  get fieldErrors(): Record<string, string[]> {
    const errors = this.problem?.errors
    return errors && !Array.isArray(errors) ? errors : {}
  }

  /** Every human-readable message the API sent (detail + validation errors). */
  get messages(): string[] {
    const list: string[] = []
    if (this.problem?.detail) list.push(this.problem.detail)

    const errors = this.problem?.errors
    if (Array.isArray(errors)) list.push(...errors)
    else if (errors && typeof errors === 'object') list.push(...Object.values(errors).flat())

    if (list.length === 0) list.push(this.message)
    return list
  }
}

/** Hooks the auth layer plugs in so plain API calls can attach and renew tokens. */
export interface TokenProvider {
  getAccessToken(): string | null
  /** Obtain a fresh access token (returns null when the session cannot be renewed). */
  refreshAccessToken(): Promise<string | null>
  /** Called when a request stays unauthorized after a refresh attempt. */
  onSessionExpired(): void
}

let tokenProvider: TokenProvider | null = null

export function configureHttp(provider: TokenProvider | null): void {
  tokenProvider = provider
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Attach the bearer token (default true). */
  auth?: boolean
  signal?: AbortSignal
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return send<T>(path, options, true)
}

/**
 * POSTs a multipart/form-data body - the file upload endpoints. It carries the bearer token and
 * replays once after a refresh exactly like {@link request}; the difference is that the body is
 * sent as-is and the Content-Type is left to the browser, which alone knows the multipart boundary.
 */
export async function uploadFile<T>(
  path: string,
  file: File,
  options: { field?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const form = new FormData()
  form.append(options.field ?? 'file', file, file.name)
  return sendForm<T>(path, form, options.signal, true)
}

async function sendForm<T>(
  path: string,
  form: FormData,
  signal: AbortSignal | undefined,
  allowRefresh: boolean,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = tokenProvider?.getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers, body: form, signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, null, 'Could not reach the API. Is Inventory_Shipment.API running?')
  }

  if (response.status === 401 && allowRefresh && tokenProvider) {
    const fresh = await tokenProvider.refreshAccessToken()
    // FormData is single-use once consumed by fetch, but the same object can be re-sent: the
    // browser rebuilds the body from the entries, which are still there.
    if (fresh) return sendForm<T>(path, form, signal, false)
    tokenProvider.onSessionExpired()
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    const problem = data && typeof data === 'object' ? (data as ProblemDetails) : null
    throw new ApiError(response.status, problem, defaultMessage(response.status, problem))
  }

  return data as T
}

/**
 * Reads a binary endpoint (an item's image or attachment) as a Blob.
 *
 * An `<img src>` or a plain link cannot carry the Authorization header, so the bytes are fetched
 * here and the caller turns the Blob into an object URL - which it must revoke when it is done.
 */
export async function fetchBlob(path: string, signal?: AbortSignal, allowRefresh = true): Promise<Blob> {
  const headers: Record<string, string> = {}
  const token = tokenProvider?.getAccessToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { headers, signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, null, 'Could not reach the API. Is Inventory_Shipment.API running?')
  }

  if (response.status === 401 && allowRefresh && tokenProvider) {
    const fresh = await tokenProvider.refreshAccessToken()
    if (fresh) return fetchBlob(path, signal, false)
    tokenProvider.onSessionExpired()
  }

  if (!response.ok) {
    // An error body is JSON even here, so the caller still gets the API's own message.
    const text = await response.text()
    let problem: ProblemDetails | null = null
    try {
      const parsed: unknown = text ? JSON.parse(text) : null
      problem = parsed && typeof parsed === 'object' ? (parsed as ProblemDetails) : null
    } catch {
      problem = null
    }
    throw new ApiError(response.status, problem, defaultMessage(response.status, problem))
  }

  return response.blob()
}

async function send<T>(path: string, options: RequestOptions, allowRefresh: boolean): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const token = auth ? tokenProvider?.getAccessToken() : null
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, null, 'Could not reach the API. Is Inventory_Shipment.API running?')
  }

  // Access token expired: renew it once and replay the request.
  if (response.status === 401 && auth && allowRefresh && tokenProvider) {
    const fresh = await tokenProvider.refreshAccessToken()
    if (fresh) return send<T>(path, options, false)
    tokenProvider.onSessionExpired()
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    const problem = data && typeof data === 'object' ? (data as ProblemDetails) : null
    throw new ApiError(response.status, problem, defaultMessage(response.status, problem))
  }

  return data as T
}

function defaultMessage(status: number, problem: ProblemDetails | null): string {
  if (problem?.detail) return problem.detail
  switch (status) {
    case 400:
      return problem?.title ?? 'The request was not valid.'
    case 401:
      return 'You are not signed in.'
    case 403:
      return 'You do not have permission to do that.'
    case 404:
      return 'Not found.'
    case 409:
      return problem?.title ?? 'Conflict.'
    case 423:
      return 'This account is temporarily locked.'
    case 429:
      return 'Too many attempts. Please wait a minute and try again.'
    // The gateway statuses, with no problem detail of their own, mean the request never reached the
    // API: the Vite proxy (dev) or the reverse proxy (production) had nothing to forward to. Saying
    // "the server ran into a problem" here sends the reader hunting for a bug in an API that is not
    // even running. The dev proxy answers 503 with its own detail, which the first line returns; this
    // is the fallback for every other gateway that does not.
    case 502:
    case 503:
    case 504:
      return 'The API is not reachable. Make sure Inventory_Shipment.API is running (https://localhost:7089).'
    default:
      return status >= 500
        ? 'The server ran into a problem. Please try again.'
        : (problem?.title ?? `Request failed (${status}).`)
  }
}
