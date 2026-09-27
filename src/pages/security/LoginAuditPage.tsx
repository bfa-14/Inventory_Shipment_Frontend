import { useCallback } from 'react'
import { Alert, Badge, Button, Checkbox, Group, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconRefresh } from '@tabler/icons-react'
import { securityApi } from '../../api/security'
import type { LoginAuditDto } from '../../api/types'
import { formatDateTime } from '../../components/format'
import { columnFilter } from '../../components/ui/columnFilter'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useGridFilters, type ColumnText } from '../../components/ui/gridFilters'
import { PageHeader } from '../../components/ui/PageHeader'
import { useGridQuery } from '../../hooks/useGridQuery'

const TAKE_OPTIONS = ['50', '200', '500']

/** The filters the reader edits. The endpoint answers with one flat list, so paging happens here. */
interface Filters {
  username: string
  onlyFailed: boolean
  take: string
}

const NO_FILTERS: Filters = { username: '', onlyFailed: false, take: '200' }

/**
 * What each column SHOWS for an attempt - the text its header filter matches and, where the column
 * offers a tick list, the values that list is built from. Module-level so the filter callbacks keep
 * their identity between renders.
 */
const COLUMN_TEXT: Record<string, ColumnText<LoginAuditDto>> = {
  attemptedAtUtc: (e) => formatDateTime(e.attemptedAtUtc),
  username: (e) => e.username,
  succeeded: (e) => (e.succeeded ? 'Success' : 'Failed'),
  failureReason: (e) => e.failureReason ?? '',
  ipAddress: (e) => e.ipAddress ?? '',
  userAgent: (e) => e.userAgent ?? '',
}

/** The closed set the Result funnel offers, whatever the loaded rows happen to contain. */
const RESULT_VALUES = ['Success', 'Failed']

export function LoginAuditPage() {
  /**
   * The username, the row cap and the failed-only switch all narrow the request, so they run through
   * the shared grid query: typing settles after 350ms, the other two land at once, and the newest
   * request always wins. Paging is 'client' because the endpoint returns one flat list - turning a
   * page must not ask the server again for rows it already sent.
   */
  const query = useGridQuery<Filters, LoginAuditDto, LoginAuditDto[]>({
    initialFilters: NO_FILTERS,
    debounced: ['username'],
    initialSort: { columnAccessor: 'attemptedAtUtc', direction: 'desc' },
    paging: 'client',
    errorMessage: 'The login audit could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        securityApi.loginAudit(
          {
            username: filters.username.trim() || undefined,
            onlyFailed: filters.onlyFailed,
            take: Number(filters.take),
          },
          signal,
        ),
      [],
    ),
  })

  const { filters, setFilter, loading, error } = query
  const entries = query.data ?? []
  const { page, pageSize, sortStatus } = query

  // The header funnels narrow what the request already returned - a second, purely local layer.
  const grid = useGridFilters(COLUMN_TEXT, () => query.setPage(1))

  /** The endpoint returns one flat list, so column filtering, sorting and paging all happen here. */
  const narrowed = grid.apply(entries)
  const key = sortStatus.columnAccessor as keyof LoginAuditDto
  const sorted = [...narrowed].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')))
  if (sortStatus.direction === 'desc') sorted.reverse()
  const records = sorted.slice((page - 1) * pageSize, page * pageSize)

  /**
   * The tick lists come from every loaded attempt, not from the rows surviving the filters - a list
   * that shrank as values were ticked would leave a filtered-out value impossible to un-tick.
   */
  const values = {
    username: grid.options(entries, 'username'),
    failureReason: grid.options(entries, 'failureReason'),
    ipAddress: grid.options(entries, 'ipAddress'),
  }

  const columns: DataTableColumn<LoginAuditDto>[] = [
    {
      accessor: 'attemptedAtUtc',
      title: 'Time',
      sortable: true,
      width: 215,
      // No tick list: every attempt is a different instant, so the list would be one entry per row.
      // The box matches the formatted text, so a date or an hour narrows it the way it reads.
      ...columnFilter({ ...grid.bind('attemptedAtUtc'), label: 'Time' }),
      render: (e) => formatDateTime(e.attemptedAtUtc),
    },
    {
      accessor: 'username',
      title: 'Username',
      sortable: true,
      width: 195,
      ...columnFilter({ ...grid.bind('username'), label: 'Username', options: values.username }),
    },
    {
      accessor: 'succeeded',
      title: 'Result',
      sortable: true,
      width: 145,
      ...columnFilter({ ...grid.bind('succeeded'), label: 'Result', options: RESULT_VALUES, withText: false }),
      render: (e) => (
        <Badge variant="light" color={e.succeeded ? 'green' : 'red'}>
          {e.succeeded ? 'Success' : 'Failed'}
        </Badge>
      ),
    },
    {
      accessor: 'failureReason',
      title: 'Reason',
      ...columnFilter({ ...grid.bind('failureReason'), label: 'Reason', options: values.failureReason }),
      render: (e) => e.failureReason ?? '-',
    },
    {
      accessor: 'ipAddress',
      title: 'IP address',
      width: 175,
      ...columnFilter({ ...grid.bind('ipAddress'), label: 'IP address', options: values.ipAddress }),
      render: (e) => e.ipAddress ?? '-',
    },
    {
      accessor: 'userAgent',
      title: 'User agent',
      // No tick list: a user agent is prose, one string per browser build, so the box is the control
      // that helps - "Chrome" or "Windows" narrows it, a list of 200 full strings does not.
      ...columnFilter({ ...grid.bind('userAgent'), label: 'User agent' }),
      render: (e) => (
        <Text fz="sm" lineClamp={1} title={e.userAgent ?? undefined}>
          {e.userAgent ?? '-'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Login audit" subtitle="Every sign-in attempt, successful or not." />

      <FilterBar>
        <FilterBar.Col span={4}>
          <TextInput
            label="Username"
            placeholder="Exact username"
            value={filters.username}
            onChange={(e) => setFilter('username', e.currentTarget.value)}
            // Enter sends what is typed now instead of waiting out the debounce.
            onKeyDown={(e) => {
              if (e.key === 'Enter') query.commitFilters()
            }}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            label="Rows"
            data={TAKE_OPTIONS}
            value={filters.take}
            onChange={(value) => setFilter('take', value ?? '200')}
            allowDeselect={false}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Checkbox
            label="Only failed"
            checked={filters.onlyFailed}
            onChange={(e) => setFilter('onlyFailed', e.currentTarget.checked)}
          />
        </FilterBar.Col>

        <FilterBar.Col span={4}>
          <Group gap="sm">
            <Button
              variant="default"
              leftSection={<IconFilterOff size={16} />}
              onClick={query.clearFilters}
              disabled={query.isDefault}
            >
              Clear Filters
            </Button>
            {/* Not an Apply button: the filters are already live. This re-asks for the same query,
                which is the only way to see attempts made since the page loaded. */}
            <Button variant="default" leftSection={<IconRefresh size={16} />} loading={loading} onClick={query.reload}>
              Refresh
            </Button>
          </Group>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load the login audit">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<LoginAuditDto>
          storeKey="security.loginAudit"
          records={records}
          columns={columns}
          totalRecords={narrowed.length}
          page={page}
          recordsPerPage={pageSize}
          onPageChange={query.setPage}
          onRecordsPerPageChange={query.setPageSize}
          sortStatus={sortStatus}
          onSortStatusChange={query.setSortStatus}
          fetching={loading}
          filters={grid}
          noRecordsText="No sign-in attempts match these filters."
        />
      </Paper>
    </>
  )
}
