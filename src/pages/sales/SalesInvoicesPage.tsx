import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Alert, Anchor, Badge, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconEye, IconFilterOff, IconPlus, IconSearch, IconSend } from '@tabler/icons-react'
import type { BulkActionResult } from '../../api/documents'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import { partiesApi } from '../../api/masterdata/parties'
import { SALES_PAYMENT_TYPES, salesInvoicesApi, type SalesInvoiceListDto, type SalesInvoiceStatus, type SalesPaymentStatus, type SalesPaymentType } from '../../api/sales/invoices'
import type { BranchLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { BulkActionsBar } from '../../components/documents/BulkActionsBar'
import { BulkResultsModal } from '../../components/documents/BulkResultsModal'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { dateLabel, isoDate, STATUS_COLOURS } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { PAYMENT_STATUS_OPTIONS, paymentStatusColour, paymentStatusLabel } from '../../components/sales/paymentStatus'
import { partyLabel } from '../../components/sales/salesLines'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useBulkSelection } from '../../hooks/useBulkSelection'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'

interface Filters {
  search: string
  branchId: string | null
  clientId: string | null
  salesmanId: string | null
  status: string | null
  paymentStatus: string | null
  paymentType: string | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = { search: '', branchId: null, clientId: null, salesmanId: null, status: null, paymentStatus: null, paymentType: null, dateFrom: null, dateTo: null }
const STATUSES = ['Draft', 'Posted', 'Cancelled']
const ROUTE = '/sales/invoices'

const ACCESSOR_TO_SORT: Record<string, string> = {
  documentNumber: 'DocumentNumber',
  documentDate: 'DocumentDate',
  clientName: 'ClientName',
  status: 'Status',
  totalAmount: 'TotalAmount',
  createdAtUtc: 'CreatedAtUtc',
}

/** "$ 5,000.00 USD" — the symbol and the code, because a symbol alone is ambiguous across currencies. */
function invoiceTotal(row: SalesInvoiceListDto): string {
  return `${row.currencySymbol ? `${row.currencySymbol} ` : ''}${formatNumber(row.totalAmount, row.decimalPlaces)} ${row.currencyCode}`
}

/**
 * Every sales invoice: the same list the stock documents have — filters that apply as they are
 * typed, bulk post / delete on the ticked drafts, row actions gated by permission and status —
 * with the invoice's own columns: client, salesman, a total in the invoice currency.
 */
export function SalesInvoicesPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission } = useAuth()

  const highlight = ((location.state as { highlight?: number[] } | null)?.highlight) ?? []

  const canCreate = hasPermission(PERMISSIONS.invoicesCreate)
  const canPost = hasPermission(PERMISSIONS.invoicesPost)
  const canCancel = hasPermission(PERMISSIONS.invoicesCancel)
  const canDelete = hasPermission(PERMISSIONS.invoicesDelete)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [clients, setClients] = useState<PartyLookupDto[]>([])
  const [salesmen, setSalesmen] = useState<PartyLookupDto[]>([])

  const [cancelling, setCancelling] = useState<SalesInvoiceListDto | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)

  const selection = useBulkSelection<SalesInvoiceListDto>()
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ title: string; successLabel: string; result: BulkActionResult } | null>(null)

  const grid = useGridQuery<Filters, SalesInvoiceListDto, Awaited<ReturnType<typeof salesInvoicesApi.list>>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'documentDate', direction: 'desc' },
    errorMessage: 'The invoices could not be loaded.',
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        salesInvoicesApi.list(
          {
            search: filters.search.trim() || undefined,
            branchId: filters.branchId === null ? undefined : Number(filters.branchId),
            clientId: filters.clientId === null ? undefined : Number(filters.clientId),
            salesmanId: filters.salesmanId === null ? undefined : Number(filters.salesmanId),
            status: (filters.status as SalesInvoiceStatus | null) ?? undefined,
            paymentStatus: (filters.paymentStatus as SalesPaymentStatus | null) ?? undefined,
            paymentType: filters.paymentType === null ? undefined : (Number(filters.paymentType) as SalesPaymentType),
            dateFrom: filters.dateFrom ?? undefined,
            dateTo: filters.dateTo ?? undefined,
            sortBy: ACCESSOR_TO_SORT[sortStatus.columnAccessor as string] ?? 'DocumentDate',
            sortDir: sortStatus.direction,
            page,
            pageSize,
          },
          signal,
        ),
      [],
    ),
  })

  const { filters, setFilter, data, loading, error } = grid
  const load = grid.reload

  useEffect(() => {
    branchesApi.lookup(false).then(setBranches).catch(() => {})
    partiesApi.lookup({ partyType: 'Client', activeOnly: false }).then(setClients).catch(() => {})
    partiesApi.lookup({ partyType: 'Salesman', activeOnly: false }).then(setSalesmen).catch(() => {})
  }, [])

  const label = (row: SalesInvoiceListDto) => row.documentNumber ?? `draft #${row.id}`
  const selectable = (row: SalesInvoiceListDto) => row.status === 'Draft' && (canPost || canDelete)

  async function post(row: SalesInvoiceListDto) {
    const go = await confirm({
      title: `Post ${label(row)}`,
      message:
        row.paymentType === 1
          ? `Post this invoice? Stock will be removed from ${row.warehouseName}, the number assigned, and a receipt for the full total created and posted. The invoice will be Fully Paid.`
          : `Post this invoice? Stock will be removed from ${row.warehouseName} and the number assigned.`,
      confirmLabel: row.paymentType === 1 ? 'Post and receive' : 'Post',
    })
    if (!go) return
    try {
      await salesInvoicesApi.post(row.id, row.rowVersion)
      notify.success('Invoice posted.')
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The invoice could not be posted.')
    }
  }

  async function cancelInvoice(reason: string) {
    const row = cancelling
    if (!row) return
    setCancelBusy(true)
    try {
      await salesInvoicesApi.cancel(row.id, reason, row.rowVersion)
      notify.success('Invoice cancelled.')
      setCancelling(null)
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The invoice could not be cancelled.')
    } finally {
      setCancelBusy(false)
    }
  }

  async function remove(row: SalesInvoiceListDto) {
    const go = await confirm({ title: 'Delete draft', message: `Delete ${label(row)}? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
    if (!go) return
    try {
      await salesInvoicesApi.remove(row.id)
      notify.success('Draft deleted.')
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The draft could not be deleted.')
    }
  }

  async function bulkPost() {
    const ids = selection.ids
    const go = await confirm({
      title: `Post ${ids.length} invoice(s)`,
      message: `Post the ${ids.length} selected draft(s)? Each is posted on its own: one refusal does not stop the others. Stock is removed and the posted invoices become read-only.`,
      confirmLabel: 'Post selected',
    })
    if (!go) return
    setBulkBusy(true)
    try {
      const result = await salesInvoicesApi.bulkPost(ids)
      setBulkResult({ title: 'Post selected', successLabel: 'Posted', result })
      selection.removeIds(result.results.filter((r) => r.ok).map((r) => r.id))
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The invoices could not be posted.')
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkDelete() {
    const ids = selection.ids
    const go = await confirm({ title: `Delete ${ids.length} draft(s)`, message: `Delete the ${ids.length} selected draft(s)? This cannot be undone.`, confirmLabel: 'Delete selected', danger: true })
    if (!go) return
    setBulkBusy(true)
    try {
      const result = await salesInvoicesApi.bulkDelete(ids)
      setBulkResult({ title: 'Delete selected', successLabel: 'Deleted', result })
      selection.removeIds(result.results.filter((r) => r.ok).map((r) => r.id))
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The drafts could not be deleted.')
    } finally {
      setBulkBusy(false)
    }
  }

  const columns: DataTableColumn<SalesInvoiceListDto>[] = [
    rowNumberColumn<SalesInvoiceListDto>(grid.page, grid.pageSize),
    {
      accessor: 'documentNumber',
      title: 'Invoice No.',
      sortable: true,
      width: 190,
      render: (row) =>
        row.documentNumber ? (
          <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{row.documentNumber}</Text>
        ) : (
          <Badge color="gray" variant="light">DRAFT</Badge>
        ),
    },
    { accessor: 'documentDate', title: 'Date', sortable: true, width: 110, render: (row) => dateLabel(row.documentDate) },
    {
      accessor: 'clientName',
      title: 'Client',
      sortable: true,
      render: (row) => (
        <div>
          <Text fz="sm" fw={500}>{row.clientName}</Text>
          <Text fz="xs" c="dimmed">{row.clientCode}</Text>
        </div>
      ),
    },
    { accessor: 'salesmanName', title: 'Salesman', render: (row) => row.salesmanName ?? '—' },
    { accessor: 'branchName', title: 'Branch' },
    { accessor: 'warehouseName', title: 'Warehouse' },
    { accessor: 'totalItems', title: 'Items', width: 70, textAlign: 'right', render: (row) => formatNumber(row.totalItems) },
    { accessor: 'totalAmount', title: 'Total', sortable: true, width: 170, textAlign: 'right', render: (row) => <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{invoiceTotal(row)}</Text> },
    {
      accessor: 'paymentTypeName',
      title: 'Payment Type',
      width: 120,
      render: (row) => (row.paymentTypeName ? <Badge color={row.paymentType === 1 ? 'teal' : 'blue'} variant="light">{row.paymentTypeName}</Badge> : <Text fz="xs" c="dimmed">Not chosen</Text>),
    },
    {
      accessor: 'outstandingAmount',
      title: 'Outstanding',
      width: 160,
      textAlign: 'right',
      // Only a posted invoice owes anything; a draft or cancelled one shows a dash, not a misleading zero.
      render: (row) =>
        row.outstandingAmount === null ? (
          '—'
        ) : (
          <Text fz="sm" fw={row.outstandingAmount > 0 ? 500 : undefined} c={row.outstandingAmount > 0 ? undefined : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>
            {formatNumber(row.outstandingAmount, row.decimalPlaces)} {row.currencyCode}
          </Text>
        ),
    },
    {
      accessor: 'paymentStatus',
      title: 'Payment',
      width: 110,
      render: (row) => (row.paymentStatus ? <Badge color={paymentStatusColour(row.paymentStatus)} variant="light">{paymentStatusLabel(row.paymentStatus)}</Badge> : '—'),
    },
    {
      accessor: 'receiptNumber',
      title: 'Receipt No.',
      width: 150,
      render: (row) =>
        row.receiptId !== null ? (
          <Anchor component={Link} to={`/sales/receipts/${row.receiptId}`} fz="sm" onClick={(event) => event.stopPropagation()}>{row.receiptNumber}</Anchor>
        ) : (
          '—'
        ),
    },
    {
      accessor: 'status',
      title: 'Status',
      sortable: true,
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
            { icon: <IconFilterOff size={16} />, tooltip: 'Cancel invoice', color: 'orange', visible: canCancel && row.status === 'Posted', onClick: () => setCancelling(row) },
          ]}
          remove={{ visible: canDelete && row.status === 'Draft', onClick: () => void remove(row) }}
        />
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Sales Invoices"
        actions={
          canCreate ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => void navigate(`${ROUTE}/new`)}>
              New Invoice
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <FilterBar.Col span={2}>
          <TextInput label="Search" placeholder="Number, reference or client" leftSection={<IconSearch size={16} />} value={filters.search} onChange={(event) => setFilter('search', event.currentTarget.value)} />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Branch" placeholder="All branches" data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))} value={filters.branchId} onChange={(next) => setFilter('branchId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Client" placeholder="All clients" data={clients.map((c) => ({ value: String(c.id), label: partyLabel(c) }))} value={filters.clientId} onChange={(next) => setFilter('clientId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={1}>
          <Select label="Salesman" placeholder="All" data={salesmen.map((s) => ({ value: String(s.id), label: partyLabel(s) }))} value={filters.salesmanId} onChange={(next) => setFilter('salesmanId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={1}>
          <Select label="Status" placeholder="All" data={STATUSES} value={filters.status} onChange={(next) => setFilter('status', next)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={1}>
          <Select label="Pay type" placeholder="All" data={SALES_PAYMENT_TYPES.map((t) => ({ value: String(t.value), label: t.label }))} value={filters.paymentType} onChange={(next) => setFilter('paymentType', next)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={1}>
          <Select label="Payment" placeholder="All" data={PAYMENT_STATUS_OPTIONS} value={filters.paymentStatus} onChange={(next) => setFilter('paymentStatus', next)} clearable />
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

      <BulkActionsBar count={selection.ids.length} canPost={canPost} canDelete={canDelete} busy={bulkBusy} onPost={() => void bulkPost()} onDelete={() => void bulkDelete()} onClear={selection.clear} />

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="sales.salesInvoices"
          records={data?.items ?? []}
          /* This grid pages on the SERVER, so the footer can only add up the rows it was
             sent. Each figure says so under itself, rather than passing a total of ten
             off as a total of five hundred. */
          summaryRecords={data?.items ?? []}
          summaryScope="page"
          columns={columns}
          selectedRecords={selection.selected}
          onSelectedRecordsChange={selection.setSelected}
          isRecordSelectable={selectable}
          rowClassName={(row) => (highlight.includes(row.id) ? 'app-grid__row--highlight' : undefined)}
          totalRecords={data?.totalCount ?? 0}
          page={grid.page}
          recordsPerPage={grid.pageSize}
          onPageChange={grid.setPage}
          onRecordsPerPageChange={grid.setPageSize}
          sortStatus={grid.sortStatus}
          onSortStatusChange={grid.setSortStatus}
          fetching={loading}
          noRecordsText="No invoices yet."
          onRowClick={({ record }) => void navigate(`${ROUTE}/${record.id}`)}
        />
      </Paper>

      <BulkResultsModal opened={bulkResult !== null} title={bulkResult?.title ?? ''} successLabel={bulkResult?.successLabel ?? ''} result={bulkResult?.result ?? null} labelOf={(item) => `draft #${item.id}`} onClose={() => setBulkResult(null)} />

      <CancelReasonModal
        opened={cancelling !== null}
        onClose={() => setCancelling(null)}
        documentLabel={cancelling ? label(cancelling) : ''}
        busy={cancelBusy}
        onConfirm={(reason) => void cancelInvoice(reason)}
        description={
          cancelling?.receiptNumber
            ? `Cancelling writes the opposite stock movements AND reverses this cash sale's receipt ${cancelling.receiptNumber}, with the same reason. The invoice and the receipt stay in place as a record. It cannot be undone.`
            : undefined
        }
      />
    </div>
  )
}
