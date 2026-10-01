import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, Anchor, Badge, Button, Group, Paper, Select, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconArrowBackUp, IconEye, IconPlus, IconSearch, IconSend } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { branchesApi } from '../../api/masterdata/branches'
import { partiesApi } from '../../api/masterdata/parties'
import { receiptsApi, RECEIPT_PAYMENT_TYPES, type ReceiptListDto, type ReceiptStatus } from '../../api/sales/receipts'
import type { BranchLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { dateLabel, isoDate, STATUS_COLOURS } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { partyLabel } from '../../components/sales/salesLines'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { FilterBar } from '../../components/ui/FilterBar'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'

interface Filters {
  search: string
  branchId: string | null
  clientId: string | null
  status: string | null
  paymentType: string | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = { search: '', branchId: null, clientId: null, status: null, paymentType: null, dateFrom: null, dateTo: null }
const STATUSES: ReceiptStatus[] = ['Draft', 'Posted', 'Reversed']
const ROUTE = '/sales/receipts'

/**
 * What each column IS, for the grid engine. A receipt's own amount is in its own currency, so the
 * footer sums the BASE-currency columns and the document-currency one carries no total.
 */
const GRID_COLUMNS: GridColumnMeta<ReceiptListDto>[] = [
  { accessor: 'receiptNumber', summary: 'count', text: (r) => r.receiptNumber ?? 'DRAFT' },
  { accessor: 'receiptDate', kind: 'date' },
  { accessor: 'clientName' },
  { accessor: 'paymentTypeName', kind: 'list' },
  { accessor: 'sourceInvoiceNumber', text: (r) => r.sourceInvoiceNumber ?? 'Manual' },
  { accessor: 'branchName' },
  { accessor: 'amount', kind: 'number', text: (r) => `${formatNumber(r.amount, r.decimalPlaces)} ${r.currencyCode}` },
  { accessor: 'amountBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.amountBase, 2) },
  { accessor: 'unappliedBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.unappliedBase, 2) },
  { accessor: 'status', kind: 'list' },
]

/**
 * Every customer receipt: filters that apply as they are typed, row actions gated by permission and
 * status, and the columns a cashier looks for — who paid, how much, whether it has been used.
 *
 * A POSTED RECEIPT HAS NO DELETE. It is reversed, with a reason, and both rows stay: money that was
 * received and then undone is something an auditor asks about.
 */
export function ReceiptsPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  const canCreate = hasPermission(PERMISSIONS.receiptsCreate)
  const canPost = hasPermission(PERMISSIONS.receiptsPost)
  const canReverse = hasPermission(PERMISSIONS.receiptsReverse)
  const canDelete = hasPermission(PERMISSIONS.receiptsDelete)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [clients, setClients] = useState<PartyLookupDto[]>([])

  const [reversing, setReversing] = useState<ReceiptListDto | null>(null)
  const [reverseBusy, setReverseBusy] = useState(false)

  const grid = useGridQuery<Filters, ReceiptListDto, AllRows<ReceiptListDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'receiptDate', direction: 'desc' },
    // The list is loaded whole (newest first, up to the grid's cap) and the grid does the rest.
    paging: 'client',
    errorMessage: 'The receipts could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          receiptsApi.list(
            {
              search: filters.search.trim() || undefined,
              branchId: filters.branchId === null ? undefined : Number(filters.branchId),
              clientId: filters.clientId === null ? undefined : Number(filters.clientId),
              status: (filters.status as ReceiptStatus | null) ?? undefined,
              paymentType: filters.paymentType === null ? undefined : (Number(filters.paymentType) as 1 | 2),
              dateFrom: filters.dateFrom ?? undefined,
              dateTo: filters.dateTo ?? undefined,
              sortBy: 'ReceiptDate',
              sortDir: 'desc',
              page,
              pageSize,
            },
            signal,
          ),
        ),
      [],
    ),
  })

  const { filters, setFilter, data, loading, error } = grid
  const load = grid.reload
  const rows = useMemo(() => data?.items ?? [], [data])

  /* THE ENGINE HOLDS THE LOADED RECEIPTS AND ANSWERS FOR EVERY COLUMN: typed filters, multi-column
     sort, paging, footer totals over all the filtered rows, CSV. The bar above the grid still narrows
     what is loaded from the server; the column filters then narrow that. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'sales.receipts',
    sort: [{ accessor: 'receiptDate', direction: 'desc' }],
  })

  useEffect(() => {
    branchesApi.lookup(false).then(setBranches).catch(() => {})
    partiesApi.lookup({ partyType: 'Client', activeOnly: false }).then(setClients).catch(() => {})
  }, [])

  const label = (row: ReceiptListDto) => row.receiptNumber ?? `draft #${row.id}`

  async function post(row: ReceiptListDto) {
    const go = await confirm({
      title: `Post ${label(row)}`,
      message: 'Post this receipt? Once posted it can no longer be edited or deleted, only reversed.',
      confirmLabel: 'Post',
    })
    if (!go) return
    try {
      await receiptsApi.post(row.id, row.rowVersion)
      notify.success('Receipt posted.')
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The receipt could not be posted.')
    }
  }

  async function reverse(reason: string) {
    const row = reversing
    if (!row) return
    setReverseBusy(true)
    try {
      await receiptsApi.reverse(row.id, reason, row.rowVersion)
      notify.success('Receipt reversed.')
      setReversing(null)
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The receipt could not be reversed.')
    } finally {
      setReverseBusy(false)
    }
  }

  async function remove(row: ReceiptListDto) {
    const go = await confirm({ title: 'Delete draft', message: `Delete ${label(row)}? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
    if (!go) return
    try {
      await receiptsApi.remove(row.id)
      notify.success('Draft deleted.')
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The draft could not be deleted.')
    }
  }

  const columns: DataTableColumn<ReceiptListDto>[] = [
    rowNumberColumn<ReceiptListDto>(engine.page, engine.pageSize),
    {
      accessor: 'receiptNumber',
      title: 'Receipt No.',
      width: 160,
      render: (row) =>
        row.receiptNumber ? (
          <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{row.receiptNumber}</Text>
        ) : (
          <Badge color="gray" variant="light">DRAFT</Badge>
        ),
    },
    { accessor: 'receiptDate', title: 'Date', width: 110, render: (row) => dateLabel(row.receiptDate) },
    {
      accessor: 'clientName',
      title: 'Customer',
      render: (row) => (
        <div>
          <Text fz="sm" fw={500}>{row.clientName}</Text>
          <Text fz="xs" c="dimmed">{row.clientCode}</Text>
        </div>
      ),
    },
    { accessor: 'paymentTypeName', title: 'Payment Type', width: 150 },
    {
      accessor: 'sourceInvoiceNumber',
      title: 'Created by',
      width: 170,
      // A receipt a Cash invoice made says so, and points at the invoice; an ordinary one is typed by a person.
      render: (row) =>
        row.sourceSalesDocumentId !== null ? (
          <Group gap={6} wrap="nowrap">
            <Badge size="xs" color="teal" variant="light">Auto</Badge>
            <Anchor component={Link} to={`/sales/invoices/${row.sourceSalesDocumentId}`} fz="sm" onClick={(event) => event.stopPropagation()}>{row.sourceInvoiceNumber}</Anchor>
          </Group>
        ) : (
          <Text fz="sm" c="dimmed">Manual</Text>
        ),
    },
    { accessor: 'branchName', title: 'Branch' },
    {
      accessor: 'amount',
      title: 'Amount',
      width: 170,
      textAlign: 'right',
      render: (row) => <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{formatNumber(row.amount, row.decimalPlaces)} {row.currencyCode}</Text>,
    },
    {
      accessor: 'amountBase',
      title: 'Amount (USD)',
      width: 140,
      textAlign: 'right',
      render: (row) => formatNumber(row.amountBase, 2),
    },
    {
      accessor: 'unappliedBase',
      title: 'Unapplied (USD)',
      width: 140,
      textAlign: 'right',
      // Only a posted Free Receipt has credit still to use; everywhere else a figure would mislead.
      render: (row) => (row.status === 'Posted' && row.unappliedBase > 0 ? <Text fz="sm" c="orange" fw={500}>{formatNumber(row.unappliedBase, 2)}</Text> : '—'),
    },
    {
      accessor: 'status',
      title: 'Status',
      width: 110,
      render: (row) => <Badge color={STATUS_COLOURS[row.status] ?? 'gray'} variant="light">{row.status}</Badge>,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 170,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={label(row)}
          edit={{ visible: canCreate && row.status === 'Draft', onClick: () => void navigate(`${ROUTE}/${row.id}`) }}
          custom={[
            { icon: <IconEye size={16} />, tooltip: 'View', onClick: () => void navigate(`${ROUTE}/${row.id}`) },
            { icon: <IconSend size={16} />, tooltip: 'Post', visible: canPost && row.status === 'Draft', onClick: () => void post(row) },
            { icon: <IconArrowBackUp size={16} />, tooltip: 'Reverse receipt', color: 'orange', visible: canReverse && row.status === 'Posted' && row.sourceSalesDocumentId === null, onClick: () => setReversing(row) },
          ]}
          remove={{ visible: canDelete && row.status === 'Draft', onClick: () => void remove(row) }}
        />
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Receipts"
        actions={
          canCreate ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => void navigate(`${ROUTE}/new`)}>
              New Receipt
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput label="Search" placeholder="Number, reference or customer" leftSection={<IconSearch size={16} />} value={filters.search} onChange={(event) => setFilter('search', event.currentTarget.value)} />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Branch" placeholder="All branches" data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))} value={filters.branchId} onChange={(next) => setFilter('branchId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Customer" placeholder="All customers" data={clients.map((c) => ({ value: String(c.id), label: partyLabel(c) }))} value={filters.clientId} onChange={(next) => setFilter('clientId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Payment type" placeholder="All" data={RECEIPT_PAYMENT_TYPES.map((t) => ({ value: String(t.value), label: t.label }))} value={filters.paymentType} onChange={(next) => setFilter('paymentType', next)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={1}>
          <Select label="Status" placeholder="All" data={STATUSES} value={filters.status} onChange={(next) => setFilter('status', next)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={1}>
          <DateInput label="From" placeholder="Any" valueFormat="DD/MM/YYYY" value={filters.dateFrom ? new Date(filters.dateFrom) : null} onChange={(next) => setFilter('dateFrom', next ? isoDate(new Date(next)) : null)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={1}>
          <DateInput label="To" placeholder="Any" valueFormat="DD/MM/YYYY" value={filters.dateTo ? new Date(filters.dateTo) : null} onChange={(next) => setFilter('dateTo', next ? isoDate(new Date(next)) : null)} clearable />
        </FilterBar.Col>
      </FilterBar>

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      {data?.truncated ? (
        <Alert color="yellow" mb="md" title="Showing the newest rows only">
          There are more receipts than the grid loads at once. Narrow the list with the filters above (dates, status, customer) to see the rest.
        </Alert>
      ) : null}

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="sales.receipts"
          engine={engine}
          exportFileName="receipts"
          columns={columns}
          fetching={loading}
          noRecordsText="No receipts yet."
          onRowClick={({ record }) => void navigate(`${ROUTE}/${record.id}`)}
        />
      </Paper>

      <CancelReasonModal
        opened={reversing !== null}
        onClose={() => setReversing(null)}
        documentLabel={reversing ? label(reversing) : ''}
        busy={reverseBusy}
        title={reversing ? `Reverse ${label(reversing)}` : undefined}
        placeholder="Why is this being reversed?"
        confirmLabel="Reverse receipt"
        description="Reversing undoes the payment: the invoices it paid become outstanding again. The receipt stays in place as a record. It cannot be undone."
        onConfirm={(reason) => void reverse(reason)}
      />
    </div>
  )
}
