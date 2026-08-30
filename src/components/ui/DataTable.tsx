import { Button, Group, Text } from '@mantine/core'
import { IconFilterOff } from '@tabler/icons-react'
import { DataTable as MantineDataTable, type DataTableColumn, type DataTableSortStatus } from 'mantine-datatable'
import { PAGE_SIZE_OPTIONS } from '../../config'

export type { DataTableColumn, DataTableSortStatus }

interface DataTableProps<T> {
  records: T[]
  columns: DataTableColumn<T>[]
  /** Total rows matching the filters, across every page (server-side paging). */
  totalRecords: number
  page: number
  recordsPerPage: number
  onPageChange(page: number): void
  onRecordsPerPageChange(size: number): void
  sortStatus: DataTableSortStatus<T>
  onSortStatusChange(status: DataTableSortStatus<T>): void
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
}: DataTableProps<T>) {
  const activeFilters = filters?.activeCount ?? 0

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
        totalRecords={totalRecords}
        page={page}
        onPageChange={onPageChange}
        recordsPerPage={recordsPerPage}
        recordsPerPageOptions={[...PAGE_SIZE_OPTIONS]}
        onRecordsPerPageChange={onRecordsPerPageChange}
        sortStatus={sortStatus}
        onSortStatusChange={onSortStatusChange}
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
        paginationText={({ from, to, totalRecords: total }) => `Showing ${from} to ${to} of ${total} entries`}
      />
    </>
  )
}
