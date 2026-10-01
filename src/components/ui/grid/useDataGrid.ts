import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BLANKS,
  cellMatches,
  isEmptyFilter,
  nextSort,
  pageOf,
  sortRows,
  summarize,
  toCsv,
  type Cell,
  type ColumnKind,
  type FilterValue,
  type Filters,
  type SortSpec,
  type SummaryKind,
} from './gridModel'

/** The rows-per-page choices a grid that holds its whole result offers. */
export const CLIENT_PAGE_SIZES = [10, 20, 50, 100, 250, 500]

/**
 * What the grid needs to know about one column beyond how it LOOKS (which stays in the column
 * definition the page already writes for the table).
 *
 * Declare the array as a module constant: it is read on every render, and a literal created inside
 * the component would rebuild every lookup below each time.
 */
export interface GridColumnMeta<T> {
  accessor: string
  /** Defaults to 'text'. 'number' and 'date' unlock comparisons; 'boolean' and 'list' filter by value only. */
  kind?: ColumnKind
  /** The raw value: what is sorted, compared and added up. Defaults to `row[accessor]`. */
  value?: (row: T) => Cell
  /** What the cell shows and the value list offers. Defaults to the raw value as text (booleans: Yes / No). */
  text?: (row: T) => string
  /** The footer figure this column starts with. The reader may change it; None is always one click away. */
  summary?: SummaryKind
  /** Set false to take the column out of sorting / filtering (an actions column, a computed badge). */
  sortable?: boolean
  filterable?: boolean
  /** Left out of the CSV export (icons, buttons). */
  exportable?: boolean
}

export interface DataGridOptions<T> {
  /** Every row the grid holds. Filtering, sorting, paging and totals all work on these. */
  rows: T[]
  columns: GridColumnMeta<T>[]
  /** Where the reader's page size, filter-row switch and footer choices are remembered. */
  storeKey?: string
  pageSize?: number
  /** The sort a fresh grid starts with. */
  sort?: SortSpec[]
  pageSizeOptions?: number[]
}

export interface DataGrid<T> {
  meta: GridColumnMeta<T>[]
  /** Rows after the column filters and the sort - the whole result, not one page. */
  rows: T[]
  /** The rows of the current page. */
  pageRows: T[]
  /** How many rows survived the filters, across every page. */
  total: number
  /** How many rows the grid holds before any filter. */
  loaded: number
  page: number
  setPage(page: number): void
  pageSize: number
  setPageSize(size: number): void
  pageSizeOptions: number[]
  sort: SortSpec[]
  /** A header was clicked: `additive` (Shift) adds a sort key instead of replacing the sort. */
  setSort(spec: SortSpec, additive: boolean): void
  filters: Filters
  setFilter(accessor: string, value: FilterValue | undefined): void
  clearFilters(): void
  activeCount: number
  /** The distinct values a column displays across ALL loaded rows, blanks first - for the funnel's list. */
  options(accessor: string): string[]
  kindOf(accessor: string): ColumnKind
  /** The footer figure for a column over the filtered rows, or null. */
  summaryFor(accessor: string): number | null
  summaryKind(accessor: string): SummaryKind
  setSummaryKind(accessor: string, kind: SummaryKind): void
  /** Is any numeric value present in this column? Decides whether Sum and the like are on offer. */
  isNumeric(accessor: string): boolean
  filterRow: boolean
  setFilterRow(on: boolean): void
  /** Downloads the filtered rows as CSV: `accessors` are the visible columns, in order, with their headings. */
  exportCsv(columns: { accessor: string; title: string }[], fileName: string): void
}

interface Stored {
  pageSize?: number
  filterRow?: boolean
}

function readJson<V>(key: string): V | undefined {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as V) : undefined
  } catch {
    return undefined
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A browser that refuses storage still works; it just forgets the choice on reload.
  }
}

const rawOf = <T,>(column: GridColumnMeta<T> | undefined, row: T): Cell => {
  if (!column) return undefined
  if (column.value) return column.value(row)
  const value = (row as Record<string, unknown>)[column.accessor]
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null
}

const textOf = <T,>(column: GridColumnMeta<T> | undefined, row: T): string => {
  if (!column) return ''
  if (column.text) return column.text(row)
  const raw = rawOf(column, row)
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'
  return raw === null || raw === undefined ? '' : String(raw)
}

/**
 * Filter, sort, page and total a list the page already holds.
 *
 * ONE ENGINE, EVERY COLUMN. The page hands over its rows and says what each column IS (a number, a
 * date, a list of values); the engine does the rest in the browser, so every column answers every
 * question - which is what the funnel could never promise on a grid that held one page of a result.
 * Pages whose result is too large to hold keep asking the server for a page at a time and do not use it.
 *
 * The footer totals are taken over the filtered rows, ALL of them, never the page on screen.
 */
export function useDataGrid<T>({
  rows,
  columns,
  storeKey,
  pageSize: initialPageSize = 10,
  sort: initialSort = [],
  pageSizeOptions = CLIENT_PAGE_SIZES,
}: DataGridOptions<T>): DataGrid<T> {
  const byAccessor = useMemo(() => new Map(columns.map((column) => [column.accessor, column])), [columns])

  const stored = useMemo(() => (storeKey ? readJson<Stored>(`${storeKey}-grid`) : undefined), [storeKey])

  const [filters, setFilters] = useState<Filters>({})
  const [sort, setSortState] = useState<SortSpec[]>(initialSort)
  const [page, setPageState] = useState(1)
  const [pageSize, setPageSizeState] = useState(stored?.pageSize ?? initialPageSize)
  const [filterRow, setFilterRowState] = useState(stored?.filterRow ?? false)
  // The footer choices share the key the earlier footer used, so a reader's existing choices survive.
  const [summaryChoices, setSummaryChoices] = useState<Record<string, SummaryKind>>(
    () => (storeKey ? readJson<Record<string, SummaryKind>>(`${storeKey}-summaries`) : undefined) ?? {},
  )

  useEffect(() => {
    if (storeKey) writeJson(`${storeKey}-grid`, { pageSize, filterRow } satisfies Stored)
  }, [storeKey, pageSize, filterRow])

  useEffect(() => {
    if (storeKey) writeJson(`${storeKey}-summaries`, summaryChoices)
  }, [storeKey, summaryChoices])

  const active = useMemo(
    () => Object.entries(filters).filter((entry): entry is [string, FilterValue] => !isEmptyFilter(entry[1])),
    [filters],
  )

  const filtered = useMemo(() => {
    if (active.length === 0) return rows
    return rows.filter((row) =>
      active.every(([accessor, filter]) => {
        const column = byAccessor.get(accessor)
        // A filter on a column this grid cannot resolve must not silently hide rows.
        if (!column) return true
        return cellMatches(column.kind ?? 'text', rawOf(column, row), textOf(column, row), filter)
      }),
    )
  }, [rows, active, byAccessor])

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (row, accessor) => {
        const column = byAccessor.get(accessor)
        return column && column.sortable !== false ? { kind: column.kind ?? 'text', raw: rawOf(column, row) } : undefined
      }),
    [filtered, sort, byAccessor],
  )

  const paged = useMemo(() => pageOf(sorted, page, pageSize), [sorted, page, pageSize])

  const setFilter = useCallback((accessor: string, value: FilterValue | undefined) => {
    setFilters((current) => {
      const next = { ...current }
      if (isEmptyFilter(value)) delete next[accessor]
      else next[accessor] = value
      return next
    })
    // A narrower result has fewer pages: staying on page 4 would show an empty grid.
    setPageState(1)
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({})
    setPageState(1)
  }, [])

  const options = useCallback(
    (accessor: string): string[] => {
      const column = byAccessor.get(accessor)
      if (!column) return []
      const seen = new Set<string>()
      for (const row of rows) {
        const text = textOf(column, row)
        seen.add(text.trim() === '' ? BLANKS : text)
      }
      return [...seen].sort((a, b) =>
        a === b ? 0 : a === BLANKS ? -1 : b === BLANKS ? 1 : a.localeCompare(b, undefined, { numeric: true }),
      )
    },
    [byAccessor, rows],
  )

  const isNumeric = useCallback(
    (accessor: string): boolean => {
      const column = byAccessor.get(accessor)
      if (!column) return false
      if (column.kind === 'number') return true
      return rows.some((row) => {
        const raw = rawOf(column, row)
        return typeof raw === 'number'
      })
    },
    [byAccessor, rows],
  )

  const summaryKind = useCallback(
    (accessor: string): SummaryKind => summaryChoices[accessor] ?? byAccessor.get(accessor)?.summary ?? 'none',
    [summaryChoices, byAccessor],
  )

  const summaryFor = useCallback(
    (accessor: string): number | null => {
      const column = byAccessor.get(accessor)
      if (!column) return null
      return summarize(sorted.map((row) => rawOf(column, row)), summaryKind(accessor))
    },
    [byAccessor, sorted, summaryKind],
  )

  const exportCsv = useCallback(
    (visible: { accessor: string; title: string }[], fileName: string) => {
      const usable = visible.filter((entry) => {
        const column = byAccessor.get(entry.accessor)
        return column !== undefined && column.exportable !== false
      })
      const lines = sorted.map((row) => usable.map((entry) => textOf(byAccessor.get(entry.accessor), row)))
      const blob = new Blob([toCsv(usable.map((entry) => entry.title), lines)], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    },
    [byAccessor, sorted],
  )

  return {
    meta: columns,
    rows: sorted,
    pageRows: paged.rows,
    total: sorted.length,
    loaded: rows.length,
    page: paged.page,
    setPage: setPageState,
    pageSize,
    setPageSize: (size) => {
      setPageSizeState(size)
      setPageState(1)
    },
    pageSizeOptions: pageSizeOptions.includes(pageSize) ? pageSizeOptions : [...pageSizeOptions, pageSize].sort((a, b) => a - b),
    sort,
    setSort: (spec, additive) => {
      setSortState((current) => nextSort(current, spec, additive))
      setPageState(1)
    },
    filters,
    setFilter,
    clearFilters,
    activeCount: active.length,
    options,
    kindOf: (accessor) => byAccessor.get(accessor)?.kind ?? 'text',
    summaryFor,
    summaryKind,
    setSummaryKind: (accessor, kind) => setSummaryChoices((current) => ({ ...current, [accessor]: kind })),
    isNumeric,
    filterRow,
    setFilterRow: setFilterRowState,
    exportCsv,
  }
}

