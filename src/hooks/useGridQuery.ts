import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DataTableSortStatus } from 'mantine-datatable'
import { ApiError } from '../api/http'
import { PAGE_SIZE_DEFAULT } from '../config'

/**
 * The filter / paging / sorting engine behind every grid that narrows its rows on the SERVER.
 *
 * There is no Apply button. A filter takes effect as it is edited: typing settles after
 * {@link DEBOUNCE_MS}, everything else lands at once. Two things make that safe, and they are why
 * this is one hook rather than a pattern each page repeats:
 *
 *  - ONE request per settled state. The inputs write to `filters`; the fetch reads `applied`, which
 *    is only ever a whole snapshot of `filters`. A pending keystroke and a dropdown pick a moment
 *    later therefore collapse into a single request carrying both, instead of firing twice.
 *  - The LAST request wins. Every fetch runs under an AbortController that the next one aborts, so
 *    "wh" cannot overtake "wh-0" and repaint the grid with rows the reader has already moved past.
 */

/** How long typing has to settle before it is sent. Long enough to skip a word, short enough to feel live. */
export const DEBOUNCE_MS = 350

export interface GridQueryArgs<TFilters, TRecord> {
  filters: TFilters
  page: number
  pageSize: number
  sortStatus: DataTableSortStatus<TRecord>
  /** Aborted when a newer request starts; pass it straight to the API call. */
  signal: AbortSignal
}

export interface UseGridQueryOptions<TFilters extends object, TRecord, TResult> {
  /** What a fresh page starts with, and exactly what Clear Filters returns to. */
  initialFilters: TFilters
  /**
   * The filters that are TYPED into. Only these are debounced: a dropdown, switch or date picker is
   * a finished choice the moment it changes, and waiting on it would feel broken.
   */
  debounced?: (keyof TFilters)[]
  initialSort: DataTableSortStatus<TRecord>
  pageSize?: number
  /**
   * Who pages and sorts the result.
   *
   * 'server' (the default) puts page, size and sort into the request, so changing any of them
   * re-queries. 'client' is for an endpoint that answers with one flat list the page then slices
   * itself - the login audit's, capped by its own row limit. There the fetch must NOT re-run when
   * the reader turns a page, because nothing about the request would change.
   */
  paging?: 'server' | 'client'
  fetcher(args: GridQueryArgs<TFilters, TRecord>): Promise<TResult>
  /** Shown when the request fails and the API sent nothing readable. */
  errorMessage: string
}

export interface GridQuery<TFilters, TRecord, TResult> {
  /** What the inputs show - always current, even mid-debounce. */
  filters: TFilters
  /** Edit one filter. Debounced for the keys named in `debounced`, immediate for the rest. */
  setFilter<K extends keyof TFilters>(key: K, value: TFilters[K]): void
  /** Send what is typed right now - for Enter. Also flushes any other pending edit. */
  commitFilters(): void
  /** Back to `initialFilters`, applied at once. */
  clearFilters(): void
  /** True when every filter is at its default, so Clear Filters can be disabled. */
  isDefault: boolean
  page: number
  setPage(page: number): void
  pageSize: number
  setPageSize(size: number): void
  sortStatus: DataTableSortStatus<TRecord>
  setSortStatus(status: DataTableSortStatus<TRecord>): void
  data: TResult | null
  loading: boolean
  error: string | null
  /** Re-run the current query - the Refresh action. */
  reload(): void
}

/** Flat filter records only (string | number | boolean | null), so a shallow compare is the right one. */
function sameFilters<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[]
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

export function useGridQuery<TFilters extends object, TRecord, TResult>({
  initialFilters,
  debounced = [],
  initialSort,
  pageSize: initialPageSize = PAGE_SIZE_DEFAULT,
  paging = 'server',
  fetcher,
  errorMessage,
}: UseGridQueryOptions<TFilters, TRecord, TResult>): GridQuery<TFilters, TRecord, TResult> {
  /** What the inputs show. */
  const [filters, setFiltersState] = useState<TFilters>(initialFilters)
  /** What the fetch uses - a snapshot of the above, taken when an edit settles. */
  const [applied, setApplied] = useState<TFilters>(initialFilters)

  const [page, setPageState] = useState(1)
  const [pageSize, setPageSizeState] = useState(initialPageSize)
  const [sortStatus, setSortStatusState] = useState<DataTableSortStatus<TRecord>>(initialSort)

  const [data, setData] = useState<TResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  /**
   * The defaults, captured once. Held in state rather than a ref because `isDefault` is computed
   * during render, and a ref read there is exactly what React tells you not to do.
   */
  const [initial] = useState(initialFilters)

  // Read inside timers and callbacks, where the state closed over would be a render out of date.
  const filtersRef = useRef(filters)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const fetcherRef = useRef(fetcher)
  const debouncedRef = useRef(debounced)
  // Read inside the fetch effect, which does not list them as dependencies under client paging.
  const pageRef = useRef(page)
  const pageSizeRef = useRef(pageSize)
  const sortRef = useRef(sortStatus)

  /**
   * Kept current in an effect rather than assigned mid-render: a render React discards must not
   * leave its values behind in a ref. Declared BEFORE the fetch effect, so by the time that one
   * runs on the same commit these already hold this render's values.
   */
  useEffect(() => {
    fetcherRef.current = fetcher
    debouncedRef.current = debounced
    pageRef.current = page
    pageSizeRef.current = pageSize
    sortRef.current = sortStatus
  })

  useEffect(() => () => clearTimeout(timer.current), [])

  /**
   * Send everything currently typed. Taking the WHOLE snapshot is what coalesces a pending keystroke
   * with the change that interrupted it; cancelling the timer first is what stops the pair firing twice.
   */
  const flush = useCallback((next: TFilters) => {
    clearTimeout(timer.current)
    setApplied(next)
    // A narrower result has fewer pages: staying on page 4 would show an empty grid.
    setPageState(1)
  }, [])

  const setFilter = useCallback(
    <K extends keyof TFilters>(key: K, value: TFilters[K]) => {
      const next = { ...filtersRef.current, [key]: value }
      filtersRef.current = next
      setFiltersState(next)

      // Emptying a text box is a finished thought (the clear button, or select-all-delete), so it
      // lands at once rather than making the reader wait out a debounce for a result they can predict.
      const isTyped = debouncedRef.current.includes(key)
      const cleared = value === '' || value === null || value === undefined
      if (isTyped && !cleared) {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => flush(filtersRef.current), DEBOUNCE_MS)
      } else {
        flush(next)
      }
    },
    [flush],
  )

  const commitFilters = useCallback(() => flush(filtersRef.current), [flush])

  const clearFilters = useCallback(() => {
    filtersRef.current = initial
    setFiltersState(initial)
    flush(initial)
  }, [flush, initial])

  const setPage = useCallback((next: number) => setPageState(next), [])

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size)
    setPageState(1)
  }, [])

  const setSortStatus = useCallback((status: DataTableSortStatus<TRecord>) => {
    setSortStatusState(status)
    // Sorting reorders the whole result, so the reader belongs at its start. Filters are untouched.
    setPageState(1)
  }, [])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  /**
   * What, besides the filters, makes this a different request. Under client paging: nothing - so
   * turning a page or re-sorting reuses the list already in hand instead of asking again.
   */
  const pagingKey =
    paging === 'client' ? 'client' : `${page}|${pageSize}|${String(sortStatus.columnAccessor)}|${sortStatus.direction}`

  useEffect(() => {
    const controller = new AbortController()
    // Fetching is the "synchronize with an external system" case the rule exempts; the spinner has
    // to be on screen before the await, not a render later.
    // eslint-disable-next-line react/set-state-in-effect
    setLoading(true)

    void (async () => {
      try {
        const result = await fetcherRef.current({
          filters: applied,
          page: pageRef.current,
          pageSize: pageSizeRef.current,
          sortStatus: sortRef.current,
          signal: controller.signal,
        })
        // Overtaken by a newer query: the reader is waiting on that one's result, not this one's.
        if (controller.signal.aborted) return
        setData(result)
        setError(null)
      } catch (err) {
        if (controller.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof ApiError ? err.messages.join(' ') : errorMessage)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [applied, pagingKey, reloadToken, errorMessage])

  const isDefault = useMemo(() => sameFilters(filters, initial), [filters, initial])

  return {
    filters,
    setFilter,
    commitFilters,
    clearFilters,
    isDefault,
    page,
    setPage,
    pageSize,
    setPageSize,
    sortStatus,
    setSortStatus,
    data,
    loading,
    error,
    reload,
  }
}
