import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button, Checkbox, Group, Popover, Stack, Text } from '@mantine/core'
import { IconColumns3, IconFilterOff, IconRestore } from '@tabler/icons-react'
import {
  DataTable as MantineDataTable,
  humanize,
  useDataTableColumns,
  type DataTableColumn,
  type DataTableColumnToggle,
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

/**
 * The two columns the chooser and the resize handles leave alone.
 *
 * "#" is a position marker rather than data - hiding it or widening it says nothing about the
 * record - and Actions is the column {@link DataTableProps.pinLastColumn} keeps in view precisely
 * because it is the one a reader scrolled the row to reach. Both are also the columns whose fixed
 * widths the rest of the grid is laid out against.
 */
const FIXED_ACCESSORS = new Set(['__rowNumber', 'actions'])

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
  /**
   * Bulk selection - a checkbox column, driven by the page. The page holds the selected RECORDS so
   * a selection survives paging; `isRecordSelectable` says which rows may be ticked at all (drafts,
   * for a post). Leaving these out keeps the grid without a checkbox column.
   */
  selectedRecords?: T[]
  onSelectedRecordsChange?(records: T[]): void
  isRecordSelectable?(record: T, index: number): boolean
  /** A class for a row the page wants to point at - the documents an import just created. */
  rowClassName?(record: T): string | undefined
  /**
   * Keeps the last column (the row actions) in view while a grid too wide for the screen scrolls
   * sideways - the actions are what a reader scrolled the row for.
   */
  pinLastColumn?: boolean
  /**
   * Turns on the column chooser and manual column widths, and names where the reader's choices are
   * remembered (localStorage, per browser). Leaving it out keeps the grid exactly as it was: no
   * Columns button, no resize handles, nothing stored - which is what the grids embedded in a form
   * want, where a hidden column would hide something being edited.
   *
   * ONE STABLE KEY PER GRID, namespaced after the page ("masterdata.branches",
   * "logistics.containers"). It is persisted, so treat a key as permanent: reusing one across two
   * grids would have them fight over each other's widths, and renaming one silently discards
   * whatever the reader had arranged.
   */
  storeKey?: string
}

/**
 * The application's grid: mantine-datatable wired for server-side paging and sorting.
 * Every list page uses this so paging, sorting and the footer wording stay identical.
 *
 * Per-column filtering is opt-in per column: give the column the props from `columnFilter()` and
 * hand the same {@link GridFilters} to `filters` here.
 *
 * A {@link DataTableProps.storeKey} adds the column chooser and draggable column widths, remembered
 * per reader under that key. Both are the grid's own business rather than each page's, which is why
 * a page asks for them with one prop and never repeats a flag down its column list.
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
  selectedRecords,
  onSelectedRecordsChange,
  isRecordSelectable,
  rowClassName,
  pinLastColumn = false,
  storeKey,
}: DataTableProps<T>) {
  const activeFilters = filters?.activeCount ?? 0
  const idKey = idAccessor ?? 'id'

  /**
   * Every column a page did not fix or decide for itself becomes hideable and resizable, so a page
   * opts into both features with one prop instead of repeating two flags down its column list.
   */
  const adjustableColumns = useMemo(
    () =>
      storeKey === undefined
        ? columns
        : columns.map((column) =>
            FIXED_ACCESSORS.has(String(column.accessor))
              ? column
              : {
                  ...column,
                  toggleable: column.toggleable ?? true,
                  resizable: column.resizable ?? true,
                },
          ),
    [columns, storeKey],
  )

  /**
   * Called unconditionally - hooks may not be skipped - and harmless without a key: every part of
   * it is guarded on one, so `storeKey` left out means nothing is read or written and
   * `effectiveColumns` is the column list as given.
   *
   * The grid below runs this same hook internally off `storeColumnsKey`, which is what gives the
   * header its resize handles; this instance is here for the chooser, and the two stay in step
   * through the stored value they share.
   */
  const { effectiveColumns, columnsToggle, setColumnsToggle, resetColumnsToggle, resetColumnsWidth } =
    useDataTableColumns<T>({ key: storeKey, columns: adjustableColumns })

  const columnLabels = useMemo(
    () =>
      Object.fromEntries(
        adjustableColumns.map((column) => [
          String(column.accessor),
          typeof column.title === 'string' ? column.title : humanize(String(column.accessor)),
        ]),
      ),
    [adjustableColumns],
  )

  const toggleableColumns = storeKey === undefined ? [] : columnsToggle.filter((column) => column.toggleable)

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
      {/* The strip now carries the chooser as well, so it shows for either reason. The filter count
          stays on the left and keeps its own wording: a column hidden while its funnel is set is
          exactly when "2 column filters in effect" is the only thing left saying so. */}
      {activeFilters > 0 || toggleableColumns.length > 0 ? (
        <Group justify="space-between" mb="xs" gap="sm" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            {activeFilters > 0 ? (
              <>
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
              </>
            ) : null}
          </Group>

          {toggleableColumns.length > 0 ? (
            <ColumnChooser
              items={toggleableColumns}
              labels={columnLabels}
              onToggle={(accessor, toggled) =>
                setColumnsToggle(
                  columnsToggle.map((column) => (column.accessor === accessor ? { ...column, toggled } : column)),
                )
              }
              onResetColumns={resetColumnsToggle}
              onResetWidths={resetColumnsWidth}
            />
          ) : null}
        </Group>
      ) : null}

      {/* Focusable so the arrow keys have somewhere to land; clicking a row puts the focus here. */}
      <div ref={gridRef} className="app-grid" tabIndex={0} onKeyDown={handleKeys}>
        <MantineDataTable<T>
          // Rows answer a click everywhere now, but only a grid whose rows LEAD somewhere says so
          // with a pointer: selecting is not navigating, and the cursor must not promise it is.
          className={onRowClick ? undefined : 'app-grid--select-only'}
          records={records}
          columns={effectiveColumns}
          {...(storeKey ? { storeColumnsKey: storeKey } : {})}
          fetching={fetching}
          noRecordsText={noRecordsText}
          minHeight={minHeight}
          striped={false}
          highlightOnHover
          withTableBorder={false}
          withColumnBorders
          borderRadius="md"
          verticalAlign="center"
          pinLastColumn={pinLastColumn}
          rowClassName={(record) =>
            [rowId(record, idKey) === selectedId ? 'app-grid__row--selected' : undefined, rowClassName?.(record)]
              .filter(Boolean)
              .join(' ') || undefined
          }
          {...(selectedRecords && onSelectedRecordsChange
            ? { selectedRecords, onSelectedRecordsChange, isRecordSelectable }
            : {})}
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

interface ColumnChooserProps {
  items: DataTableColumnToggle[]
  /** Accessor -> the column's header text, which is what the reader is picking by. */
  labels: Record<string, string>
  onToggle(accessor: string, toggled: boolean): void
  onResetColumns(): void
  onResetWidths(): void
}

/**
 * Which columns the grid shows, and a way back from a layout the reader has made a mess of.
 *
 * A BUTTON RATHER THAN THE HEADER'S CONTEXT MENU. mantine-datatable already opens this list on a
 * right-click of the header, and nobody right-clicks a table to look for it; the same state driven
 * by something visible is the whole point of the control.
 *
 * Widths are reset from here too. They are dragged on the header, so there is no other control they
 * could hang off, and a column dragged down to a sliver is the one case a reader cannot undo by
 * dragging it back.
 */
function ColumnChooser({ items, labels, onToggle, onResetColumns, onResetWidths }: ColumnChooserProps) {
  const shownCount = items.filter((item) => item.toggled).length

  return (
    <Popover position="bottom-end" withArrow shadow="md" trapFocus>
      <Popover.Target>
        <Button size="compact-sm" variant="subtle" leftSection={<IconColumns3 size={15} />}>
          Columns
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={8}>
          <Text fz="xs" fw={600} c="dimmed" tt="uppercase">
            Show columns
          </Text>

          {items.map((item) => (
            <Checkbox
              key={item.accessor}
              size="xs"
              label={labels[item.accessor] ?? item.accessor}
              checked={item.toggled}
              // The last one standing stays: a grid of no columns is not a narrower view of the
              // rows, it is a blank rectangle with a paging footer under it.
              disabled={item.toggled && shownCount === 1}
              onChange={(event) => onToggle(item.accessor, event.currentTarget.checked)}
            />
          ))}

          <Group gap="xs" mt={4} wrap="nowrap">
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconRestore size={13} />}
              onClick={onResetColumns}
            >
              Reset columns
            </Button>
            <Button size="compact-xs" variant="light" onClick={onResetWidths}>
              Reset widths
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

/** The record's id, when it is one this component can compare and remember. */
function rowId<T>(record: T, key: string): RowId | null {
  const value = (record as Record<string, unknown>)[key]
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function noop() {}
