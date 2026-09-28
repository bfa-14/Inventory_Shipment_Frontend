import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Alert, Badge, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconEye, IconFilterOff, IconPlus, IconSearch, IconSend } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  stockDocumentsApi,
  type StockDocumentListDto,
  type StockDocumentStatus,
} from '../../api/inventory/stockDocuments'
import { branchesApi } from '../../api/masterdata/branches'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BranchLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { formatNumber } from '../../components/format'
import {
  dateLabel,
  isoDate,
  money,
  STATUS_COLOURS,
  type DocumentKind,
} from '../../components/documents/documentKind'
import type { BulkActionResult } from '../../api/documents'
import { BulkActionsBar } from '../../components/documents/BulkActionsBar'
import { BulkResultsModal } from '../../components/documents/BulkResultsModal'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
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
  warehouseId: string | null
  status: string | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = {
  search: '',
  branchId: null,
  warehouseId: null,
  status: null,
  dateFrom: null,
  dateTo: null,
}

const STATUSES = ['Draft', 'Posted', 'Cancelled']

const ACCESSOR_TO_SORT: Record<string, string> = {
  documentNumber: 'DocumentNumber',
  documentDate: 'DocumentDate',
  branchName: 'BranchName',
  warehouseName: 'WarehouseName',
  status: 'Status',
  totalCost: 'TotalCost',
  createdAtUtc: 'CreatedAtUtc',
}

/**
 * Every document of one kind — Inventory In or Inventory Out, decided by the `kind` prop.
 *
 * ONE COMPONENT FOR BOTH, because they are the same list with a different filter and a different
 * set of permissions. Two copies would drift the first time a column was added to one of them.
 */
export function StockDocumentsPage({ kind }: { kind: DocumentKind }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { hasPermission } = useAuth()

  /** Ids the import wizard just created; their rows are tinted so the reader finds them. */
  const highlight = ((location.state as { highlight?: number[] } | null)?.highlight) ?? []

  const canCreate = hasPermission(kind.permissions.create)
  const canPost = hasPermission(kind.permissions.post)
  const canCancel = hasPermission(kind.permissions.cancel)
  const canDelete = hasPermission(kind.permissions.delete)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])

  /** The row whose cancellation is being asked about, or null when the dialog is closed. */
  const [cancelling, setCancelling] = useState<StockDocumentListDto | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)

  /* BULK ACTIONS: the ticked drafts, kept across pages, acted on one by one on the server. */
  const selection = useBulkSelection<StockDocumentListDto>()
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ title: string; successLabel: string; result: BulkActionResult } | null>(null)

  const grid = useGridQuery<Filters, StockDocumentListDto, Awaited<ReturnType<typeof stockDocumentsApi.search>>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'documentDate', direction: 'desc' },
    errorMessage: `The ${kind.title} documents could not be loaded.`,
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        stockDocumentsApi.search(
          {
            documentTypeCode: kind.code,
            search: filters.search.trim() || undefined,
            branchId: filters.branchId === null ? undefined : Number(filters.branchId),
            warehouseId: filters.warehouseId === null ? undefined : Number(filters.warehouseId),
            status: (filters.status as StockDocumentStatus | null) ?? undefined,
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
    branchesApi.lookup(false).then(setBranches).catch(() => {
      // Not fatal: the filter simply offers no branches until the next reload.
    })
  }, [])

  /* The warehouse filter belongs to the branch above it. Emptying the list and the choice happens
     in the branch handler — those are consequences of an event — so this effect only fetches. */
  useEffect(() => {
    if (filters.branchId === null) return

    let cancelled = false
    warehousesApi
      .lookup(false, Number(filters.branchId))
      .then((rows) => {
        if (!cancelled) setWarehouses(rows)
      })
      .catch(() => {
        /* leaves the warehouse filter empty */
      })

    return () => {
      cancelled = true
    }
  }, [filters.branchId])

  function chooseBranch(next: string | null) {
    setFilter('branchId', next)
    setFilter('warehouseId', null)
    setWarehouses([])
  }

  const documentLabel = (row: StockDocumentListDto) =>
    row.documentNumber ?? `draft #${row.id}`

  /** Only a draft can be posted or deleted, and only by a reader who may do one of the two. */
  const selectable = (row: StockDocumentListDto) => row.status === 'Draft' && (canPost || canDelete)

  async function bulkPost() {
    const ids = selection.ids
    const go = await confirm({
      title: `Post ${ids.length} document(s)`,
      message: `Post the ${ids.length} selected draft(s)? Each is posted on its own: one refusal does not stop the others. Stock will be updated and the posted documents become read-only.`,
      confirmLabel: 'Post selected',
    })
    if (!go) return

    setBulkBusy(true)
    try {
      const result = await stockDocumentsApi.bulkPost(ids)
      setBulkResult({ title: 'Post selected', successLabel: 'Posted', result })
      selection.removeIds(result.results.filter((r) => r.ok).map((r) => r.id))
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The documents could not be posted.')
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkDelete() {
    const ids = selection.ids
    const go = await confirm({
      title: `Delete ${ids.length} draft(s)`,
      message: `Delete the ${ids.length} selected draft(s)? This cannot be undone.`,
      confirmLabel: 'Delete selected',
      danger: true,
    })
    if (!go) return

    setBulkBusy(true)
    try {
      const result = await stockDocumentsApi.bulkDelete(ids)
      setBulkResult({ title: 'Delete selected', successLabel: 'Deleted', result })
      selection.removeIds(result.results.filter((r) => r.ok).map((r) => r.id))
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The drafts could not be deleted.')
    } finally {
      setBulkBusy(false)
    }
  }

  async function post(row: StockDocumentListDto) {
    const go = await confirm({
      title: `Post ${documentLabel(row)}`,
      message: `Post ${documentLabel(row)}? Stock will be updated and the document becomes read-only.`,
      confirmLabel: 'Post',
    })
    if (!go) return

    try {
      await stockDocumentsApi.post(row.id, row.rowVersion)
      notify.success('Document posted.')
      await load()
    } catch (err) {
      // INSUFFICIENT_STOCK, NO_LINES, NOT_DRAFT: all arrive with the procedure's own sentence, which
      // names the item and the figures. Nothing here could say it better.
      notify.error(err instanceof ApiError ? err.message : 'The document could not be posted.')
    }
  }

  async function cancelDocument(reason: string) {
    const row = cancelling
    if (!row) return

    setCancelBusy(true)
    try {
      await stockDocumentsApi.cancel(row.id, reason, row.rowVersion)
      notify.success('Document cancelled.')
      setCancelling(null)
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The document could not be cancelled.')
    } finally {
      setCancelBusy(false)
    }
  }

  async function remove(row: StockDocumentListDto) {
    const go = await confirm({
      title: 'Delete draft',
      message: `Delete ${documentLabel(row)}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return

    try {
      await stockDocumentsApi.remove(row.id)
      notify.success('Draft deleted.')
      await load()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The draft could not be deleted.')
    }
  }

  const columns: DataTableColumn<StockDocumentListDto>[] = [
    rowNumberColumn<StockDocumentListDto>(grid.page, grid.pageSize),
    {
      accessor: 'documentNumber',
      title: 'Document No.',
      sortable: true,
      // Per-branch numbers are longer ("IN-KLW-000012"); the column must never truncate one.
      width: 190,
      /* A draft of a type that numbers on posting has no number yet, and an empty cell would read as
         missing data rather than as "not assigned". The badge says which it is. */
      render: (row) =>
        row.documentNumber ? (
          <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{row.documentNumber}</Text>
        ) : (
          <Badge color="gray" variant="light">DRAFT</Badge>
        ),
    },
    {
      accessor: 'documentDate',
      title: 'Date',
      sortable: true,
      width: 110,
      render: (row) => dateLabel(row.documentDate),
    },
    { accessor: 'branchName', title: 'Branch', sortable: true },
    { accessor: 'warehouseName', title: 'Warehouse', sortable: true },
    { accessor: 'reasonName', title: 'Reason', render: (row) => row.reasonName ?? '—' },
    { accessor: 'referenceNo', title: 'Reference', render: (row) => row.referenceNo ?? '—' },
    { accessor: 'totalItems', title: 'Items', width: 70, textAlign: 'right', render: (row) => formatNumber(row.totalItems) },
    {
      accessor: 'totalQuantity',
      title: 'Quantity',
      width: 100,
      textAlign: 'right',
      render: (row) => formatNumber(row.totalQuantity),
    },
    {
      accessor: 'totalCost',
      title: 'Total Cost',
      sortable: true,
      width: 140,
      textAlign: 'right',
      render: (row) => money(row.totalCost, row.currencyCode),
    },
    {
      accessor: 'status',
      title: 'Status',
      sortable: true,
      width: 110,
      render: (row) => (
        <Badge color={STATUS_COLOURS[row.status] ?? 'gray'} variant="light">
          {row.status}
        </Badge>
      ),
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 170,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={documentLabel(row)}
          edit={{
            visible: canCreate && row.status === 'Draft',
            onClick: () => void navigate(`${kind.route}/${row.id}`),
          }}
          custom={[
            {
              icon: <IconEye size={16} />,
              tooltip: 'View',
              onClick: () => void navigate(`${kind.route}/${row.id}`),
            },
            {
              icon: <IconSend size={16} />,
              tooltip: 'Post',
              visible: canPost && row.status === 'Draft',
              onClick: () => void post(row),
            },
            {
              icon: <IconFilterOff size={16} />,
              tooltip: 'Cancel document',
              color: 'orange',
              visible: canCancel && row.status === 'Posted',
              onClick: () => setCancelling(row),
            },
          ]}
          remove={{
            visible: canDelete && row.status === 'Draft',
            onClick: () => void remove(row),
          }}
        />
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title={kind.title}
        actions={
          canCreate ? (
            <Button
              leftSection={<IconPlus size={16} />}
              color={kind.colour}
              onClick={() => void navigate(`${kind.route}/new`)}
            >
              New {kind.title}
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput
            label="Search"
            placeholder="Number or reference"
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(event) => setFilter('search', event.currentTarget.value)}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Branch"
            placeholder="All branches"
            data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
            value={filters.branchId}
            onChange={chooseBranch}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Warehouse"
            placeholder={filters.branchId ? 'All warehouses' : 'Choose a branch'}
            data={warehouses.map((w) => ({ value: String(w.id), label: w.warehouseName }))}
            value={filters.warehouseId}
            onChange={(next) => setFilter('warehouseId', next)}
            disabled={filters.branchId === null}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Status"
            placeholder="All"
            data={STATUSES}
            value={filters.status}
            onChange={(next) => setFilter('status', next)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={1}>
          <DateInput
            label="From"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateFrom ? new Date(filters.dateFrom) : null}
            onChange={(next) => setFilter('dateFrom', next ? isoDate(new Date(next)) : null)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={1}>
          <DateInput
            label="To"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateTo ? new Date(filters.dateTo) : null}
            onChange={(next) => setFilter('dateTo', next ? isoDate(new Date(next)) : null)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={1}>
          <Button
            variant="default"
            leftSection={<IconFilterOff size={16} />}
            onClick={grid.clearFilters}
          >
            Clear
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      <BulkActionsBar
        count={selection.ids.length}
        canPost={canPost}
        canDelete={canDelete}
        busy={bulkBusy}
        onPost={() => void bulkPost()}
        onDelete={() => void bulkDelete()}
        onClear={selection.clear}
      />

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="inventory.stockDocuments"
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
          noRecordsText={`No ${kind.title} documents yet.`}
          onRowClick={({ record }) => void navigate(`${kind.route}/${record.id}`)}
        />
      </Paper>

      <BulkResultsModal
        opened={bulkResult !== null}
        title={bulkResult?.title ?? ''}
        successLabel={bulkResult?.successLabel ?? ''}
        result={bulkResult?.result ?? null}
        labelOf={(item) => `draft #${item.id}`}
        onClose={() => setBulkResult(null)}
      />

      <CancelReasonModal
        opened={cancelling !== null}
        onClose={() => setCancelling(null)}
        documentLabel={cancelling ? documentLabel(cancelling) : ''}
        busy={cancelBusy}
        onConfirm={(reason) => void cancelDocument(reason)}
      />
    </div>
  )
}
