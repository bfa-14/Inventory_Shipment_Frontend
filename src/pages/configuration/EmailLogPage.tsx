import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Drawer,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconMailForward, IconRefresh, IconSearch } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import {
  categoryLabel,
  EMAIL_CATEGORIES,
  emailsApi,
  type EmailDto,
  type EmailListDto,
  type EmailStatus,
} from '../../api/emails'
import { isoDate } from '../../components/documents/documentKind'
import { formatDateTime } from '../../components/format'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useGridQuery } from '../../hooks/useGridQuery'
import { routes } from '../../routes'

interface Filters {
  search: string
  status: EmailStatus | null
  category: string | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = { search: '', status: null, category: null, dateFrom: null, dateTo: null }

const STATUS_COLOR: Record<EmailStatus, string> = { Pending: 'gray', Sent: 'green', Failed: 'red' }

const GRID_COLUMNS: GridColumnMeta<EmailListDto>[] = [
  { accessor: 'createdAtUtc', kind: 'date', text: (r) => formatDateTime(r.createdAtUtc), summary: 'count' },
  { accessor: 'toAddresses' },
  { accessor: 'subject' },
  { accessor: 'category', kind: 'list', text: (r) => categoryLabel(r.category) },
  { accessor: 'status', kind: 'list' },
  { accessor: 'attempts', kind: 'number' },
  { accessor: 'relatedDocumentId', kind: 'number' },
]

function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <Badge variant="light" color={STATUS_COLOR[status] ?? 'gray'}>
      {status}
    </Badge>
  )
}

/**
 * Every email the application queued: to whom, about what, and whether it left. While sending is off in
 * Settings > Email they stay Pending here - the log is also how an email is read without sending it.
 *
 * THE HTML IS SHOWN IN A SANDBOXED FRAME (`sandbox=""`): no script of an email can run in the application,
 * and none of its links can act on the page around it.
 */
export function EmailLogPage() {
  const [openId, setOpenId] = useState<number | null>(null)
  const [queueing, setQueueing] = useState(false)

  const grid = useGridQuery<Filters, EmailListDto, AllRows<EmailListDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'createdAtUtc', direction: 'desc' },
    paging: 'client',
    errorMessage: 'The Email log could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          emailsApi.search(
            {
              search: filters.search.trim() || undefined,
              status: filters.status ?? undefined,
              category: filters.category ?? undefined,
              dateFrom: filters.dateFrom ?? undefined,
              dateTo: filters.dateTo ?? undefined,
              page,
              pageSize: Math.min(pageSize, 200),
            },
            signal,
          ),
        ),
      [],
    ),
  })

  const { filters, setFilter, clearFilters, isDefault, data, loading, error, reload } = grid
  const rows = useMemo(() => data?.items ?? [], [data])

  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'configuration.emailLog',
    sort: [{ accessor: 'createdAtUtc', direction: 'desc' }],
  })

  async function queueTest() {
    setQueueing(true)
    try {
      const queued = await emailsApi.queueTest()
      notify.success(`Test email queued for ${queued.toAddresses}.`)
      reload()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The test email could not be queued.')
    } finally {
      setQueueing(false)
    }
  }

  const columns: DataTableColumn<EmailListDto>[] = [
    rowNumberColumn<EmailListDto>(engine.page, engine.pageSize),
    { accessor: 'createdAtUtc', title: 'Date', width: 170, render: (r) => formatDateTime(r.createdAtUtc) },
    {
      accessor: 'toAddresses',
      title: 'To',
      width: 220,
      render: (r) => (
        <Text fz="sm" lineClamp={1} title={r.toAddresses}>
          {r.toAddresses.split(';').join(', ')}
        </Text>
      ),
    },
    {
      accessor: 'subject',
      title: 'Subject',
      render: (r) => (
        <Text fz="sm" lineClamp={1} title={r.subject}>
          {r.subject}
        </Text>
      ),
    },
    { accessor: 'category', title: 'Category', width: 170, render: (r) => categoryLabel(r.category) },
    { accessor: 'status', title: 'Status', width: 110, render: (r) => <StatusBadge status={r.status} /> },
    { accessor: 'attempts', title: 'Attempts', width: 95, textAlign: 'right' },
    {
      accessor: 'relatedDocumentId',
      title: 'Document',
      width: 120,
      render: (r) =>
        r.relatedDocumentId ? (
          <Anchor
            component={Link}
            to={routes.purchaseOrder(r.relatedDocumentId)}
            fz="sm"
            onClick={(event) => event.stopPropagation()}
          >
            Order #{r.relatedDocumentId}
          </Anchor>
        ) : (
          '-'
        ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Email log"
        subtitle="Every email the application queued, and whether it was sent."
        actions={
          <Button leftSection={<IconMailForward size={16} />} loading={queueing} onClick={() => void queueTest()}>
            Send test email to me
          </Button>
        }
      />

      <FilterBar>
        <FilterBar.Col span={4}>
          <TextInput
            label="Search"
            placeholder="Recipient or subject"
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(event) => setFilter('search', event.currentTarget.value)}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Status"
            placeholder="All"
            data={['Pending', 'Sent', 'Failed']}
            value={filters.status}
            onChange={(next) => setFilter('status', next as EmailStatus | null)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Category"
            placeholder="All"
            data={EMAIL_CATEGORIES}
            value={filters.category}
            onChange={(next) => setFilter('category', next)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date from"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateFrom ? new Date(filters.dateFrom) : null}
            onChange={(next) => setFilter('dateFrom', next ? isoDate(new Date(next)) : null)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date to"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateTo ? new Date(filters.dateTo) : null}
            onChange={(next) => setFilter('dateTo', next ? isoDate(new Date(next)) : null)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={12}>
          <Group justify="flex-end">
            <Button variant="default" onClick={clearFilters} disabled={isDefault}>
              Clear Filters
            </Button>
          </Group>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="configuration.emailLog"
          engine={engine}
          columns={columns}
          fetching={loading}
          noRecordsText="No email yet."
          onRowClick={({ record }) => setOpenId(record.id)}
        />
      </Paper>

      <EmailDrawer id={openId} onClose={() => setOpenId(null)} onRetried={reload} />
    </div>
  )
}

interface EmailDrawerProps {
  id: number | null
  onClose(): void
  onRetried(): void
}

function EmailDrawer({ id, onClose, onRetried }: EmailDrawerProps) {
  const [email, setEmail] = useState<EmailDto | null>(null)
  const [retrying, setRetrying] = useState(false)

  // Loaded when the drawer opens on an email; the last one is kept while it closes, so nothing blinks away.
  useEffect(() => {
    if (id === null) return
    const controller = new AbortController()
    emailsApi
      .get(id, controller.signal)
      .then(setEmail)
      .catch((err) => {
        if (!controller.signal.aborted)
          notify.error(err instanceof ApiError ? err.message : 'The email could not be loaded.')
      })
    return () => controller.abort()
  }, [id])

  async function retry() {
    if (!email) return
    setRetrying(true)
    try {
      setEmail(await emailsApi.retry(email.id))
      notify.success('The email will be sent again at the next cycle.')
      onRetried()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The email could not be retried.')
    } finally {
      setRetrying(false)
    }
  }

  const shown = email && email.id === id ? email : null

  return (
    <Drawer opened={id !== null} onClose={onClose} position="right" size="xl" title={shown?.subject ?? 'Email'}>
      {!shown ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
        </Group>
      ) : (
        <Stack gap="sm">
          <Detail label="To" value={shown.toAddresses.split(';').join(', ')} />
          {shown.ccAddresses ? <Detail label="CC" value={shown.ccAddresses.split(';').join(', ')} /> : null}
          <Detail label="Subject" value={shown.subject} />
          <Group gap="xs">
            <Text fz="sm" c="dimmed" w={110}>
              Status
            </Text>
            <StatusBadge status={shown.status} />
            {shown.status === 'Failed' ? (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconRefresh size={14} />}
                loading={retrying}
                onClick={() => void retry()}
              >
                Retry
              </Button>
            ) : null}
          </Group>
          <Detail label="Attempts" value={String(shown.attempts)} />
          {shown.lastError ? <Detail label="Last error" value={shown.lastError} color="red" /> : null}
          <Detail label="Sent at" value={shown.sentAtUtc ? formatDateTime(shown.sentAtUtc) : '-'} />
          {shown.attachmentName ? <Detail label="Attachment" value={shown.attachmentName} /> : null}
          <iframe
            title={`Email ${shown.id}`}
            sandbox=""
            srcDoc={shown.bodyHtml}
            style={{
              width: '100%',
              height: '65vh',
              border: '1px solid var(--mantine-color-gray-3)',
              borderRadius: 8,
              background: '#fff',
            }}
          />
        </Stack>
      )}
    </Drawer>
  )
}

function Detail({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Group gap="xs" align="flex-start" wrap="nowrap">
      <Text fz="sm" c="dimmed" w={110} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text fz="sm" c={color} style={{ wordBreak: 'break-word' }}>
        {value}
      </Text>
    </Group>
  )
}
