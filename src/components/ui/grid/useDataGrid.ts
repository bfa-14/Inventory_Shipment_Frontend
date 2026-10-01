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

/**
 * Turns the grid into a TREE: rows carry a parent, children stand under their parent, and the reader
 * opens and closes parents. A tree is never paged (a page break would cut a parent from its children)
 * and is never grouped.
 */
export interface TreeOptions<T> {
  idOf(row: T): number | string
  /** The parent's id, or null / undefined for a root. A parent that is not among the rows makes a root. */
  parentOf(row: T): number | string | null | undefined
  /** Which parents start open the first time the reader sees the tree. Default: none. */
  openByDefault?(row: T): boolean
  /**
   * A condition of the PAGE's own (a search box, a status pick) that a row must meet on top of the
   * column filters. Matches keep their ancestors, exactly as column-filter matches do.
   */
  match?(row: T): boolean
  /** True while `match` is narrowing the tree: it then shows every match under its parents, all open. */
  narrowed?: boolean
}

export interface TreeInfo {
  /** Levels below the top of the rows shown (not the record's own level). */
  depth: number
  /** Has children among the rows shown. */
  hasChildren: boolean
  /** Its children are on screen. */
  open: boolean
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
  tree?: TreeOptions<T>
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
  /** The column the rows are grouped by, or null. Groups are collapsible and carry their own totals. */
  groupBy: string | null
  setGroupBy(accessor: string | null): void
  /** Each group's label, in the order the groups appear. Empty when the grid is not grouped. */
  groupKeys: string[]
  /** The group a row belongs to; '' when the grid is not grouped. */
  groupKeyOf(row: T): string
  groupCount(key: string): number
  /** A column's figure over ONE group's rows (the same kind the footer uses), or null. */
  groupSummary(key: string, accessor: string): number | null
  isCollapsed(key: string): boolean
  toggleGroup(key: string): void
  setAllGroups(collapsed: boolean): void
  /** Rows on screen: every filtered row except those in collapsed groups. This is what pages. */
  visibleTotal: number
  /** False for a tree, which shows every row it has and has no pager. */
  paging: boolean
  tree: boolean
  treeInfo(row: T): TreeInfo
  toggleNode(row: T): void
  expandAll(): void
  collapseAll(): void
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
  tree,
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

  const [groupBy, setGroupByState] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const groupKeyOf = useCallback(
    (row: T): string => {
      const column = groupBy ? byAccessor.get(groupBy) : undefined
      if (!column) return ''
      const text = textOf(column, row)
      return text.trim() === '' ? BLANKS : text
    },
    [groupBy, byAccessor],
  )

  /**
   * THE ORDER, GROUPED. The group column leads the sort (in the direction the reader gave it, else
   * ascending) and the reader's own sort orders the rows inside each group. The rows are then
   * gathered by the label they display, groups in order of first appearance: a column whose label is
   * coarser than its value (an order MONTH over an order DATE) still ends up in one group per label.
   */
  const sortCell = useCallback(
    (row: T, accessor: string) => {
      const column = byAccessor.get(accessor)
      return column && column.sortable !== false ? { kind: column.kind ?? 'text', raw: rawOf(column, row) } : undefined
    },
    [byAccessor],
  )

  /* THE TREE. Opened parents are the reader's (persisted), or - until they have chosen - whichever
     parents the page says start open. */
  const idOf = tree?.idOf
  const parentOf = tree?.parentOf
  const openByDefault = tree?.openByDefault
  const matchRow = tree?.match
  const narrowed = active.length > 0 || tree?.narrowed === true
  const isTree = tree !== undefined
  const [openedByReader, setOpenedByReader] = useState<Set<string> | null>(() => {
    const raw = storeKey && isTree ? readJson<string[]>(`${storeKey}-expanded`) : undefined
    return Array.isArray(raw) ? new Set(raw.map(String)) : null
  })
  const defaultOpen = useMemo(
    () => new Set(idOf && openByDefault ? rows.filter((row) => openByDefault(row)).map((row) => String(idOf(row))) : []),
    [rows, idOf, openByDefault],
  )
  const openSet = openedByReader ?? defaultOpen

  useEffect(() => {
    if (storeKey && isTree && openedByReader) writeJson(`${storeKey}-expanded`, [...openedByReader])
  }, [storeKey, isTree, openedByReader])

  /**
   * Every row that survives the filters, plus the ANCESTORS of each (so a match three levels down
   * stays under the parents it belongs to), arranged parent-then-children with each family of
   * siblings sorted on its own - a sort across the whole list would scatter children away from their
   * parents, the one thing a tree is for. `ordered` holds the rows with every parent open.
   */
  const treeShape = useMemo(() => {
    if (!idOf || !parentOf) return null
    const key = (row: T) => String(idOf(row))
    const parentKey = (row: T) => {
      const parent = parentOf(row)
      return parent === null || parent === undefined ? null : String(parent)
    }
    const byId = new Map(rows.map((row) => [key(row), row]))
    const matched = new Set((matchRow ? filtered.filter(matchRow) : filtered).map(key))
    const keep = new Set<string>()
    if (!narrowed) for (const id of byId.keys()) keep.add(id)
    else {
      for (const id of matched) {
        let current: string | null = id
        // The guard stops a cycle left by bad data from looping.
        while (current !== null && !keep.has(current) && byId.has(current)) {
          keep.add(current)
          current = parentKey(byId.get(current) as T)
        }
      }
    }
    const kids = new Map<string | null, T[]>()
    for (const row of rows) {
      const id = key(row)
      if (!keep.has(id)) continue
      const parent = parentKey(row)
      const at = parent !== null && keep.has(parent) ? parent : null
      const list = kids.get(at)
      if (list) list.push(row)
      else kids.set(at, [row])
    }
    for (const [at, list] of kids) kids.set(at, sortRows(list, sort, sortCell))

    const flatten = (isOpen: (id: string) => boolean): { row: T; depth: number }[] => {
      const out: { row: T; depth: number }[] = []
      const seen = new Set<string>()
      const walk = (at: string | null, depth: number) => {
        for (const row of kids.get(at) ?? []) {
          const id = key(row)
          if (seen.has(id)) continue
          seen.add(id)
          out.push({ row, depth })
          if ((kids.get(id)?.length ?? 0) > 0 && isOpen(id)) walk(id, depth + 1)
        }
      }
      walk(null, 0)
      return out
    }
    return { key, kids, matched, flatten }
  }, [rows, filtered, narrowed, matchRow, sort, sortCell, idOf, parentOf])

  const treeOrdered = useMemo(
    () => (treeShape ? treeShape.flatten(() => true).map((entry) => entry.row).filter((row) => treeShape.matched.has(treeShape.key(row))) : null),
    [treeShape],
  )

  const treeVisible = useMemo(() => {
    if (!treeShape) return null
    const open = (id: string) => narrowed || openSet.has(id)
    const entries = treeShape.flatten(open)
    const info = new Map<string, TreeInfo>()
    for (const { row, depth } of entries) {
      const id = treeShape.key(row)
      const children = treeShape.kids.get(id) ?? []
      info.set(id, { depth, hasChildren: children.length > 0, open: children.length > 0 && open(id) })
    }
    return { rows: entries.map((entry) => entry.row), info }
  }, [treeShape, openSet, narrowed])

  const sorted = useMemo(() => {
    if (treeOrdered) return treeOrdered
    const keys = groupBy && byAccessor.has(groupBy)
      ? [{ accessor: groupBy, direction: sort.find((spec) => spec.accessor === groupBy)?.direction ?? ('asc' as const) }, ...sort.filter((spec) => spec.accessor !== groupBy)]
      : sort
    const ordered = sortRows(filtered, keys, sortCell)
    if (!groupBy || !byAccessor.has(groupBy)) return ordered
    const buckets = new Map<string, T[]>()
    for (const row of ordered) {
      const key = groupKeyOf(row)
      const bucket = buckets.get(key)
      if (bucket) bucket.push(row)
      else buckets.set(key, [row])
    }
    return [...buckets.values()].flat()
  }, [treeOrdered, filtered, sort, sortCell, byAccessor, groupBy, groupKeyOf])

  const groups = useMemo(() => {
    const map = new Map<string, T[]>()
    if (groupBy && byAccessor.has(groupBy)) {
      for (const row of sorted) {
        const key = groupKeyOf(row)
        const bucket = map.get(key)
        if (bucket) bucket.push(row)
        else map.set(key, [row])
      }
    }
    return map
  }, [sorted, groupBy, byAccessor, groupKeyOf])

  // A collapsed group drops out BEFORE paging, so a page is always a page of what can be seen - but
  // keeps its FIRST row as a stub, which is what the group's header row hangs on. The table draws
  // the header and not the stub (see DataTable), so a collapsed group is one line.
  const visible = useMemo(() => {
    if (treeVisible) return treeVisible.rows
    if (collapsed.size === 0 || groups.size === 0) return sorted
    const seen = new Set<string>()
    return sorted.filter((row) => {
      const key = groupKeyOf(row)
      if (!collapsed.has(key)) return true
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [treeVisible, sorted, collapsed, groups, groupKeyOf])

  const paged = useMemo(
    () => (treeVisible ? { rows: visible, page: 1, pages: 1 } : pageOf(visible, page, pageSize)),
    [treeVisible, visible, page, pageSize],
  )

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

  const groupSummary = useCallback(
    (key: string, accessor: string): number | null => {
      const column = byAccessor.get(accessor)
      const rowsOfGroup = groups.get(key)
      if (!column || !rowsOfGroup) return null
      return summarize(rowsOfGroup.map((row) => rawOf(column, row)), summaryKind(accessor))
    },
    [byAccessor, groups, summaryKind],
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
    groupBy,
    setGroupBy: (accessor) => {
      setGroupByState(accessor)
      setCollapsed(new Set())
      setPageState(1)
    },
    groupKeys: [...groups.keys()],
    groupKeyOf,
    groupCount: (key) => groups.get(key)?.length ?? 0,
    groupSummary,
    isCollapsed: (key) => collapsed.has(key),
    toggleGroup: (key) =>
      setCollapsed((current) => {
        const next = new Set(current)
        if (!next.delete(key)) next.add(key)
        return next
      }),
    setAllGroups: (collapse) => {
      setCollapsed(collapse ? new Set(groups.keys()) : new Set())
      setPageState(1)
    },
    visibleTotal: visible.length,
    paging: !isTree,
    tree: isTree,
    treeInfo: (row) => (treeShape && treeVisible?.info.get(treeShape.key(row))) || { depth: 0, hasChildren: false, open: false },
    toggleNode: (row) => {
      if (!treeShape) return
      const id = treeShape.key(row)
      setOpenedByReader((current) => {
        const next = new Set(current ?? defaultOpen)
        if (!next.delete(id)) next.add(id)
        return next
      })
    },
    expandAll: () => {
      if (treeShape) setOpenedByReader(new Set([...treeShape.kids.keys()].filter((id): id is string => id !== null)))
    },
    collapseAll: () => setOpenedByReader(new Set()),
    filterRow,
    setFilterRow: setFilterRowState,
    exportCsv,
  }
}

