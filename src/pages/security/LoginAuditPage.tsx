import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Checkbox, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { securityApi } from '../../api/security'
import type { LoginAuditDto } from '../../api/types'
import { formatDateTime } from '../../components/format'
import { columnFilter } from '../../components/ui/columnFilter'
import { DataTable, type DataTableColumn, type DataTableSortStatus } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useGridFilters, type ColumnText } from '../../components/ui/gridFilters'
import { PageHeader } from '../../components/ui/PageHeader'
import { PAGE_SIZE_DEFAULT } from '../../config'

const TAKE_OPTIONS = ['50', '200', '500']

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
  const [entries, setEntries] = useState<LoginAuditDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [username, setUsername] = useState('')
  const [onlyFailed, setOnlyFailed] = useState(false)
  const [take, setTake] = useState('200')

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [sortStatus, setSortStatus] = useState<DataTableSortStatus<LoginAuditDto>>({
    columnAccessor: 'attemptedAtUtc',
    direction: 'desc',
  })
  // A filter that leaves three rows must not strand the reader on page 4 of the old result.
  const grid = useGridFilters(COLUMN_TEXT, () => setPage(1))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setEntries(await securityApi.loginAudit({ username, onlyFailed, take: Number(take) }))
      setPage(1)
    } catch (err) {
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The login audit could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [username, onlyFailed, take])

  // Refetch when a filter the user toggles changes; the username needs an explicit Refresh.
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyFailed, take])

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
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load()
            }}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select label="Rows" data={TAKE_OPTIONS} value={take} onChange={(v) => setTake(v ?? '200')} allowDeselect={false} />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Checkbox
            label="Only failed"
            checked={onlyFailed}
            onChange={(e) => setOnlyFailed(e.currentTarget.checked)}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Button leftSection={<IconRefresh size={16} />} loading={loading} onClick={() => void load()}>
            Refresh
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load the login audit">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<LoginAuditDto>
          records={records}
          columns={columns}
          totalRecords={narrowed.length}
          page={page}
          recordsPerPage={pageSize}
          onPageChange={setPage}
          onRecordsPerPageChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          sortStatus={sortStatus}
          onSortStatusChange={(status) => {
            setSortStatus(status)
            setPage(1)
          }}
          fetching={loading}
          filters={grid}
          noRecordsText="No sign-in attempts match these filters."
        />
      </Paper>
    </>
  )
}
