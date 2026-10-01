import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, Anchor, Badge, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconEye, IconFileExport, IconFilterOff, IconPlus, IconSearch, IconSend, IconX } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { branchesApi } from '../../api/masterdata/branches'
import {
  landedCostAdjustmentsApi,
  LANDED_COST_STATUS_COLOURS,
  LANDED_COST_STATUSES,
  type LandedCostAdjustmentListDto,
  type LandedCostAdjustmentStatus,
} from '../../api/purchase/landedCostAdjustments'
import type { BranchLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { CancelReasonModal } from '../../components/documents/CancelReasonModal'
import { dateLabel, isoDate, stamp } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { PURCHASE_INVOICE } from '../../components/purchase/purchaseKind'
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

export const LANDED_COSTS_ROUTE = '/purchase/landed-cost-adjustments'

interface Filters {
  search: string
  branchId: string | null
  status: string | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = { search: '', branchId: null, status: null, dateFrom: null, dateTo: null }

/** What each column IS, for the grid engine: its kind and what it shows. How a cell LOOKS stays below. */
const GRID_COLUMNS: GridColumnMeta<LandedCostAdjustmentListDto>[] = [
  { accessor: 'documentNumber', summary: 'count' },
  { accessor: 'documentDate', kind: 'date' },
  { accessor: 'sourceInvoiceNumber', text: (r) => r.sourceInvoiceNumber ?? '' },
  { accessor: 'supplierName' },
  { accessor: 'branchName' },
  { accessor: 'totalChargesBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.totalChargesBase, 2) },
  { accessor: 'inventoryPortionBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.inventoryPortionBase, 2) },
  { accessor: 'cogsPortionBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.cogsPortionBase, 2) },
  { accessor: 'status', kind: 'list' },
  { accessor: 'postedByName', text: (r) => r.postedByName ?? '' },
  { accessor: 'postedAtUtc', kind: 'date', text: (r) => stamp(r.postedAtUtc) },
]

/**
 * Every landed cost adjustment: the charges that arrived after the goods.
 *
 * THE TWO PORTIONS ARE THE POINT OF THE LIST. Total charges says what was billed; the inventory and
 * COGS columns say where it went — up the value of what is still on the shelf, or straight into the
 * period because the goods had already been sold. Both are zero until the adjustment is posted.
 */
export function LandedCostAdjustmentsPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  const canCreate = hasPermission(PERMISSIONS.landedCostsCreate)
  const canPost = hasPermission(PERMISSIONS.landedCostsPost)
  const canCancel = hasPermission(PERMISSIONS.landedCostsCancel)
  const canDelete = hasPermission(PERMISSIONS.landedCostsDelete)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [cancelling, setCancelling] = useState<LandedCostAdjustmentListDto | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)

  const grid = useGridQuery<Filters, LandedCostAdjustmentListDto, AllRows<LandedCostAdjustmentListDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'documentDate', direction: 'desc' },
    // The list is loaded whole (newest first, up to the grid's cap) and the grid does the rest.
    paging: 'client',
    errorMessage: 'The landed cost adjustments could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          landedCostAdjustmentsApi.list(
            {
              search: filters.search.trim() || undefined,
              branchId: filters.branchId === null ? undefined : Number(filters.branchId),
              status: (filters.status as LandedCostAdjustmentStatus | null) ?? undefined,
              dateFrom: filters.dateFrom ?? undefined,
              dateTo: filters.dateTo ?? undefined,
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
  const rows = useMemo(() => data?.items ?? [], [data])

  /* THE ENGINE HOLDS THE LOADED ADJUSTMENTS AND ANSWERS FOR EVERY COLUMN: typed filters, multi-column
     sort, paging, footer totals over all the filtered rows, CSV. The filters above the grid still
     narrow what is loaded from the server; the column filters then narrow that. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'purchase.landedCostAdjustments',
    sort: [{ accessor: 'documentDate', direction: 'desc' }],
  })

  useEffect(() => {
    branchesApi.lookup(false).then(setBranches).catch(() => {})
  }, [])

  const open = (row: LandedCostAdjustmentListDto) => void navigate(`${LANDED_COSTS_ROUTE}/${row.id}`)

  async function post(row: LandedCostAdjustmentListDto) {
    const go = await confirm({
      title: `Post ${row.documentNumber}`,
      message: 'Post this adjustment? Item costs will be updated.',
      confirmLabel: 'Post',
    })
    if (!go) return
    try {
      await landedCostAdjustmentsApi.post(row.id, row.rowVersion)
      notify.success('Adjustment posted. Item costs updated.')
      await grid.reload()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The adjustment could not be posted.')
      await grid.reload()
    }
  }

  async function cancelAdjustment(reason: string) {
    const row = cancelling
    if (!row) return
    setCancelBusy(true)
    try {
      await landedCostAdjustmentsApi.cancel(row.id, reason, row.rowVersion)
      notify.success('Adjustment cancelled. Item costs were put back.')
      setCancelling(null)
      await grid.reload()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The adjustment could not be cancelled.')
    } finally {
      setCancelBusy(false)
    }
  }

  async function remove(row: LandedCostAdjustmentListDto) {
    const go = await confirm({
      title: 'Delete draft',
      message: `Delete ${row.documentNumber}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    try {
      await landedCostAdjustmentsApi.remove(row.id)
      notify.success('Draft deleted.')
      await grid.reload()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The draft could not be deleted.')
      await grid.reload()
    }
  }

  async function exportToExcel(row: LandedCostAdjustmentListDto) {
    try {
      await landedCostAdjustmentsApi.exportToExcel(row.id, row.documentNumber)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The adjustment could not be exported.')
    }
  }

  const columns: DataTableColumn<LandedCostAdjustmentListDto>[] = [
    rowNumberColumn<LandedCostAdjustmentListDto>(engine.page, engine.pageSize),
    {
      accessor: 'documentNumber',
      title: 'Number',
      width: 180,
      render: (row) => (
        <Anchor component={Link} to={`${LANDED_COSTS_ROUTE}/${row.id}`} fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
          {row.documentNumber}
        </Anchor>
      ),
    },
    { accessor: 'documentDate', title: 'Date', width: 110, render: (row) => dateLabel(row.documentDate) },
    {
      accessor: 'sourceInvoiceNumber',
      title: 'Invoice',
      width: 180,
      render: (row) => (
        <Anchor
          component={Link}
          to={`${PURCHASE_INVOICE.route}/${row.sourceInvoiceId}`}
          fz="sm"
          style={{ whiteSpace: 'nowrap' }}
          onClick={(event) => event.stopPropagation()}
        >
          {row.sourceInvoiceNumber ?? `#${row.sourceInvoiceId}`}
        </Anchor>
      ),
    },
    { accessor: 'supplierName', title: 'Supplier', width: 190 },
    { accessor: 'branchName', title: 'Branch', width: 150 },
    {
      accessor: 'totalChargesBase',
      title: 'Total charges',
      width: 130,
      textAlign: 'right',
      render: (row) => <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{formatNumber(row.totalChargesBase, 2)}</Text>,
    },
    {
      accessor: 'inventoryPortionBase',
      title: 'Inventory portion',
      width: 140,
      textAlign: 'right',
      render: (row) => formatNumber(row.inventoryPortionBase, 2),
    },
    {
      accessor: 'cogsPortionBase',
      title: 'COGS portion',
      width: 130,
      textAlign: 'right',
      render: (row) => formatNumber(row.cogsPortionBase, 2),
    },
    {
      accessor: 'status',
      title: 'Status',
      width: 110,
      render: (row) => <Badge color={LANDED_COST_STATUS_COLOURS[row.status] ?? 'gray'} variant="light">{row.status}</Badge>,
    },
    { accessor: 'postedByName', title: 'Posted by', width: 160, render: (row) => row.postedByName ?? '—' },
    {
      accessor: 'postedAtUtc',
      title: 'Posted on',
      width: 170,
      render: (row) => <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>{stamp(row.postedAtUtc)}</Text>,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 200,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={row.documentNumber}
          edit={{ visible: canCreate && row.canEdit, onClick: () => open(row) }}
          custom={[
            { icon: <IconEye size={16} />, tooltip: 'View', onClick: () => open(row) },
            { icon: <IconSend size={16} />, tooltip: 'Post', visible: canPost && row.canPost, onClick: () => void post(row) },
            { icon: <IconX size={16} />, tooltip: 'Cancel', color: 'red', visible: canCancel && row.canCancel, onClick: () => setCancelling(row) },
            { icon: <IconFileExport size={16} />, tooltip: 'Export to Excel', onClick: () => void exportToExcel(row) },
          ]}
          remove={{ visible: canDelete && row.canDelete, onClick: () => void remove(row) }}
        />
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Landed Cost Adjustments"
        subtitle="Charges that arrived after the goods: what is still in stock raises its value, what was sold lands in the period."
        actions={
          canCreate ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => void navigate(`${LANDED_COSTS_ROUTE}/new`)}>
              New Adjustment
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <FilterBar.Col span={4}>
          <TextInput
            label="Search"
            placeholder="Adjustment no., invoice no. or supplier"
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(event) => setFilter('search', event.currentTarget.value)}
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Branch"
            placeholder="All branches"
            data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
            value={filters.branchId}
            onChange={(next) => setFilter('branchId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Status"
            placeholder="All"
            data={[...LANDED_COST_STATUSES]}
            value={filters.status}
            onChange={(next) => setFilter('status', next)}
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
        <FilterBar.Col span={2}>
          <Button variant="default" fullWidth mt={25} leftSection={<IconFilterOff size={16} />} disabled={grid.isDefault} onClick={grid.clearFilters}>
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      {data?.truncated ? (
        <Alert color="yellow" mb="md" title="Showing the newest rows only">
          There are more adjustments than the grid loads at once. Narrow the list with the filters above (dates, status, customer) to see the rest.
        </Alert>
      ) : null}

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="purchase.landedCostAdjustments"
          engine={engine}
          exportFileName="landed-cost-adjustments"
          columns={columns}
          fetching={loading}
          noRecordsText="No landed cost adjustments yet."
          onRowClick={({ record }) => open(record)}
        />
      </Paper>

      <CancelReasonModal
        opened={cancelling !== null}
        onClose={() => setCancelling(null)}
        documentLabel={cancelling?.documentNumber ?? ''}
        busy={cancelBusy}
        onConfirm={(reason) => void cancelAdjustment(reason)}
      />
    </div>
  )
}
