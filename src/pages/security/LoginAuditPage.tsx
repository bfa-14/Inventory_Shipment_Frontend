import { useCallback } from 'react'
import { Alert, Badge, Button, Checkbox, Group, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconRefresh } from '@tabler/icons-react'
import { securityApi } from '../../api/security'
import type { LoginAuditDto } from '../../api/types'
import { formatDateTime } from '../../components/format'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
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
 * What each column IS, for the grid engine: its kind (so a time compares as a time) and what it
 * shows. How a cell LOOKS stays in the column definitions below.
 */
const GRID_COLUMNS: GridColumnMeta<LoginAuditDto>[] = [
  { accessor: 'attemptedAtUtc', kind: 'date', text: (e) => formatDateTime(e.attemptedAtUtc), summary: 'count' },
  { accessor: 'username' },
  { accessor: 'succeeded', kind: 'boolean', text: (e) => (e.succeeded ? 'Success' : 'Failed') },
  { accessor: 'failureReason', text: (e) => e.failureReason ?? '' },
  { accessor: 'ipAddress', text: (e) => e.ipAddress ?? '' },
  { accessor: 'userAgent', text: (e) => e.userAgent ?? '' },
]

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

  /* The header filters narrow what the request already returned - a second, purely local layer,
     answered by the engine for every column. */
  const engine = useDataGrid({
    rows: entries,
    columns: GRID_COLUMNS,
    storeKey: 'security.loginAudit',
    sort: [{ accessor: 'attemptedAtUtc', direction: 'desc' }],
  })

  const columns: DataTableColumn<LoginAuditDto>[] = [
    {
      accessor: 'attemptedAtUtc',
      title: 'Time',
      width: 215,
      render: (e) => formatDateTime(e.attemptedAtUtc),
    },
    {
      accessor: 'username',
      title: 'Username',
      width: 195,
    },
    {
      accessor: 'succeeded',
      title: 'Result',
      width: 145,
      render: (e) => (
        <Badge variant="light" color={e.succeeded ? 'green' : 'red'}>
          {e.succeeded ? 'Success' : 'Failed'}
        </Badge>
      ),
    },
    {
      accessor: 'failureReason',
      title: 'Reason',
      render: (e) => e.failureReason ?? '-',
    },
    {
      accessor: 'ipAddress',
      title: 'IP address',
      width: 175,
      render: (e) => e.ipAddress ?? '-',
    },
    {
      accessor: 'userAgent',
      title: 'User agent',
      // No tick list: a user agent is prose, one string per browser build, so the box is the control
      // that helps - "Chrome" or "Windows" narrows it, a list of 200 full strings does not.
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
          engine={engine}
          exportFileName="login-audit"
          columns={columns}
          fetching={loading}
          noRecordsText="No sign-in attempts match these filters."
        />
      </Paper>
    </>
  )
}
