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
}

/**
 * The application's grid: mantine-datatable wired for server-side paging and sorting.
 * Every list page uses this so paging, sorting and the footer wording stay identical.
 *
 * Per-column filtering is opt-in per column: give the column the props from `columnFilter()` and
 * hand the same {@link GridFilters} to `filters` here.
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
}: DataTableProps<T>) {
  const activeFilters = filters?.activeCount ?? 0

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

      <MantineDataTable<T>
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
        {...(idAccessor ? { idAccessor } : {})}
        {...(onRowClick
          ? { onRowClick: ({ record, index }: { record: T; index: number }) => onRowClick({ record, index }) }
          : {})}
        {...sortProps}
        {...pagingProps}
      />
    </>
  )
}

function noop() {}
