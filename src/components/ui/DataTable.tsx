import { useRef, useState, type KeyboardEvent } from 'react'
import { Button, Group, Text } from '@mantine/core'
import { IconFilterOff } from '@tabler/icons-react'
import {
  DataTable as MantineDataTable,
  type DataTableColumn,
  type DataTablePaginationProps,
  type DataTableSortProps,
  type DataTableSortStatus,
} from 'mantine-datatable'
import { PAGE_SIZE_OPTIONS } from '../../config'

export type { DataTableColumn, DataTableSortStatus }

/** What a row is identified by. Every list in this application keys on a numeric or string id. */
type RowId = string | number

/** Anything inside a row that answers a click or a key itself, and so answers it alone. */
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="menuitem"], [contenteditable="true"]'

interface DataTableProps<T> {
  records: T[]
  columns: DataTableColumn<T>[]
  /** Total rows matching the filters, across every page (server-side paging). */
  totalRecords?: number
  /**
   * Current page. Leaving it out drops the paging footer entirely - for a grid that shows every
   * row it has, such as the Item Families tree, where a page break would cut a parent from its
   * children and page 2 would be a list of orphans.
   */
  page?: number
  recordsPerPage?: number
  onPageChange?(page: number): void
  onRecordsPerPageChange?(size: number): void
  /** Omit on a grid whose row order is fixed (a hierarchy), so no column offers to sort. */
  sortStatus?: DataTableSortStatus<T>
  onSortStatusChange?(status: DataTableSortStatus<T>): void
  fetching?: boolean
  noRecordsText?: string
  idAccessor?: keyof T & string
  minHeight?: number
  /**
   * The grid's column filters - a {@link GridFilters} satisfies this. Passing them adds the strip
   * above the table that says how many columns are narrowing the result and offers to clear them: a
   * funnel set two screens ago is otherwise invisible, and an empty grid then reads as missing data.
   *
   * A page whose filter bar already shows and clears the same filters leaves this out rather than
   * offering the reader two Clears.
   */
  filters?: { activeCount: number; clearAll(): void }
  /**
   * Makes the whole row a way into the record - the Items list opens the item. Give it only when
   * the row leads somewhere obvious the reader can also reach by a visible control (a link in the
   * first cell, a View action), so nothing is reachable ONLY by guessing that rows are clickable.
   */
  onRowClick?(args: { record: T; index: number }): void
  /**
   * What **Enter** does to the selected row when the grid has the focus - open it, or edit it. Give
   * it the same thing the row's primary icon does, and leave it out where the reader has no
   * permission for that action. Defaults to {@link onRowClick} when only that is given.
   */
  onRowActivate?(args: { record: T; index: number }): void
}

/**
 * The application's grid: mantine-datatable wired for server-side paging and sorting.
 * Every list page uses this so paging, sorting and the footer wording stay identical.
 *
 * Per-column filtering is opt-in per column: give the column the props from `columnFilter()` and
 * hand the same {@link GridFilters} to `filters` here.
 *
 * **Rows are selectable, on every grid, without a page asking for it.** Clicking a row - or any of
 * its action icons, which is the same click on the way up - marks it. A click that landed on a
 * control is answered by that control alone and does NOT also run `onRowClick`: pressing Edit on
 * the Items list asks to edit the item, not to edit it and open it. It keeps its mark while
 * the reader works: the selection is held as the record's id, so a reload after an edit or a status
 * change (the toast refresh) finds the same row again rather than losing it to new object identities.
 * It clears when the row is no longer in the list - filtered away, deleted - and when the reader
 * turns the page, because a mark on a row that is off screen tells them nothing.
 *
 * With the grid focused, Up and Down move the mark and Enter runs {@link onRowActivate}.
 */
export function DataTable<T>({
  records,
  columns,
  totalRecords,
  page,
  recordsPerPage,
  onPageChange,
  onRecordsPerPageChange,
  sortStatus,
  onSortStatusChange,
  fetching = false,
  noRecordsText = 'No records found.',
  idAccessor,
  minHeight = 240,
  filters,
  onRowClick,
  onRowActivate,
}: DataTableProps<T>) {
  const activeFilters = filters?.activeCount ?? 0
  const idKey = idAccessor ?? 'id'

  const [selectedId, setSelectedId] = useState<RowId | null>(null)
  const [lastPage, setLastPage] = useState(page)
  const gridRef = useRef<HTMLDivElement>(null)

  // Both of these correct the selection as the rows change, during the render that changes them -
  // an effect would paint a mark on the wrong row for one frame before taking it away again.

  // A new page is a new set of rows; the mark does not survive it.
  if (lastPage !== page) {
    setLastPage(page)
    if (selectedId !== null) setSelectedId(null)
  }

  // The row went away - a filter dropped it, or it was deleted. Judged only on a settled result:
  // mid-request the grid still shows the rows it had, and the mark belongs to them.
  if (!fetching && selectedId !== null && !records.some((record) => rowId(record, idKey) === selectedId)) {
    setSelectedId(null)
  }

  const activate = onRowActivate ?? onRowClick

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return

    // A key pressed on a control inside the grid belongs to that control - Enter on a row's Delete
    // icon is a delete, and must not also open whatever Enter does to the row.
    const target = event.target as HTMLElement
    if (target !== event.currentTarget && target.closest(INTERACTIVE)) return

    if (records.length === 0) return

    const ids = records.map((record) => rowId(record, idKey))
    const current = selectedId === null ? -1 : ids.indexOf(selectedId)

    if (event.key === 'Enter') {
      if (current < 0 || !activate) return
      event.preventDefault()
      activate({ record: records[current] as T, index: current })
      return
    }

    event.preventDefault()
    const next =
      current < 0
        ? event.key === 'ArrowDown'
          ? 0
          : records.length - 1
        : Math.min(Math.max(current + (event.key === 'ArrowDown' ? 1 : -1), 0), records.length - 1)

    setSelectedId(ids[next] ?? null)
    gridRef.current?.querySelectorAll('tbody tr')[next]?.scrollIntoView({ block: 'nearest' })
  }

  // Paging and sorting are each all-or-nothing unions in mantine-datatable's own props, so they
  // are built as those union types and spread in: an optional `sortStatus` would satisfy neither
  // half of the union and the grid would stop type-checking.
  const sortProps: DataTableSortProps<T> = sortStatus ? { sortStatus, onSortStatusChange } : {}

  const pagingProps: DataTablePaginationProps =
    page === undefined
      ? {}
      : {
          page,
          onPageChange: onPageChange ?? noop,
          totalRecords: totalRecords ?? records.length,
          recordsPerPage: recordsPerPage ?? PAGE_SIZE_OPTIONS[0],
          recordsPerPageOptions: [...PAGE_SIZE_OPTIONS],
          onRecordsPerPageChange: onRecordsPerPageChange ?? noop,
          paginationText: ({ from, to, totalRecords: total }) => `Showing ${from} to ${to} of ${total} entries`,
        }

  return (
    <>
      {activeFilters > 0 ? (
        <Group justify="space-between" mb="xs" gap="sm">
          <Text fz="sm" c="dimmed">
            {activeFilters === 1 ? '1 column filter' : `${activeFilters} column filters`} in effect
          </Text>
          <Button
            size="compact-sm"
            variant="subtle"
            leftSection={<IconFilterOff size={15} />}
            onClick={() => filters?.clearAll()}
          >
            Clear column filters
          </Button>
        </Group>
      ) : null}

      {/* Focusable so the arrow keys have somewhere to land; clicking a row puts the focus here. */}
      <div ref={gridRef} className="app-grid" tabIndex={0} onKeyDown={handleKeys}>
        <MantineDataTable<T>
          // Rows answer a click everywhere now, but only a grid whose rows LEAD somewhere says so
          // with a pointer: selecting is not navigating, and the cursor must not promise it is.
          className={onRowClick ? undefined : 'app-grid--select-only'}
          records={records}
          columns={columns}
          fetching={fetching}
          noRecordsText={noRecordsText}
          minHeight={minHeight}
          striped={false}
          highlightOnHover
          withTableBorder={false}
          withColumnBorders
          borderRadius="md"
          verticalAlign="center"
          rowClassName={(record) => (rowId(record, idKey) === selectedId ? 'app-grid__row--selected' : undefined)}
          onRowClick={({ record, index, event }) => {
            setSelectedId(rowId(record, idKey))

            // A click that landed on a control inside the row has already been answered by that
            // control: pressing Edit asks to edit, not to edit AND open the row. It also leaves the
            // focus on that control, which is what the modal it opens gives the focus back to.
            const target = event.target as HTMLElement
            if (target.closest(INTERACTIVE)) return

            gridRef.current?.focus()
            onRowClick?.({ record, index })
          }}
          {...(idAccessor ? { idAccessor } : {})}
          {...sortProps}
          {...pagingProps}
        />
      </div>
    </>
  )
}

/** The record's id, when it is one this component can compare and remember. */
function rowId<T>(record: T, key: string): RowId | null {
  const value = (record as Record<string, unknown>)[key]
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function noop() {}
