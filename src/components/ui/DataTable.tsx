import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Button, Checkbox, Group, Menu, Modal, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconColumns3, IconFilterOff, IconRestore } from '@tabler/icons-react'
import { formatNumber } from '../format'
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

/* ── the summary row ──────────────────────────────────────────────────────────────────────────── */

/** What a column's footer cell can report. */
type SummaryKind = 'none' | 'count' | 'sum' | 'avg' | 'min' | 'max'

const SUMMARY_LABELS: Record<Exclude<SummaryKind, 'none'>, string> = {
  count: 'Count',
  sum: 'Sum',
  avg: 'Average',
  min: 'Min',
  max: 'Max',
}

/** The four that need numbers; Count works on any column, and None clears the cell. */
const NUMERIC_KINDS: SummaryKind[] = ['sum', 'avg', 'min', 'max']

type SummaryChoices = Record<string, SummaryKind>

function summaryStorageKey(storeKey: string): string {
  return `${storeKey}-summaries`
}

/** Reading storage can throw in a private window or with site data blocked, so it never decides render. */
function readSummaries(storeKey: string | undefined): SummaryChoices {
  if (storeKey === undefined) return {}
  try {
    const raw = localStorage.getItem(summaryStorageKey(storeKey))
    return raw ? (JSON.parse(raw) as SummaryChoices) : {}
  } catch {
    return {}
  }
}

/** The raw values of one column, keeping only the numbers - a blank cell is not a zero. */
function numbersIn<T>(rows: T[], accessor: string): number[] {
  const values: number[] = []
  for (const row of rows) {
    const value = (row as Record<string, unknown>)[accessor]
    if (typeof value === 'number' && !Number.isNaN(value)) values.push(value)
  }
  return values
}

/**
 * One column's figure over the rows the funnels LEFT - not the page on screen, which would change
 * as the reader turned it, and not the whole table, which would answer a question they had just
 * narrowed away from.
 */
function computeSummary<T>(rows: T[], accessor: string, kind: SummaryKind): number | null {
  if (kind === 'none') return null
  if (kind === 'count') return rows.length

  const numbers = numbersIn(rows, accessor)
  if (numbers.length === 0) return null

  switch (kind) {
    case 'sum':
      return numbers.reduce((total, value) => total + value, 0)
    case 'avg':
      return numbers.reduce((total, value) => total + value, 0) / numbers.length
    case 'min':
      return Math.min(...numbers)
    default:
      return Math.max(...numbers)
  }
}

/** Whole numbers read as whole numbers; an average or a money total keeps its two places. */
function formatSummary(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : 2)
}

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
  /**
   * The rows the footer's figures are taken over: every row the filters left, NOT the page on
   * screen. Passing them turns the summary row on, and each column's footer cell then offers Sum,
   * Average, Min, Max and Count.
   *
   * ONLY A GRID THAT HOLDS ITS WHOLE RESULT MAY PASS THIS. A server-paged grid holds one page, so
   * its "Sum" would quietly add up ten rows out of five hundred - a wrong number, stated with the
   * same confidence as a right one. Those grids leave it out and show no footer until the totals
   * can be computed by the search procedure over the whole result.
   *
   * Requires {@link DataTableProps.storeKey}, which is where the reader's choices are remembered.
   */
  summaryRecords?: T[]
  /**
   * What {@link DataTableProps.summaryRecords} actually covers, which is what the footer says out loud.
   *
   * 'filtered' (the default) is a grid holding its whole result: the figures answer for every row the
   * filters left, so they stand on their own. 'page' is a grid that pages on the SERVER and can only
   * add up the rows it was sent - there the cell prints "of this page" under the figure, because a
   * total of ten rows out of five hundred read as a total of five hundred is how a grid lies.
   */
  summaryScope?: 'filtered' | 'page'
}

/**
 * The application's grid: mantine-datatable wired for server-side paging and sorting.
 * Every list page uses this so paging, sorting and the footer wording stay identical.
 *
 * Per-column filtering is opt-in per column: give the column the props from `columnFilter()` and
 * hand the same {@link GridFilters} to `filters` here.
 *
 * A {@link DataTableProps.storeKey} adds draggable column widths and the column chooser - reached by
 * right-clicking the header, never shown otherwise - both remembered per reader under that key.
 * They are the grid's own business rather than each page's, which is why a page asks for them with
 * one prop and never repeats a flag down its column list.
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
  summaryRecords,
  summaryScope = 'filtered',
}: DataTableProps<T>) {
  const activeFilters = filters?.activeCount ?? 0
  const idKey = idAccessor ?? 'id'

  /**
   * Every column a page did not fix or decide for itself becomes resizable, so a page opts in with
   * one prop instead of repeating a flag down its column list.
   *
   * `toggleable` IS DELIBERATELY NOT SET, though these columns are exactly the ones the chooser
   * offers. mantine-datatable reads that flag as permission to run its own column UI: a cross in
   * every header that hides the column, and a checkbox list on right-click that opens straight
   * away. The cross reads as "clear" next to the header funnels, and the list is meant to be
   * reached through the menu below. Hiding does not depend on the flag - `effectiveColumns` takes
   * it from the stored toggle state either way - so leaving it off costs nothing.
   */
  const adjustableColumns = useMemo(
    () =>
      storeKey === undefined
        ? columns
        : columns.map((column) =>
            FIXED_ACCESSORS.has(String(column.accessor))
              ? column
              : { ...column, resizable: column.resizable ?? true },
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

  /** What each column reports in the footer. Read once from storage; absent means None. */
  const [summaries, setSummaries] = useState<SummaryChoices>(() => readSummaries(storeKey))

  useEffect(() => {
    if (storeKey === undefined) return
    try {
      localStorage.setItem(summaryStorageKey(storeKey), JSON.stringify(summaries))
    } catch {
      // A browser that refuses storage still shows the figures; it just forgets them on reload.
    }
  }, [storeKey, summaries])

  /**
   * The footer cells, added to the columns the grid is about to draw.
   *
   * A column that brought its OWN footer keeps it - the sales profit report states its totals in
   * its own words, and a generic Sum must not overwrite them. "#" and Actions get none: a total of
   * row numbers is not a fact about anything.
   */
  const columnsWithSummary = useMemo(() => {
    if (summaryRecords === undefined) return effectiveColumns

    return effectiveColumns.map((column) => {
      const accessor = String(column.accessor)
      if (FIXED_ACCESSORS.has(accessor) || column.footer !== undefined) return column

      const kind = summaries[accessor] ?? 'none'
      return {
        ...column,
        footer: (
          <SummaryCell
            label={typeof column.title === 'string' ? column.title : humanize(accessor)}
            kind={kind}
            value={computeSummary(summaryRecords, accessor, kind)}
            numeric={numbersIn(summaryRecords, accessor).length > 0}
            scope={summaryScope}
            onChange={(next) => setSummaries((current) => ({ ...current, [accessor]: next }))}
          />
        ),
      }
    })
  }, [effectiveColumns, summaryRecords, summaryScope, summaries])

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

  /**
   * What the chooser offers. Judged on this component's own list of fixed columns rather than on
   * the `toggleable` flag, which is left unset on purpose (see above).
   */
  const choosableColumns =
    storeKey === undefined ? [] : columnsToggle.filter((column) => !FIXED_ACCESSORS.has(String(column.accessor)))

  /** Where the header was right-clicked, and so where the menu opens. Null while it is closed. */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [chooserOpen, setChooserOpen] = useState(false)

  const [selectedId, setSelectedId] = useState<RowId | null>(null)
  const [lastPage, setLastPage] = useState(page)
  const gridRef = useRef<HTMLDivElement>(null)

  /**
   * THE HEADER ONLY. A right-click on a row is the browser's, as it has always been - the menu
   * belongs to the columns, and offering it over the data would put it in the way of copying a cell.
   */
  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (choosableColumns.length === 0) return
    if (!(event.target as HTMLElement).closest('thead')) return

    event.preventDefault()
    setMenuAt({ x: event.clientX, y: event.clientY })
  }

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
      {/* A column hidden while its funnel is still set is exactly when this line is the only thing
          left on screen saying the result is narrowed. */}
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

      {/* Anchored to the pointer: a 1px target parked where the click landed, which is what a
          context menu is. Rendered only while open so it is not a stray element under the page. */}
      <Menu opened={menuAt !== null} onClose={() => setMenuAt(null)} position="bottom-start" shadow="md" width={200}>
        <Menu.Target>
          <div
            aria-hidden
            style={{ position: 'fixed', left: menuAt?.x ?? 0, top: menuAt?.y ?? 0, width: 1, height: 1 }}
          />
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconColumns3 size={15} />}
            onClick={() => {
              setMenuAt(null)
              setChooserOpen(true)
            }}
          >
            Column chooser
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <ColumnChooser
        opened={chooserOpen}
        onClose={() => setChooserOpen(false)}
        items={choosableColumns}
        labels={columnLabels}
        onToggle={(accessor, toggled) =>
          setColumnsToggle(
            columnsToggle.map((column) => (column.accessor === accessor ? { ...column, toggled } : column)),
          )
        }
        onResetColumns={resetColumnsToggle}
        onResetWidths={resetColumnsWidth}
      />

      {/* Focusable so the arrow keys have somewhere to land; clicking a row puts the focus here. */}
      <div ref={gridRef} className="app-grid" tabIndex={0} onKeyDown={handleKeys} onContextMenu={handleContextMenu}>
        <MantineDataTable<T>
          // Rows answer a click everywhere now, but only a grid whose rows LEAD somewhere says so
          // with a pointer: selecting is not navigating, and the cursor must not promise it is.
          className={onRowClick ? undefined : 'app-grid--select-only'}
          records={records}
          columns={columnsWithSummary}
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

interface SummaryCellProps {
  /** The column's heading, so the menu says what is being totalled. */
  label: string
  kind: SummaryKind
  value: number | null
  /** False when no row holds a number here, which leaves only Count on offer. */
  numeric: boolean
  /** 'page' makes the cell say so, because the figure then describes less than the whole result. */
  scope: 'filtered' | 'page'
  onChange(kind: SummaryKind): void
}

/**
 * One column's figure in the footer, and the menu that chooses it.
 *
 * THE WHOLE CELL IS THE CONTROL, including while it reports nothing: a column showing no figure
 * still has to be how the reader asks it for one, and a footer of separate little buttons would
 * weigh more than the row it sits under. An unset cell shows a faint dash rather than nothing at
 * all, so the row reads as a thing that can be clicked.
 */
function SummaryCell({ label, kind, value, numeric, scope, onChange }: SummaryCellProps) {
  const offered: SummaryKind[] = numeric ? ['count', ...NUMERIC_KINDS] : ['count']

  // Said in the cell rather than once above the grid, because the figure is what gets read, quoted
  // and screenshotted - and on its own it looks like a total of everything.
  const covers = scope === 'page' ? 'of this page' : null

  return (
    <Menu position="top-end" withArrow shadow="md" width={180}>
      <Menu.Target>
        <UnstyledButton
          className="app-grid__summary"
          aria-label={
            kind === 'none'
              ? `Summarise ${label}`
              : `${SUMMARY_LABELS[kind]} of ${label}${covers ? ', this page only' : ''}`
          }
        >
          {kind === 'none' || value === null ? (
            <Text fz="sm" c="dimmed" aria-hidden>
              –
            </Text>
          ) : (
            <Stack gap={0}>
              <Text fz={10} c="dimmed" tt="uppercase" lh={1.2}>
                {SUMMARY_LABELS[kind]}
              </Text>
              <Text fz="sm" fw={700} lh={1.3}>
                {formatSummary(value)}
              </Text>
              {covers ? (
                <Text fz={10} c="dimmed" lh={1.2}>
                  {covers}
                </Text>
              ) : null}
            </Stack>
          )}
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>{label}</Menu.Label>
        {offered.map((option) => (
          <Menu.Item
            key={option}
            onClick={() => onChange(option)}
            fw={option === kind ? 700 : undefined}
          >
            {SUMMARY_LABELS[option as Exclude<SummaryKind, 'none'>]}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item onClick={() => onChange('none')} disabled={kind === 'none'}>
          None
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

interface ColumnChooserProps {
  opened: boolean
  onClose(): void
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
 * Opened from the header's context menu, so nothing about it sits on screen until it is asked for -
 * a grid is read far more often than it is rearranged, and a control for rearranging it is clutter
 * on every other visit.
 *
 * Widths are reset from here too. They are dragged on the header, so there is nowhere else the
 * control could hang, and a column dragged down to a sliver is the one case a reader cannot undo by
 * dragging it back.
 */
function ColumnChooser({
  opened,
  onClose,
  items,
  labels,
  onToggle,
  onResetColumns,
  onResetWidths,
}: ColumnChooserProps) {
  const shownCount = items.filter((item) => item.toggled).length

  return (
    <Modal opened={opened} onClose={onClose} title="Column chooser" size="sm" centered>
      <Stack gap={10}>
        <Text fz="xs" c="dimmed">
          Columns ticked here are the ones the grid shows. Drag the edge of a header to set its
          width, or double-click that edge to put it back.
        </Text>

        {items.map((item) => (
          <Checkbox
            key={item.accessor}
            size="sm"
            label={labels[item.accessor] ?? item.accessor}
            checked={item.toggled}
            // The last one standing stays: a grid of no columns is not a narrower view of the
            // rows, it is a blank rectangle with a paging footer under it.
            disabled={item.toggled && shownCount === 1}
            onChange={(event) => onToggle(item.accessor, event.currentTarget.checked)}
          />
        ))}

        <Group gap="xs" mt="xs" wrap="nowrap">
          <Button size="compact-sm" variant="light" leftSection={<IconRestore size={14} />} onClick={onResetColumns}>
            Reset columns
          </Button>
          <Button size="compact-sm" variant="light" onClick={onResetWidths}>
            Reset widths
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** The record's id, when it is one this component can compare and remember. */
function rowId<T>(record: T, key: string): RowId | null {
  const value = (record as Record<string, unknown>)[key]
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function noop() {}
