import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Group, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilter, IconPlus, IconRefresh, IconSearch, IconTableExport } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BranchLookupDto, PagedResult, WarehouseDto, WarehouseSortBy } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { branchLabel } from '../../components/format'
import { downloadCsv } from '../../components/masterdata/csv'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn, type DataTableSortStatus } from '../../components/ui/DataTable'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { columnFilter } from '../../components/ui/columnFilter'
import { triStateFilter, triStateQuery } from '../../components/ui/gridFilters'
import { FilterBar } from '../../components/ui/FilterBar'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { MainFlag, StatusBadge } from '../../components/ui/StatusBadge'
import { PAGE_SIZE_DEFAULT } from '../../config'
import { PERMISSIONS } from '../../navigation'
import { WarehouseFormModal } from './WarehouseFormModal'

/** Everything that decides which rows the API returns. */
interface Query {
  search: string
  branchId: string | null
  isActive: string | null
  isMainWarehouse: string | null
  sortBy: WarehouseSortBy
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

const DEFAULT_QUERY: Query = {
  search: '',
  branchId: null,
  isActive: null,
  isMainWarehouse: null,
  sortBy: 'WarehouseCode',
  sortDir: 'asc',
  page: 1,
  pageSize: PAGE_SIZE_DEFAULT,
}

type Dialog = { kind: 'create' } | { kind: 'edit'; warehouse: WarehouseDto } | null

export function WarehousesPage() {
  const { hasPermission } = useAuth()

  const [query, setQuery] = useState<Query>(DEFAULT_QUERY)
  const [draftSearch, setDraftSearch] = useState('')
  const [draftBranch, setDraftBranch] = useState<string | null>(null)
  const [draftActive, setDraftActive] = useState<string | null>(null)
  const [draftMain, setDraftMain] = useState<string | null>(null)

  const [data, setData] = useState<PagedResult<WarehouseDto> | null>(null)
  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const canCreate = hasPermission(PERMISSIONS.warehousesCreate)
  const canEdit = hasPermission(PERMISSIONS.warehousesEdit)
  const canDelete = hasPermission(PERMISSIONS.warehousesDelete)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await warehousesApi.search({
        search: query.search || undefined,
        branchId: query.branchId === null ? undefined : Number(query.branchId),
        isActive: query.isActive === null ? undefined : query.isActive === 'true',
        isMainWarehouse: query.isMainWarehouse === null ? undefined : query.isMainWarehouse === 'true',
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        page: query.page,
        pageSize: query.pageSize,
      })
      setData(page)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The warehouses could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  // Every branch, including inactive ones, so rows on a deactivated branch can still be filtered.
  useEffect(() => {
    branchesApi
      .lookup(false)
      .then(setBranches)
      .catch(() => {
        // Not fatal: the filter simply offers no branches until the next reload.
      })
  }, [])

  function applyFilters() {
    setQuery((q) => ({
      ...q,
      search: draftSearch.trim(),
      branchId: draftBranch,
      isActive: draftActive,
      isMainWarehouse: draftMain,
      page: 1,
    }))
  }

  function clearFilters() {
    setDraftSearch('')
    setDraftBranch(null)
    setDraftActive(null)
    setDraftMain(null)
    setQuery(DEFAULT_QUERY)
  }

  /**
   * The column funnels and the filter bar's dropdowns are two ways into the SAME query parameter,
   * so a funnel moves the bar's control with it - a header reading "Active" above a bar reading
   * "All" would be two controls disagreeing about one filter.
   *
   * A funnel applies straight away, where the bar still waits for its Filter button: the popover has
   * its own OK, and asking for a second confirmation of a confirmed choice is one click too many.
   */
  function applyBranch(value: string | null) {
    setDraftBranch(value)
    setQuery((q) => ({ ...q, branchId: value, page: 1 }))
  }

  function applyStatus(value: string | null) {
    setDraftActive(value)
    setQuery((q) => ({ ...q, isActive: value, page: 1 }))
  }

  function applyMain(value: string | null) {
    setDraftMain(value)
    setQuery((q) => ({ ...q, isMainWarehouse: value, page: 1 }))
  }

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
  const filteredBranch = branches.find((b) => String(b.id) === query.branchId)

  const columns: DataTableColumn<WarehouseDto>[] = [
    rowNumberColumn<WarehouseDto>(query.page, query.pageSize),
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
          applyBranch(branch ? String(branch.id) : null)
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
        value: triStateFilter(query.isMainWarehouse, 'Yes', 'No'),
        onApply: (next) => applyMain(triStateQuery(next, 'Yes')),
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
        value: triStateFilter(query.isActive, 'Active', 'Inactive'),
        onApply: (next) => applyStatus(triStateQuery(next, 'Active')),
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

  const sortStatus: DataTableSortStatus<WarehouseDto> = {
    columnAccessor: SORT_TO_ACCESSOR[query.sortBy] ?? 'warehouseCode',
    direction: query.sortDir,
  }

  const filtered =
    query.search !== '' || query.branchId !== null || query.isActive !== null || query.isMainWarehouse !== null

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
            aria-label="Search warehouses"
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilters()
            }}
          />
        </FilterBar.Col>

        <FilterBar.Col span={3}>
          <Select
            aria-label="Branch / Site"
            placeholder="All"
            searchable
            clearable
            nothingFoundMessage="No branch found"
            data={branches.map((b) => ({ value: String(b.id), label: branchLabel(b) }))}
            value={draftBranch}
            onChange={setDraftBranch}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            aria-label="Status"
            placeholder="All"
            data={STATUS_OPTIONS}
            value={draftActive}
            onChange={setDraftActive}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            aria-label="Is Main Warehouse"
            placeholder="All"
            data={YES_NO_OPTIONS}
            value={draftMain}
            onChange={setDraftMain}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Group gap="sm">
            <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={clearFilters}>
              Clear Filters
            </Button>
            <Button variant="default" leftSection={<IconFilter size={16} />} onClick={applyFilters}>
              Filter
            </Button>
          </Group>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load warehouses">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<WarehouseDto>
          records={data?.items ?? []}
          columns={columns}
          totalRecords={data?.totalCount ?? 0}
          page={query.page}
          recordsPerPage={query.pageSize}
          onPageChange={(page) => setQuery((q) => ({ ...q, page }))}
          onRecordsPerPageChange={(pageSize) => setQuery((q) => ({ ...q, pageSize, page: 1 }))}
          sortStatus={sortStatus}
          onSortStatusChange={(status) =>
            setQuery((q) => ({
              ...q,
              sortBy: ACCESSOR_TO_SORT[status.columnAccessor as string] ?? q.sortBy,
              sortDir: status.direction,
              page: 1,
            }))
          }
          fetching={loading}
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

/** The grid sorts by DTO field; the API sorts by its own column names. */
const SORT_TO_ACCESSOR: Record<WarehouseSortBy, string> = {
  WarehouseCode: 'warehouseCode',
  WarehouseName: 'warehouseName',
  BranchName: 'branchName',
  Address: 'address',
  IsMainWarehouse: 'isMainWarehouse',
  IsActive: 'isActive',
  CreatedAtUtc: 'createdAtUtc',
}

const ACCESSOR_TO_SORT: Record<string, WarehouseSortBy> = {
  warehouseCode: 'WarehouseCode',
  warehouseName: 'WarehouseName',
  branchName: 'BranchName',
  address: 'Address',
  isMainWarehouse: 'IsMainWarehouse',
  isActive: 'IsActive',
  createdAtUtc: 'CreatedAtUtc',
}
