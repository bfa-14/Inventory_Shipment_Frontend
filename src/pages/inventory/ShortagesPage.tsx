import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, Anchor, Badge, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconEye, IconFileExport, IconFilterOff, IconPlus, IconPrinter, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { shortagesApi, type ShortageDocumentListDto, type ShortageDocumentStatus } from '../../api/inventory/shortages'
import { branchesApi } from '../../api/masterdata/branches'
import { partiesApi } from '../../api/masterdata/parties'
import { warehousesApi } from '../../api/masterdata/warehouses'
import { securityApi } from '../../api/security'
import type { BranchLookupDto, PartyLookupDto, UserLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { dateLabel, isoDate, stamp } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { supplierLabel } from '../../components/purchase/purchaseKind'
import { SHORTAGE_STATUS_COLOURS, SHORTAGES_ROUTE } from '../../components/shortages/shortageMath'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'

interface Filters {
  search: string
  warehouseId: string | null
  branchId: string | null
  supplierId: string | null
  status: string | null
  createdBy: string | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = { search: '', warehouseId: null, branchId: null, supplierId: null, status: null, createdBy: null, dateFrom: null, dateTo: null }

const ACCESSOR_TO_SORT: Record<string, string> = {
  documentNumber: 'DocumentNumber',
  documentDate: 'DocumentDate',
  description: 'Description',
  warehouseName: 'WarehouseName',
  supplierName: 'SupplierName',
  status: 'Status',
  createdAtUtc: 'CreatedAtUtc',
}

const numberOrUndefined = (value: string | null) => (value === null ? undefined : Number(value))

/**
 * Every shortage plan: drafts being worked on and the posted snapshots purchase orders came from.
 *
 * NO BULK ACTIONS. A plan is posted after somebody has read its lines; ticking five and posting
 * them unread is the opposite of what the document is for.
 */
export function ShortagesPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canCreate = hasPermission(PERMISSIONS.shortagesCreate)
  const canDelete = hasPermission(PERMISSIONS.shortagesDelete)

  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  const [users, setUsers] = useState<UserLookupDto[]>([])

  const grid = useGridQuery<Filters, ShortageDocumentListDto, Awaited<ReturnType<typeof shortagesApi.list>>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'documentDate', direction: 'desc' },
    errorMessage: 'The shortage plans could not be loaded.',
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        shortagesApi.list(
          {
            search: filters.search.trim() || undefined,
            warehouseId: numberOrUndefined(filters.warehouseId),
            branchId: numberOrUndefined(filters.branchId),
            supplierId: numberOrUndefined(filters.supplierId),
            status: (filters.status as ShortageDocumentStatus | null) ?? undefined,
            createdBy: numberOrUndefined(filters.createdBy),
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

  useEffect(() => {
    warehousesApi.lookup(false).then(setWarehouses).catch(() => {})
    branchesApi.lookup(false).then(setBranches).catch(() => {})
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setSuppliers).catch(() => {})
    securityApi.userLookup({ activeOnly: false }).then(setUsers).catch(() => {})
  }, [])

  const open = (row: ShortageDocumentListDto) => void navigate(`${SHORTAGES_ROUTE}/${row.id}`)

  async function remove(row: ShortageDocumentListDto) {
    const go = await confirm({ title: 'Delete draft', message: `Delete ${row.documentNumber} - ${row.description}? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
    if (!go) return
    try {
      await shortagesApi.remove(row.id)
      notify.success('Draft deleted.')
      await grid.reload()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The draft could not be deleted.')
      if (err instanceof ApiError && (err.code === 'NOT_DRAFT' || err.code === 'NOT_FOUND')) await grid.reload()
    }
  }

  async function exportToExcel(row: ShortageDocumentListDto) {
    try {
      await shortagesApi.exportToExcel(row.id, row.documentNumber)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The shortage plan could not be exported.')
    }
  }

  const columns: DataTableColumn<ShortageDocumentListDto>[] = [
    rowNumberColumn<ShortageDocumentListDto>(grid.page, grid.pageSize),
    {
      accessor: 'documentNumber',
      title: 'Shortage No.',
      sortable: true,
      width: 170,
      render: (row) => (
        <Anchor component={Link} to={`${SHORTAGES_ROUTE}/${row.id}`} fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
          {row.documentNumber}
        </Anchor>
      ),
    },
    { accessor: 'description', title: 'Description', sortable: true, width: 220, render: (row) => <Text fz="sm" lineClamp={2}>{row.description}</Text> },
    { accessor: 'documentDate', title: 'Date', sortable: true, width: 110, render: (row) => dateLabel(row.documentDate) },
    { accessor: 'warehouseName', title: 'Warehouse', sortable: true, width: 150 },
    { accessor: 'branchName', title: 'Branch', width: 150 },
    {
      accessor: 'supplierName',
      title: 'Supplier',
      sortable: true,
      width: 190,
      render: (row) => (
        <div>
          <Text fz="sm" fw={500}>{row.supplierName}</Text>
          <Text fz="xs" c="dimmed">{row.supplierCode}</Text>
        </div>
      ),
    },
    { accessor: 'leadTimeMonths', title: 'Lead Time (Month)', width: 130, textAlign: 'right', render: (row) => formatNumber(row.leadTimeMonths, Number.isInteger(row.leadTimeMonths) ? 0 : 2) },
    { accessor: 'totalLines', title: 'Lines', width: 70, textAlign: 'right', render: (row) => formatNumber(row.totalLines) },
    { accessor: 'containersRounded', title: 'Containers', width: 100, textAlign: 'right', render: (row) => formatNumber(row.containersRounded) },
    {
      accessor: 'purchaseOrders',
      title: 'POs',
      width: 70,
      textAlign: 'right',
      render: (row) =>
        row.purchaseOrders === 0 ? (
          <Text fz="sm" c="dimmed">—</Text>
        ) : (
          <Anchor component={Link} to={`${SHORTAGES_ROUTE}/${row.id}#purchase-orders`} fz="sm" title="The purchase orders created from this plan">
            {formatNumber(row.purchaseOrders)}
          </Anchor>
        ),
    },
    {
      accessor: 'status',
      title: 'Status',
      sortable: true,
      width: 100,
      render: (row) => <Badge color={SHORTAGE_STATUS_COLOURS[row.status] ?? 'gray'} variant="light">{row.status}</Badge>,
    },
    { accessor: 'createdByName', title: 'Created By', width: 160, render: (row) => row.createdByName ?? '—' },
    { accessor: 'createdAtUtc', title: 'Created On', sortable: true, width: 170, render: (row) => <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>{stamp(row.createdAtUtc)}</Text> },
    { accessor: 'postedByName', title: 'Posted By', width: 160, render: (row) => row.postedByName ?? '—' },
    { accessor: 'postedAtUtc', title: 'Posted On', width: 170, render: (row) => <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>{stamp(row.postedAtUtc)}</Text> },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 190,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={row.documentNumber}
          edit={{ visible: canCreate && row.canEdit, onClick: () => open(row) }}
          custom={[
            { icon: <IconEye size={16} />, tooltip: 'View', onClick: () => open(row) },
            { icon: <IconPrinter size={16} />, tooltip: 'Print', onClick: () => void navigate(`${SHORTAGES_ROUTE}/${row.id}/print`) },
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
        title="Shortages"
        subtitle="Shortage plans: drafts being worked on, and the posted snapshots purchase orders were created from."
        actions={
          canCreate ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => void navigate(`${SHORTAGES_ROUTE}/new`)}>
              New Shortage
            </Button>
          ) : undefined
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput label="Search" placeholder="Shortage No. or description" leftSection={<IconSearch size={16} />} value={filters.search} onChange={(event) => setFilter('search', event.currentTarget.value)} />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Warehouse" placeholder="All warehouses" data={warehouses.map((w) => ({ value: String(w.id), label: w.warehouseName }))} value={filters.warehouseId} onChange={(next) => setFilter('warehouseId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Branch" placeholder="All branches" data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))} value={filters.branchId} onChange={(next) => setFilter('branchId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select label="Supplier" placeholder="All suppliers" data={suppliers.map((s) => ({ value: String(s.id), label: supplierLabel(s) }))} value={filters.supplierId} onChange={(next) => setFilter('supplierId', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Status" placeholder="All" data={['Draft', 'Posted']} value={filters.status} onChange={(next) => setFilter('status', next)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select label="Created By" placeholder="Anyone" data={users.map((u) => ({ value: String(u.id), label: u.fullName || u.username }))} value={filters.createdBy} onChange={(next) => setFilter('createdBy', next)} clearable searchable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput label="Date from" placeholder="Any" valueFormat="DD/MM/YYYY" value={filters.dateFrom ? new Date(filters.dateFrom) : null} onChange={(next) => setFilter('dateFrom', next ? isoDate(new Date(next)) : null)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput label="Date to" placeholder="Any" valueFormat="DD/MM/YYYY" value={filters.dateTo ? new Date(filters.dateTo) : null} onChange={(next) => setFilter('dateTo', next ? isoDate(new Date(next)) : null)} clearable />
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

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="inventory.shortages"
          records={data?.items ?? []}
          columns={columns}
          totalRecords={data?.totalCount ?? 0}
          page={grid.page}
          recordsPerPage={grid.pageSize}
          onPageChange={grid.setPage}
          onRecordsPerPageChange={grid.setPageSize}
          sortStatus={grid.sortStatus}
          onSortStatusChange={grid.setSortStatus}
          fetching={loading}
          noRecordsText="No shortage plans yet."
          onRowClick={({ record }) => open(record)}
        />
      </Paper>
    </div>
  )
}
