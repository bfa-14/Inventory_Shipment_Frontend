/**
 * Where to go after signing in: the page a signed-out reader was sent away from — the "Open the order"
 * link of an approval email lands on the order, not on the home page.
 *
 * ONLY A PATH OF THIS APPLICATION. A returnUrl is part of a link anybody can write, so it must never be
 * a way off the site: it has to start with one "/" — not "//" (another host, scheme-relative) and not
 * "/\" (which browsers read the same way). Anything else is answered with the home page.
 */
export function safeReturnUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  // Control characters (a tab or a newline inside "/\t/evil.com") are dropped by URL parsers too.
  return [...value].some((char) => char.charCodeAt(0) < 32) ? '/' : value
}

/** The sign-in route that brings the reader back to `path` (path + query + hash). */
export function loginRouteFor(path: string): string {
  return path === '/' || path === '' ? '/login' : `/login?returnUrl=${encodeURIComponent(path)}`
}
