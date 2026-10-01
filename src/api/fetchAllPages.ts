/**
 * Loading a whole reference table, so its grid can sort and filter EVERY column in the browser.
 *
 * A server-paged grid holds only the rows on screen, so a funnel there could only narrow those -
 * hiding nothing while matching rows sat on page four. The small master-data tables are short
 * enough to hold in full, and once a page holds them all, sorting and filtering are the browser's
 * to do and every column can answer.
 *
 * NOT FOR THE TRANSACTIONAL GRIDS - containers, invoices, stock documents, items. Those grow
 * without a ceiling and must keep asking the server for one page at a time; their columns need the
 * filtering pushed into the search procedures instead.
 */

/** The largest page every search procedure accepts; asking for more is clamped to this server-side. */
const PAGE_SIZE = 200

/**
 * The most rows to pull before giving up on holding the table in the browser.
 *
 * A table this big is one that has outgrown this approach, and the honest answer is to say so
 * rather than to fire off fifty requests or to quietly drop the rest.
 */
const MAX_ROWS = 5000

export interface AllRows<T> {
  items: T[]
  /** True when the table is larger than {@link MAX_ROWS}: the grid is showing a prefix of it. */
  truncated: boolean
}

/**
 * Every page of a paged endpoint, in order.
 *
 * `fetchPage` is given the page number and the size to ask for, and must pass the caller's
 * AbortSignal through so an abandoned load stops mid-way like any other.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<{ items: T[]; totalCount: number }>,
): Promise<AllRows<T>> {
  const first = await fetchPage(1, PAGE_SIZE)
  const items = [...first.items]

  // The server's own count decides how many more to ask for, so a table that fits in one page -
  // which every one of these does today - costs exactly one request.
  const wanted = Math.min(first.totalCount, MAX_ROWS)

  for (let page = 2; items.length < wanted; page++) {
    const next = await fetchPage(page, PAGE_SIZE)
    // A page that comes back empty means the table shrank under us; stop rather than loop forever.
    if (next.items.length === 0) break
    items.push(...next.items)
  }

  return { items, truncated: first.totalCount > MAX_ROWS }
}
