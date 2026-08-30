import { useCallback, useMemo, useState } from 'react'

/**
 * Per-column grid filtering, modelled on the header funnel the previous application carried: a
 * "contains" box and a tick list of the column's distinct values, ANDed together.
 *
 * A column is described here by ONE function - the text it SHOWS for a row. Both halves of the
 * filter are tested against that same string and the tick list is built from it, so the values a
 * reader can pick are exactly the values they can see. Sorting still works off the raw record, so a
 * date column stays chronological while its filter matches the text in the cell.
 */

/** What an empty cell is called in the tick list, so a blank is pickable like any other value. */
export const BLANKS = '(Blanks)'

/** One column's filter. Either half may be absent; the column filters when either is set. */
export interface ColumnFilterValue {
  /** Case-insensitive "contains" against the displayed text. */
  text?: string
  /** The displayed values ticked in the funnel. Absent means "every value". */
  values?: string[]
}

export type ColumnFilters = Record<string, ColumnFilterValue | undefined>

/** The text a column shows for a row. */
export type ColumnText<T> = (row: T) => string

/** The displayed text of one cell, an empty one reported as {@link BLANKS}. */
export function cellText<T>(row: T, text: ColumnText<T>): string {
  const value = text(row)
  return value.trim() === '' ? BLANKS : value
}

/**
 * Merge a patch over a column's filter, collapsing to `undefined` once neither half narrows
 * anything - an emptied filter has to read as UNFILTERED, or the funnel stays lit over nothing.
 */
export function mergeFilter(
  current: ColumnFilterValue | undefined,
  patch: Partial<ColumnFilterValue>,
): ColumnFilterValue | undefined {
  const merged = { ...current, ...patch }
  const text = merged.text?.trim() ? merged.text : undefined
  const values = merged.values && merged.values.length > 0 ? merged.values : undefined
  return text || values ? { text, values } : undefined
}

/** '(Blanks)' leads; everything else sorts naturally, so "Step 2" precedes "Step 10". */
function compareValues(a: string, b: string): number {
  if (a === b) return 0
  if (a === BLANKS) return -1
  if (b === BLANKS) return 1
  return a.localeCompare(b, undefined, { numeric: true })
}

/** Does one row survive one column's filter? Both halves must pass. */
function matches<T>(row: T, text: ColumnText<T>, filter: ColumnFilterValue): boolean {
  const display = cellText(row, text)
  if (filter.values && !filter.values.includes(display)) return false
  if (filter.text && !display.toLowerCase().includes(filter.text.trim().toLowerCase())) return false
  return true
}

export interface GridFilters<T> {
  /** Every column's filter, keyed by accessor; a column with no entry is not filtering. */
  filters: ColumnFilters
  /** How many columns are narrowing the grid; 0 means it is showing everything it loaded. */
  activeCount: number
  get(accessor: string): ColumnFilterValue | undefined
  set(accessor: string, value: ColumnFilterValue | undefined): void
  /** One column's filter as the pair `columnFilter()` takes: spread it into the column's props. */
  bind(accessor: string): { value: ColumnFilterValue | undefined; onApply(value: ColumnFilterValue | undefined): void }
  clearAll(): void
  /** The distinct values a column displays across `rows`, sorted, blanks first. */
  options(rows: T[], accessor: string): string[]
  /** `rows` with every column filter applied - for grids that hold all their rows. */
  apply(rows: T[]): T[]
}

/**
 * Filter state for one grid.
 *
 * `columns` maps an accessor to the text that column displays; an accessor missing from the map
 * carries no filter and is left alone by {@link GridFilters.apply}. Declare it as a module constant
 * so `apply` and `options` keep their identity between renders and the page's memos hold.
 *
 * A grid that filters on the SERVER passes the map only so its funnels can offer values, and reads
 * {@link GridFilters.filters} to build its query instead of calling `apply`.
 *
 * `onChange` fires after any filter changes, so the page can go back to page 1 - a filter leaving
 * three rows must not strand the reader on page 4 of the old result.
 */
export function useGridFilters<T>(columns: Record<string, ColumnText<T>>, onChange?: () => void): GridFilters<T> {
  const [filters, setFilters] = useState<ColumnFilters>({})

  // Only the columns actually narrowing the grid, recomputed when a filter changes and not before:
  // `apply` runs over every loaded row, so the pages memoise on its identity.
  const active = useMemo(
    () => Object.entries(filters).filter((entry): entry is [string, ColumnFilterValue] => entry[1] !== undefined),
    [filters],
  )

  const set = useCallback((accessor: string, value: ColumnFilterValue | undefined) => {
    setFilters((current) => {
      // Dropping the key rather than storing undefined keeps `filters` a truthful record of what is
      // in force - the shape the server-side pages iterate to build their query.
      const next = { ...current }
      if (value === undefined) delete next[accessor]
      else next[accessor] = value
      return next
    })
    onChange?.()
    // These two change identity with an inline onChange, which costs nothing: no memo depends on
    // them. The memoised pair below - apply and options - is what the pages' memos hang off, and
    // neither of those touches onChange.
  }, [onChange])

  const clearAll = useCallback(() => {
    setFilters({})
    onChange?.()
  }, [onChange])

  const options = useCallback(
    (rows: T[], accessor: string): string[] => {
      const text = columns[accessor]
      if (!text) return []
      const seen = new Set<string>()
      for (const row of rows) seen.add(cellText(row, text))
      return [...seen].sort(compareValues)
    },
    [columns],
  )

  const apply = useCallback(
    (rows: T[]): T[] => {
      if (active.length === 0) return rows
      return rows.filter((row) =>
        active.every(([accessor, filter]) => {
          const text = columns[accessor]
          // A filter on a column this grid cannot resolve to text must not silently hide rows.
          return !text || matches(row, text, filter)
        }),
      )
    },
    [active, columns],
  )

  return {
    filters,
    activeCount: active.length,
    get: (accessor) => filters[accessor],
    set,
    bind: (accessor) => ({ value: filters[accessor], onApply: (value) => set(accessor, value) }),
    clearAll,
    options,
    apply,
  }
}

/* ── Grids that filter on the server ────────────────────────────────────────────────────────────
   These pages do not call `apply`: the API narrows the rows, so the funnel's job is to read and
   write that page's query. The two helpers below are the whole bridge for a parameter that is
   true / false / not set, which is what every yes-no column on this API is.
   ─────────────────────────────────────────────────────────────────────────────────────────────*/

/** A query's `'true' | 'false' | null` as the value a two-word funnel shows. */
export function triStateFilter(
  current: string | null,
  whenTrue: string,
  whenFalse: string,
): ColumnFilterValue | undefined {
  if (current === null) return undefined
  return { values: [current === 'true' ? whenTrue : whenFalse] }
}

/**
 * A funnel's answer back as the query's `'true' | 'false' | null`. Both words ticked (or neither)
 * is not a filter the parameter can express, and it is not one the reader asked for either - it
 * means "show me both", which is exactly null.
 */
export function triStateQuery(value: ColumnFilterValue | undefined, whenTrue: string): string | null {
  const values = value?.values
  if (!values || values.length !== 1) return null
  return values[0] === whenTrue ? 'true' : 'false'
}
