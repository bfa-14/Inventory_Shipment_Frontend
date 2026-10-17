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
 * The page of the container lists of ONE order or ONE movement, and of a movement's candidates (script 78): their
 * procedures work every row out before they page, so each page costs about the whole list - one call of 5,000 instead
 * of ten of 200 for an order of 2,000 containers.
 */
export const WHOLE_LIST_PAGE_SIZE = 5000

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

/** Pages asked for at the same time once the first has said how many there are. */
const PARALLEL_PAGES = 4

export interface FetchAllOptions {
  /**
   * The most rows to pull; {@link MAX_ROWS} when left out. `Infinity` for a list that must be whole, whatever its
   * size - the containers of one order or of one movement, which a bulk action has to reach every one of (script 78:
   * any number of containers).
   */
  maxRows?: number
  /** The page to ask for: {@link PAGE_SIZE} when left out; {@link WHOLE_LIST_PAGE_SIZE} where the server takes it. */
  pageSize?: number
}

/**
 * Every page of a paged endpoint, in order.
 *
 * `fetchPage` is given the page number and the size to ask for, and must pass the caller's
 * AbortSignal through so an abandoned load stops mid-way like any other. After the first page the
 * rest are asked for a few at a time (an order of 2,000 containers is ten pages).
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<{ items: T[]; totalCount: number }>,
  options: FetchAllOptions = {},
): Promise<AllRows<T>> {
  const maxRows = options.maxRows ?? MAX_ROWS
  const pageSize = options.pageSize ?? PAGE_SIZE
  const first = await fetchPage(1, pageSize)
  const items = [...first.items]

  // The server's own count decides how many more to ask for, so a table that fits in one page -
  // which every one of these does today - costs exactly one request.
  const wanted = Math.min(first.totalCount, maxRows)
  const lastPage = Math.ceil(wanted / pageSize)

  for (let page = 2; page <= lastPage && items.length < wanted; page += PARALLEL_PAGES) {
    const pages = Array.from({ length: Math.min(PARALLEL_PAGES, lastPage - page + 1) }, (_, i) => page + i)
    const answers = await Promise.all(pages.map((p) => fetchPage(p, pageSize)))
    let shrank = false
    for (const next of answers) {
      // A page that comes back empty means the table shrank under us; stop rather than loop forever.
      if (next.items.length === 0) shrank = true
      items.push(...next.items)
    }
    if (shrank) break
  }

  return { items: items.slice(0, wanted), truncated: first.totalCount > maxRows }
}
