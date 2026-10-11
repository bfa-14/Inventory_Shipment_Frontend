/**
 * Which copy of the application this is: production (the production branch, the real data) or testing
 * (the main branch, a database of its own that is safe to try things in). The two run side by side on
 * the same server, each at its own address, and the web container tells the app which one it is in
 * /environment.json (Caddyfile):
 *
 *   {"environment": "production" | "testing", "switchUrl": "<the other environment's address, or empty>"}
 *
 * The answer is read ONCE, at start-up, and never holds up the first render: until it arrives - and
 * whenever it cannot be read at all - the app behaves as it always has and shows nothing about
 * environments. That is also the `npm run dev` case, where the Vite dev server answers the request with
 * index.html (or a 404).
 */

export type AppEnvironment = 'production' | 'testing'

export interface EnvironmentInfo {
  /** null while loading, and when /environment.json is missing or not what it should be. */
  environment: AppEnvironment | null
  /** The other environment's address (absolute, http or https); null when there is no switch to offer. */
  switchUrl: string | null
}

/** What the app knows before the answer arrives, and what any failure leaves it with. */
export const UNKNOWN_ENVIRONMENT: EnvironmentInfo = { environment: null, switchUrl: null }

/** Put in front of the browser tab's title in the testing environment, so a tab says where it is. */
export const TESTING_TITLE_PREFIX = 'TEST · '

let cached: Promise<EnvironmentInfo> | null = null

/**
 * The environment, read from /environment.json on the first call; every later call (React's StrictMode
 * mounts the provider twice in development) shares the same request. It never rejects.
 */
export function loadEnvironment(): Promise<EnvironmentInfo> {
  cached ??= fetchEnvironment()
  return cached
}

async function fetchEnvironment(): Promise<EnvironmentInfo> {
  try {
    // no-store: the file says which database the reader is about to work in, so a copy cached from
    // before a change of either value must never be believed.
    const response = await fetch('/environment.json', { cache: 'no-store', headers: { Accept: 'application/json' } })
    if (!response.ok) return UNKNOWN_ENVIRONMENT
    // Not JSON at all - the dev server's index.html - throws here and lands in the catch below.
    return parseEnvironment(await response.json())
  } catch {
    return UNKNOWN_ENVIRONMENT
  }
}

/**
 * STRICT ON PURPOSE: the environment decides what the reader is told about the data in front of them,
 * so anything but the two exact names is "unknown", never a guess. A switch address that is not an
 * absolute http(s) URL is dropped, and so is one that points back at this very site: a switch that
 * reloads the same environment would only teach the reader that it does nothing.
 */
export function parseEnvironment(value: unknown): EnvironmentInfo {
  if (typeof value !== 'object' || value === null) return UNKNOWN_ENVIRONMENT
  const { environment, switchUrl } = value as Record<string, unknown>
  if (environment !== 'production' && environment !== 'testing') return UNKNOWN_ENVIRONMENT
  return { environment, switchUrl: parseSwitchUrl(switchUrl) }
}

function parseSwitchUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  let url: URL
  try {
    url = new URL(value.trim()) // no base: a relative address throws
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.origin === window.location.origin) return null
  return url.toString()
}
