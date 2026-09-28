import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconRefresh, IconSearch, IconTableExport } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BranchLookupDto, WarehouseDto, WarehouseSortBy } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { branchLabel } from '../../components/format'
import { downloadCsv } from '../../components/masterdata/csv'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { columnFilter } from '../../components/ui/columnFilter'
import { triStateFilter, triStateQuery } from '../../components/ui/gridFilters'
import { FilterBar } from '../../components/ui/FilterBar'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { MainFlag, StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { WarehouseFormModal } from './WarehouseFormModal'

/** The filters the reader edits. Paging and sorting are the grid's own, held by useGridQuery. */
interface Filters {
  search: string
  branchId: string | null
  isActive: string | null
  isMainWarehouse: string | null
}

const NO_FILTERS: Filters = { search: '', branchId: null, isActive: null, isMainWarehouse: null }

type Dialog = { kind: 'create' } | { kind: 'edit'; warehouse: WarehouseDto } | null

export function WarehousesPage() {
  const { hasPermission } = useAuth()

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)

  const canCreate = hasPermission(PERMISSIONS.warehousesCreate)
  const canEdit = hasPermission(PERMISSIONS.warehousesEdit)
  const canDelete = hasPermission(PERMISSIONS.warehousesDelete)

  /**
   * The grid's whole query. No Apply button: the search box settles 350ms after the last keystroke,
   * every other control lands at once, and the hook guarantees one request per settled state with
   * the newest one winning.
   *
   * The filter bar and the column funnels are two ways into the SAME filter, and both go through
   * `setFilter`, so a header reading "Active" over a bar reading "All" is not a state that exists.
   */
  const grid = useGridQuery<Filters, WarehouseDto, Awaited<ReturnType<typeof warehousesApi.search>>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'warehouseCode', direction: 'asc' },
    errorMessage: 'The warehouses could not be loaded.',
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        warehousesApi.search(
          {
            search: filters.search.trim() || undefined,
            branchId: filters.branchId === null ? undefined : Number(filters.branchId),
            isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
            isMainWarehouse:
              filters.isMainWarehouse === null ? undefined : filters.isMainWarehouse === 'true',
            sortBy: ACCESSOR_TO_SORT[sortStatus.columnAccessor as string] ?? 'WarehouseCode',
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

  // Every branch, including inactive ones, so rows on a deactivated branch can still be filtered.
  useEffect(() => {
    branchesApi
      .lookup(false)
      .then(setBranches)
      .catch(() => {
        // Not fatal: the filter simply offers no branches until the next reload.
      })
  }, [])


  function exportCsv() {
    downloadCsv(
      'warehouses.csv',
      ['Warehouse Code', 'Warehouse Name', 'Branch / Site', 'Address', 'Is Main Warehouse', 'Status'],
      (data?.items ?? []).map((w) => [
        w.warehouseCode,
        w.warehouseName,
        `${w.branchCode} - ${w.branchName}`,
        w.address ?? '',
        w.isMainWarehouse ? 'Yes' : 'No',
        w.isActive ? 'Active' : 'Inactive',
      ]),
    )
  }

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function setStatus(warehouse: WarehouseDto, isActive: boolean) {
    try {
      await warehousesApi.setStatus(warehouse.id, isActive)
      await afterSave(isActive ? 'Warehouse activated.' : 'Warehouse deactivated.')
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The warehouse could not be updated.')
    }
  }

  async function handleDelete(warehouse: WarehouseDto) {
    const confirmed = await confirm({
      title: 'Delete warehouse',
      message: `Delete warehouse ${warehouse.warehouseCode} - ${warehouse.warehouseName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await warehousesApi.remove(warehouse.id)
      await afterSave('Warehouse deleted successfully.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REFERENCED') {
        const deactivate = await confirm({
          title: 'Warehouse cannot be deleted',
          message: err.messages[0] as string,
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) await setStatus(warehouse, false)
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The warehouse could not be deleted.')
    }
  }

  async function handleToggleStatus(warehouse: WarehouseDto) {
    const activating = !warehouse.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate warehouse' : 'Deactivate warehouse',
      message: activating
        ? `Activate ${warehouse.warehouseCode} - ${warehouse.warehouseName}?`
        : `Deactivate ${warehouse.warehouseCode} - ${warehouse.warehouseName}? It will no longer be selectable.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (confirmed) await setStatus(warehouse, activating)
  }

  /* The Branch funnel picks ONE branch, because the endpoint filters by a single branchId - see
     the `single` note on ColumnFilter. Its options carry the branch code as well as the name, which
     the cell has no room for, so two branches sharing a name stay tellable apart. */
  const branchOptions = branches.map(branchLabel)
  const filteredBranch = branches.find((b) => String(b.id) === filters.branchId)

  const columns: DataTableColumn<WarehouseDto>[] = [
    rowNumberColumn<WarehouseDto>(grid.page, grid.pageSize),
    /* Warehouse Code, Warehouse Name and Address carry no header filter: this grid pages on the
       server and the search endpoint takes one free-text parameter that matches code OR name, so a
       per-column box here could only narrow by something other than the column it sits on. The
       search box in the filter bar is that parameter, under its own name. */
    { accessor: 'warehouseCode', title: 'Warehouse Code', sortable: true, width: 160 },
    { accessor: 'warehouseName', title: 'Warehouse Name', sortable: true },
    {
      accessor: 'branchName',
      title: 'Branch / Site',
      sortable: true,
      ...columnFilter({
        label: 'Branch / Site',
        value: filteredBranch ? { values: [branchLabel(filteredBranch)] } : undefined,
        onApply: (next) => {
          const picked = next?.values?.[0]
          const branch = picked ? branches.find((b) => branchLabel(b) === picked) : undefined
          setFilter('branchId', branch ? String(branch.id) : null)
        },
        options: branchOptions,
        withText: false,
        single: true,
      }),
      render: (w) => <Text fz="sm" title={w.branchCode}>{w.branchName}</Text>,
    },
    { accessor: 'address', title: 'Address', sortable: true, render: (w) => w.address ?? '-' },
    {
      accessor: 'isMainWarehouse',
      title: 'Is Main Warehouse',
      sortable: true,
      width: 205,
      ...columnFilter({
        label: 'Is Main Warehouse',
        value: triStateFilter(filters.isMainWarehouse, 'Yes', 'No'),
        onApply: (next) => setFilter('isMainWarehouse', triStateQuery(next, 'Yes')),
        options: YES_NO_VALUES,
        withText: false,
      }),
      render: (w) => <MainFlag isMain={w.isMainWarehouse} />,
    },
    {
      accessor: 'isActive',
      title: 'Status',
      sortable: true,
      width: 150,
      ...columnFilter({
        label: 'Status',
        value: triStateFilter(filters.isActive, 'Active', 'Inactive'),
        onApply: (next) => setFilter('isActive', triStateQuery(next, 'Active')),
        options: STATUS_VALUES,
        withText: false,
      }),
      render: (w) => <StatusBadge active={w.isActive} />,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      render: (warehouse) => (
        <RowActions
          label={warehouse.warehouseCode}
          edit={{ visible: canEdit, onClick: () => setDialog({ kind: 'edit', warehouse }) }}
          toggleStatus={{
            visible: canEdit,
            active: warehouse.isActive,
            disabled: warehouse.isMainWarehouse && warehouse.isActive,
            disabledReason: 'The main warehouse cannot be deactivated',
            onClick: () => void handleToggleStatus(warehouse),
          }}
          remove={{
            visible: canDelete,
            disabled: warehouse.isMainWarehouse,
            disabledReason: 'The main warehouse cannot be deleted',
            onClick: () => void handleDelete(warehouse),
          }}
        />
      ),
    },
  ]

  // "Filtered" for the empty-state wording: it should say "try clearing the filters" only when
  // there are filters to clear.
  const filtered = !grid.isDefault

  return (
    <>
      <PageHeader
        title="Warehouses"
        subtitle="View and manage warehouses."
        actions={
          <>
            <MoreActionsMenu
              actions={[
                { label: 'Refresh', icon: <IconRefresh size={16} />, onClick: () => void load() },
                { label: 'Export CSV', icon: <IconTableExport size={16} />, onClick: exportCsv },
              ]}
            />
            {canCreate ? (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
                New Warehouse
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput
            placeholder="Search by warehouse code or name..."
            leftSection={<IconSearch size={16} />}
            label="Search"
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
            // Enter sends what is typed now instead of waiting out the debounce.
            onKeyDown={(e) => {
              if (e.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>

        <FilterBar.Col span={3}>
          <Select
            label="Branch / Site"
            placeholder="All"
            searchable
            clearable
            nothingFoundMessage="No branch found"
            data={branches.map((b) => ({ value: String(b.id), label: branchLabel(b) }))}
            value={filters.branchId}
            onChange={(value) => setFilter('branchId', value)}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            label="Status"
            placeholder="All"
            data={STATUS_OPTIONS}
            value={filters.isActive}
            onChange={(value) => setFilter('isActive', value)}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            label="Is Main Warehouse"
            placeholder="All"
            data={YES_NO_OPTIONS}
            value={filters.isMainWarehouse}
            onChange={(value) => setFilter('isMainWarehouse', value)}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Button
            variant="default"
            leftSection={<IconFilterOff size={16} />}
            onClick={grid.clearFilters}
            disabled={grid.isDefault}
          >
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load warehouses">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<WarehouseDto>
          storeKey="masterdata.warehouses"
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
          // Enter on the selected row does what its pencil does.
          onRowActivate={canEdit ? ({ record }) => setDialog({ kind: 'edit', warehouse: record }) : undefined}
          noRecordsText={
            filtered ? 'No warehouses found. Try clearing the filters to see every warehouse.' : 'No warehouses found.'
          }
        />
      </Paper>

      {dialog ? (
        <WarehouseFormModal
          mode={dialog.kind}
          warehouse={dialog.kind === 'edit' ? dialog.warehouse : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(
              dialog.kind === 'create' ? 'Warehouse created successfully.' : 'Warehouse updated successfully.',
            )
          }
        />
      ) : null}
    </>
  )
}

const STATUS_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
]

/** The words the header funnels offer - the labels below, as the cells print them. */
const STATUS_VALUES = ['Active', 'Inactive']
const YES_NO_VALUES = ['Yes', 'No']

const YES_NO_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]


const ACCESSOR_TO_SORT: Record<string, WarehouseSortBy> = {
  warehouseCode: 'WarehouseCode',
  warehouseName: 'WarehouseName',
  branchName: 'BranchName',
  address: 'Address',
  isMainWarehouse: 'IsMainWarehouse',
  isActive: 'IsActive',
  createdAtUtc: 'CreatedAtUtc',
}
