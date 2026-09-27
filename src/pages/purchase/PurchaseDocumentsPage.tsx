import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Alert, Anchor, Badge, Button, Group, Paper, Progress, Select, Text, TextInput, Tooltip } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconArrowBackUp, IconEye, IconFileInvoice, IconFilterOff, IconPlus, IconSearch, IconSend } from '@tabler/icons-react'
import type { BulkActionResult } from '../../api/documents'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import { partiesApi } from '../../api/masterdata/parties'
import { purchaseDocumentsApi, type PurchaseDocumentListDto, type PurchaseDocumentStatus } from '../../api/purchase/documents'
import type { BranchLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { BulkActionsBar } from '../../components/documents/BulkActionsBar'
import { BulkResultsModal } from '../../components/documents/BulkResultsModal'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { dateLabel, isoDate } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import {
  PURCHASE_INVOICE,
  PURCHASE_ORDER,
  PURCHASE_RETURN,
  PURCHASE_STATUS_COLOURS,
  PURCHASE_STATUSES,
  supplierLabel,
  type PurchaseKind,
} from '../../components/purchase/purchaseKind'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useBulkSelection } from '../../hooks/useBulkSelection'
import { useGridQuery } from '../../hooks/useGridQuery'

interface Filters {
  search: string
  branchId: string | null
  supplierId: string | null
  status: string | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = { search: '', branchId: null, supplierId: null, status: null, dateFrom: null, dateTo: null }

const ACCESSOR_TO_SORT: Record<string, string> = {
  documentNumber: 'DocumentNumber',
  documentDate: 'DocumentDate',
  supplierName: 'SupplierName',
  status: 'Status',
  totalAmount: 'TotalAmount',
  createdAtUtc: 'CreatedAtUtc',
}

/** "FC 750,000.00 CDF" — the symbol and the code, because a symbol alone is ambiguous across currencies. */
function documentTotal(row: PurchaseDocumentListDto): string {
  return `${row.currencySymbol ? `${row.currencySymbol} ` : ''}${formatNumber(row.totalAmount, row.decimalPlaces)} ${row.currencyCode}`
}

/** What the kind was made from: an invoice comes from an order, a return from an invoice, an order from nothing. */
function sourceKindOf(kind: PurchaseKind): PurchaseKind | null {
  if (kind.code === 'PINV') return PURCHASE_ORDER
  if (kind.code === 'PRET') return PURCHASE_INVOICE
  return null
}

/**
 * Every document of one purchase kind: the same list the sales invoices have — filters that apply
 * as they are typed, bulk post / delete on the ticked drafts, row actions gated by permission and
 * status — with the purchase family's own columns: the supplier, the source document, a total in
 * the document currency and, on orders, how much has been received.
 */
export function PurchaseDocumentsPage({ kind }: { kind: PurchaseKind }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission } = useAuth()

  const highlight = ((location.state as { highlight?: number[] } | null)?.highlight) ?? []

  const canCreate = hasPermission(kind.permissions.create)
  const canPost = hasPermission(kind.permissions.post)
  const canCancel = hasPermission(kind.permissions.cancel)
  const canDelete = hasPermission(kind.permissions.delete)
  const canCreateInvoice = kind.code === 'PO' && hasPermission(PURCHASE_INVOICE.permissions.create)
  const canCreateReturn = kind.code === 'PINV' && hasPermission(PURCHASE_RETURN.permissions.create)
  const sourceKind = sourceKindOf(kind)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])

  const [cancelling, setCancelling] = useState<PurchaseDocumentListDto | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)

  const selection = useBulkSelection<PurchaseDocumentListDto>()
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ title: string; successLabel: string; result: BulkActionResult } | null>(null)

  const grid = useGridQuery<Filters, PurchaseDocumentListDto, Awaited<ReturnType<typeof purchaseDocumentsApi.list>>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'documentDate', direction: 'desc' },
    errorMessage: `The ${kind.plural.toLowerCase()} could not be loaded.`,
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        purchaseDocumentsApi.list(
          {
            documentTypeCode: kind.code,
            search: filters.search.trim() || undefined,
            branchId: filters.branchId === null ? undefined : Number(filters.branchId),
            supplierId: filters.supplierId === null ? undefined : Number(filters.supplierId),
            status: (filters.status as PurchaseDocumentStatus | null) ?? undefined,
            dateFrom: filters.dateFrom ?? undefined,
            dateTo: filters.dateTo ?? undefined,
            sortBy: ACCESSOR_TO_SORT[sortStatus.columnAccessor as string] ?? 'DocumentDate',
            sortDir: sortStatus.direction,
            page,
            pageSize,
          },
          signal,
        ),
      [kind.code],
    ),
  })

  const { filters, setFilter, data, loading, error } = grid
  const load = grid.reload

  useEffect(() => {
    branchesApi.lookup(false).then(setBranches).catch(() => {})
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setSuppliers).catch(() => {})
  }, [])

  const label = (row: PurchaseDocumentListDto) => row.documentNumber ?? `draft #${row.id}`
  const selectable = (row: PurchaseDocumentListDto) => row.status === 'Draft' && (canPost || canDelete)

  async function post(row: PurchaseDocumentListDto) {
    const go = await confirm({
      title: `${kind.postVerb} ${label(row)}`,
      message: kind.postConfirm(row.warehouseName),
      confirmLabel: kind.postVerb,
    })
    if (!go) return
    try {
      await purchaseDocumentsApi.post(row.id, row.rowVersion)
      notify.success(`${kind.title} ${kind.postVerb.toLowerCase()}ed.`.replace('Confirmed', 'confirmed').replace('confirmed.', 'confirmed.'))
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : `The ${kind.noun} could not be ${kind.postVerb.toLowerCase()}ed.`)
    }
  }

  async function cancelDocument(reason: string) {
    const row = cancelling
    if (!row) return
    setCancelBusy(true)
    try {
      await purchaseDocumentsApi.cancel(row.id, reason, row.rowVersion)
      notify.success(`${kind.title} cancelled.`)
      setCancelling(null)
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : `The ${kind.noun} could not be cancelled.`)
    } finally {
      setCancelBusy(false)
    }
  }

  async function remove(row: PurchaseDocumentListDto) {
    const go = await confirm({ title: 'Delete draft', message: `Delete ${label(row)}? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
    if (!go) return
    try {
      await purchaseDocumentsApi.remove(row.id)
      notify.success('Draft deleted.')
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The draft could not be deleted.')
    }
  }

  async function createFrom(row: PurchaseDocumentListDto) {
    const target = kind.code === 'PO' ? PURCHASE_INVOICE : PURCHASE_RETURN
    const go = await confirm({
      title: `Create ${target.title.toLowerCase()}`,
      message: kind.code === 'PO'
        ? `Create a purchase invoice draft from ${label(row)} with everything that remains to receive?`
        : `Create a purchase return draft from ${label(row)} with everything that can still be returned?`,
      confirmLabel: 'Create',
    })
    if (!go) return
    try {
      const created = kind.code === 'PO' ? await purchaseDocumentsApi.createInvoice(row.id) : await purchaseDocumentsApi.createReturn(row.id)
      notify.success(`${target.title} draft created.`)
      void navigate(`${target.route}/${created.id}`)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : `The ${target.noun} could not be created.`)
    }
  }

  async function bulkPost() {
    const ids = selection.ids
    const go = await confirm({
      title: `${kind.postVerb} ${ids.length} ${kind.noun}(s)`,
      message: `${kind.postVerb} the ${ids.length} selected draft(s)? Each is handled on its own: one refusal does not stop the others.`,
      confirmLabel: `${kind.postVerb} selected`,
    })
    if (!go) return
    setBulkBusy(true)
    try {
      const result = await purchaseDocumentsApi.bulkPost(ids)
      setBulkResult({ title: `${kind.postVerb} selected`, successLabel: kind.code === 'PO' ? 'Confirmed' : 'Posted', result })
      selection.removeIds(result.results.filter((r) => r.ok).map((r) => r.id))
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : `The ${kind.plural.toLowerCase()} could not be posted.`)
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
      const result = await purchaseDocumentsApi.bulkDelete(ids)
      setBulkResult({ title: 'Delete selected', successLabel: 'Deleted', result })
      selection.removeIds(result.results.filter((r) => r.ok).map((r) => r.id))
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The drafts could not be deleted.')
    } finally {
      setBulkBusy(false)
    }
  }

  const columns: DataTableColumn<PurchaseDocumentListDto>[] = [
    rowNumberColumn<PurchaseDocumentListDto>(grid.page, grid.pageSize),
    {
      accessor: 'documentNumber',
      title: `${kind.title} No.`,
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
      accessor: 'supplierName',
      title: 'Supplier',
      sortable: true,
      render: (row) => (
        <div>
          <Text fz="sm" fw={500}>{row.supplierName}</Text>
          <Text fz="xs" c="dimmed">{row.supplierCode}</Text>
        </div>
      ),
    },
    ...(kind.code === 'PINV'
      ? [
          {
            accessor: 'exporterReference',
            title: 'Exporter Ref.',
            width: 150,
            // Hidden on a phone: a reference nobody scans on a narrow screen costs the supplier its width.
            visibleMediaQuery: (theme) => `(min-width: ${theme.breakpoints.sm})`,
            render: (row) => row.exporterReference ?? <Text fz="sm" c="dimmed">—</Text>,
          } as DataTableColumn<PurchaseDocumentListDto>,
        ]
      : []),
    { accessor: 'branchName', title: 'Branch' },
    { accessor: 'warehouseName', title: 'Warehouse' },
    ...(sourceKind
      ? [
          {
            accessor: 'sourceDocumentNumber',
            title: 'Source',
            width: 170,
            render: (row) =>
              row.sourceDocumentId === null ? (
                <Text fz="sm" c="dimmed">—</Text>
              ) : (
                <Anchor component={Link} to={`${sourceKind.route}/${row.sourceDocumentId}`} fz="sm" onClick={(event) => event.stopPropagation()}>
                  {row.sourceDocumentNumber ?? `draft #${row.sourceDocumentId}`}
                </Anchor>
              ),
          } as DataTableColumn<PurchaseDocumentListDto>,
        ]
      : []),
    { accessor: 'totalItems', title: 'Items', width: 70, textAlign: 'right', render: (row) => formatNumber(row.totalItems) },
    { accessor: 'totalAmount', title: 'Total', sortable: true, width: 170, textAlign: 'right', render: (row) => <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{documentTotal(row)}</Text> },
    ...(kind.code === 'PO'
      ? [
          {
            accessor: 'receivedPercent',
            title: 'Received',
            width: 130,
            render: (row) =>
              row.receivedPercent === null || row.status === 'Draft' ? (
                <Text fz="sm" c="dimmed">—</Text>
              ) : (
                <Tooltip label={`${formatNumber(row.receivedPercent, 1)}% of the ordered quantity invoiced`} withArrow>
                  <Group gap={6} wrap="nowrap">
                    <Progress value={row.receivedPercent} size="sm" w={70} color={row.receivedPercent >= 100 ? 'teal' : 'blue'} aria-label="Received" />
                    <Text fz="xs" style={{ whiteSpace: 'nowrap' }}>{formatNumber(row.receivedPercent, 0)}%</Text>
                  </Group>
                </Tooltip>
              ),
          } as DataTableColumn<PurchaseDocumentListDto>,
        ]
      : []),
    {
      accessor: 'status',
      title: 'Status',
      sortable: true,
      width: 110,
      render: (row) => <Badge color={PURCHASE_STATUS_COLOURS[row.status] ?? 'gray'} variant="light">{row.status}</Badge>,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 200,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={label(row)}
          edit={{ visible: canCreate && row.status === 'Draft', onClick: () => void navigate(`${kind.route}/${row.id}`) }}
          custom={[
            { icon: <IconEye size={16} />, tooltip: 'View', onClick: () => void navigate(`${kind.route}/${row.id}`) },
            { icon: <IconSend size={16} />, tooltip: kind.postVerb, visible: canPost && row.status === 'Draft', onClick: () => void post(row) },
            { icon: <IconFileInvoice size={16} />, tooltip: 'Create invoice', color: 'green', visible: canCreateInvoice && row.status === 'Posted', onClick: () => void createFrom(row) },
            { icon: <IconArrowBackUp size={16} />, tooltip: 'Create return', color: 'orange', visible: canCreateReturn && row.status === 'Posted', onClick: () => void createFrom(row) },
            { icon: <IconFilterOff size={16} />, tooltip: `Cancel ${kind.noun}`, color: 'red', visible: canCancel && (row.status === 'Posted' || row.status === 'Closed'), onClick: () => setCancelling(row) },
          ]}
          remove={{ visible: canDelete && row.status === 'Draft', onClick: () => void remove(row) }}
        />
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title={kind.plural}
        actions={
          canCreate ? (
            <Button leftSection={<IconPlus size={16} />} color={kind.colour} onClick={() => void navigate(`${kind.route}/new`)}>
              New {kind.title}
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput label="Search" placeholder={kind.code === 'PINV' ? 'Number, supplier, exporter ref., commercial invoice no.' : 'Number, supplier reference or supplier'} leftSection={<IconSearch size={16} />} value={filters.search} onChange={(event) => setFilter('search', event.currentTarget.value)} />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Branch" placeholder="All branches" data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))} value={filters.branchId} onChange={(next) => setFilter('branchId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select label="Supplier" placeholder="All suppliers" data={suppliers.map((s) => ({ value: String(s.id), label: supplierLabel(s) }))} value={filters.supplierId} onChange={(next) => setFilter('supplierId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Status" placeholder="All" data={[...PURCHASE_STATUSES]} value={filters.status} onChange={(next) => setFilter('status', next)} clearable />
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
          storeKey="purchase.purchaseDocuments"
          records={data?.items ?? []}
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
          noRecordsText={`No ${kind.plural.toLowerCase()} yet.`}
          onRowClick={({ record }) => void navigate(`${kind.route}/${record.id}`)}
        />
      </Paper>

      <BulkResultsModal opened={bulkResult !== null} title={bulkResult?.title ?? ''} successLabel={bulkResult?.successLabel ?? ''} result={bulkResult?.result ?? null} labelOf={(item) => `draft #${item.id}`} onClose={() => setBulkResult(null)} />

      <CancelReasonModal opened={cancelling !== null} onClose={() => setCancelling(null)} documentLabel={cancelling ? label(cancelling) : ''} busy={cancelBusy} onConfirm={(reason) => void cancelDocument(reason)} />
    </div>
  )
}
