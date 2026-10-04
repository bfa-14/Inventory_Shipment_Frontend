import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Alert, Badge, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconArrowBackUp, IconEye, IconPlus, IconSearch, IconSend } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import { partiesApi } from '../../api/masterdata/parties'
import { paymentsApi, SUPPLIER_PAYMENT_TYPES, type PaymentListDto, type SupplierPaymentStatus } from '../../api/purchase/payments'
import type { BranchLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { dateLabel, isoDate, STATUS_COLOURS } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { PAYMENTS_ROUTE } from '../../components/purchase/payment/paymentModel'
import { partyLabel } from '../../components/sales/salesLines'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'

interface Filters {
  search: string
  branchId: string | null
  payeeId: string | null
  status: string | null
  paymentType: string | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = { search: '', branchId: null, payeeId: null, status: null, paymentType: null, dateFrom: null, dateTo: null }
const STATUSES: SupplierPaymentStatus[] = ['Draft', 'Posted', 'Reversed']
const statusColour = (status: string) => (status === 'Reversed' ? 'orange' : (STATUS_COLOURS[status] ?? 'gray'))

/**
 * What each column IS, for the grid engine. A payment's own amount is in its own currency, so the footer
 * sums the base-currency column; the document-currency one carries no total.
 */
const GRID_COLUMNS: GridColumnMeta<PaymentListDto>[] = [
  { accessor: 'paymentNumber', summary: 'count', text: (r) => r.paymentNumber ?? 'DRAFT' },
  { accessor: 'paymentDate', kind: 'date' },
  { accessor: 'payeeName' },
  { accessor: 'paymentTypeName', kind: 'list' },
  { accessor: 'methods', kind: 'list', text: (r) => r.methods ?? '' },
  { accessor: 'branchName', kind: 'list' },
  { accessor: 'reference', text: (r) => r.reference ?? '' },
  { accessor: 'amount', kind: 'number', text: (r) => `${formatNumber(r.amount, r.decimalPlaces)} ${r.currencyCode}` },
  { accessor: 'amountBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.amountBase, 2) },
  { accessor: 'unappliedAmount', kind: 'number', text: (r) => (r.unappliedAmount > 0 ? `${formatNumber(r.unappliedAmount, r.decimalPlaces)} ${r.currencyCode}` : '') },
  { accessor: 'status', kind: 'list' },
]

/**
 * Every supplier payment: the filters above narrow what is loaded, the grid does the rest. Row actions
 * follow the permission and the status - a posted payment is never deleted, it is reversed with a reason.
 */
export function PaymentsPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  const canCreate = hasPermission(PERMISSIONS.paymentsCreate)
  const canPost = hasPermission(PERMISSIONS.paymentsPost)
  const canReverse = hasPermission(PERMISSIONS.paymentsReverse)
  const canDelete = hasPermission(PERMISSIONS.paymentsDelete)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [payees, setPayees] = useState<PartyLookupDto[]>([])
  const [reversing, setReversing] = useState<PaymentListDto | null>(null)
  const [reverseBusy, setReverseBusy] = useState(false)

  const grid = useGridQuery<Filters, PaymentListDto, AllRows<PaymentListDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'paymentDate', direction: 'desc' },
    // The list is loaded whole (newest first, up to the grid's cap) and the grid does the rest.
    paging: 'client',
    errorMessage: 'The payments could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          paymentsApi.list(
            {
              search: filters.search.trim() || undefined,
              branchId: filters.branchId === null ? undefined : Number(filters.branchId),
              payeeId: filters.payeeId === null ? undefined : Number(filters.payeeId),
              status: (filters.status as SupplierPaymentStatus | null) ?? undefined,
              paymentType: filters.paymentType === null ? undefined : (Number(filters.paymentType) as 1 | 2 | 3),
              dateFrom: filters.dateFrom ?? undefined,
              dateTo: filters.dateTo ?? undefined,
              sortBy: 'PaymentDate',
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

  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'purchase.payments',
    sort: [{ accessor: 'paymentDate', direction: 'desc' }],
  })

  useEffect(() => {
    branchesApi.lookup(false).then(setBranches).catch(() => {})
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setPayees).catch(() => {})
  }, [])

  const label = (row: PaymentListDto) => row.paymentNumber ?? `draft #${row.id}`

  async function post(row: PaymentListDto) {
    const go = await confirm({
      title: `Post ${label(row)}`,
      message: 'Post this payment? Its payment details (and allocations) must equal its amount. Once posted it can no longer be edited or deleted, only reversed.',
      confirmLabel: 'Post',
    })
    if (!go) return
    try {
      await paymentsApi.post(row.id, row.rowVersion)
      notify.success('Payment posted.')
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The payment could not be posted.')
    }
  }

  async function reverse(reason: string) {
    const row = reversing
    if (!row) return
    setReverseBusy(true)
    try {
      await paymentsApi.reverse(row.id, reason, row.rowVersion)
      notify.success('Payment reversed.')
      setReversing(null)
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The payment could not be reversed.')
    } finally {
      setReverseBusy(false)
    }
  }

  async function remove(row: PaymentListDto) {
    const go = await confirm({ title: 'Delete draft', message: `Delete ${label(row)}? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
    if (!go) return
    try {
      await paymentsApi.remove(row.id)
      notify.success('Draft deleted.')
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The draft could not be deleted.')
    }
  }

  const columns: DataTableColumn<PaymentListDto>[] = [
    rowNumberColumn<PaymentListDto>(engine.page, engine.pageSize),
    {
      accessor: 'paymentNumber',
      title: 'Payment No.',
      width: 150,
      render: (row) =>
        row.paymentNumber ? <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{row.paymentNumber}</Text> : <Badge color="gray" variant="light">DRAFT</Badge>,
    },
    { accessor: 'paymentDate', title: 'Date', width: 110, render: (row) => dateLabel(row.paymentDate) },
    {
      accessor: 'payeeName',
      title: 'Payee / Supplier',
      render: (row) => (
        <div>
          <Text fz="sm" fw={500}>{row.payeeName}</Text>
          <Text fz="xs" c="dimmed">{row.payeeCode}</Text>
        </div>
      ),
    },
    { accessor: 'paymentTypeName', title: 'Payment Type', width: 190 },
    { accessor: 'methods', title: 'Methods', width: 170, render: (row) => row.methods ?? '—' },
    { accessor: 'branchName', title: 'Branch' },
    { accessor: 'reference', title: 'Reference', width: 130, render: (row) => row.reference ?? '—' },
    {
      accessor: 'amount',
      title: 'Amount',
      width: 170,
      textAlign: 'right',
      render: (row) => <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{formatNumber(row.amount, row.decimalPlaces)} {row.currencyCode}</Text>,
    },
    { accessor: 'amountBase', title: 'Amount (USD)', width: 140, textAlign: 'right', render: (row) => formatNumber(row.amountBase, 2) },
    {
      accessor: 'unappliedAmount',
      title: 'Unapplied advance',
      width: 160,
      textAlign: 'right',
      // Only a posted Free Payment has an advance still to use; everywhere else a figure would mislead.
      render: (row) =>
        row.status === 'Posted' && row.unappliedAmount > 0 ? (
          <Text fz="sm" c="orange" fw={500}>{formatNumber(row.unappliedAmount, row.decimalPlaces)} {row.currencyCode}</Text>
        ) : (
          '—'
        ),
    },
    {
      accessor: 'status',
      title: 'Status',
      width: 110,
      render: (row) => <Badge color={statusColour(row.status)} variant="light">{row.status}</Badge>,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 170,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={label(row)}
          edit={{ visible: canCreate && row.status === 'Draft', onClick: () => void navigate(`${PAYMENTS_ROUTE}/${row.id}`) }}
          custom={[
            { icon: <IconEye size={16} />, tooltip: 'View', onClick: () => void navigate(`${PAYMENTS_ROUTE}/${row.id}`) },
            { icon: <IconSend size={16} />, tooltip: 'Post', visible: canPost && row.status === 'Draft', onClick: () => void post(row) },
            { icon: <IconArrowBackUp size={16} />, tooltip: 'Reverse payment', color: 'orange', visible: canReverse && row.status === 'Posted', onClick: () => setReversing(row) },
          ]}
          remove={{ visible: canDelete && row.status === 'Draft', onClick: () => void remove(row) }}
        />
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Supplier Payments"
        subtitle="Payments to suppliers and service providers: free advances, purchase invoice payments and container charge payments."
        actions={
          canCreate ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => void navigate(`${PAYMENTS_ROUTE}/new`)}>
              New Payment
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput label="Search" placeholder="Number, reference or payee" leftSection={<IconSearch size={16} />} value={filters.search} onChange={(event) => setFilter('search', event.currentTarget.value)} />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Branch" placeholder="All branches" data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))} value={filters.branchId} onChange={(next) => setFilter('branchId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Payee" placeholder="All payees" data={payees.map((p) => ({ value: String(p.id), label: partyLabel(p) }))} value={filters.payeeId} onChange={(next) => setFilter('payeeId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Payment type" placeholder="All" data={SUPPLIER_PAYMENT_TYPES.map((t) => ({ value: String(t.value), label: t.label }))} value={filters.paymentType} onChange={(next) => setFilter('paymentType', next)} clearable />
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
          There are more payments than the grid loads at once. Narrow the list with the filters above (dates, status, payee) to see the rest.
        </Alert>
      ) : null}

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="purchase.payments"
          engine={engine}
          exportFileName="supplier-payments"
          columns={columns}
          fetching={loading}
          noRecordsText="No supplier payments yet."
          onRowClick={({ record }) => void navigate(`${PAYMENTS_ROUTE}/${record.id}`)}
        />
      </Paper>

      <CancelReasonModal
        opened={reversing !== null}
        onClose={() => setReversing(null)}
        documentLabel={reversing ? label(reversing) : ''}
        busy={reverseBusy}
        title={reversing ? `Reverse ${label(reversing)}` : undefined}
        placeholder="Why is this being reversed?"
        confirmLabel="Reverse payment"
        description="Reversing undoes the payment: the invoices or charges it paid owe the money again. The payment stays in place as a record. It cannot be undone."
        onConfirm={(reason) => void reverse(reason)}
      />
    </div>
  )
}
