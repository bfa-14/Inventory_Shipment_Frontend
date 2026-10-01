import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActionIcon, Alert, Box, Button, Group, Paper, Select, Text, TextInput } from '@mantine/core'
import {
  IconBuildingWarehouse,
  IconChevronDown,
  IconChevronRight,
  IconFilterOff,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTableExport,
} from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { branchesApi } from '../../api/masterdata/branches'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BranchLookupDto, WarehouseDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { branchLabel } from '../../components/format'
import { downloadCsv } from '../../components/masterdata/csv'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { FilterBar } from '../../components/ui/FilterBar'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { MainFlag, StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { WarehouseFormModal } from './WarehouseFormModal'

/* ── the branch tree ──────────────────────────────────────────────────────────────────────────────
   A warehouse has no parent warehouse - the only hierarchy in the table is the branch it belongs
   to - so the tree is exactly two deep: a branch, and the warehouses standing in it. That is the
   same shape the Item Families page draws, with the depth fixed at two instead of arbitrary.
   ─────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * What each column IS, for the grid engine. The tree itself (parents, children, which are open) is the
 * engine's too: see the `tree` option where the grid is made.
 */
const GRID_COLUMNS: GridColumnMeta<WarehouseDto>[] = [
  { accessor: 'warehouseCode', summary: 'count' },
  { accessor: 'warehouseName' },
  { accessor: 'branchName', kind: 'list' },
  { accessor: 'address', text: (w) => w.address ?? '' },
  { accessor: 'isMainWarehouse', kind: 'boolean', text: (w) => (w.isMainWarehouse ? 'Yes' : 'No') },
  { accessor: 'isActive', kind: 'boolean', text: (w) => (w.isActive ? 'Active' : 'Inactive') },
]

/** Pixels of indent per level - the only thing that makes the nesting readable in a flat grid. */
const INDENT = 26

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
  const grid = useGridQuery<Filters, WarehouseDto, AllRows<WarehouseDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'warehouseCode', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The warehouses could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          warehousesApi.search(
            {
              search: filters.search.trim() || undefined,
              branchId: filters.branchId === null ? undefined : Number(filters.branchId),
              isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
              isMainWarehouse:
                filters.isMainWarehouse === null ? undefined : filters.isMainWarehouse === 'true',
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

  /* THE ENGINE HOLDS THE LOADED WAREHOUSES AS A TREE and answers for every column: typed filters (a match
     keeps the parents it stands under), sort among siblings, footer totals, CSV. The bar above the grid
     still narrows what is loaded from the server. A tree has no pager: a page break would cut a parent
     from its children. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'masterdata.warehouses',
    sort: [{ accessor: 'warehouseCode', direction: 'asc' }],
    tree: {
      idOf: (w) => w.id,
      parentOf: (w) => w.parentId,
      // The first visit opens every parent, so the tree does not read as a flat list.
      openByDefault: (w) => w.childCount > 0,
    },
  })
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
      // The warehouses the funnels left, in the order the tree shows them. Every row is a real
      // warehouse now, parents included: a parent is a record like any other, just not one stock
      // sits in.
      engine.rows
        .map((w) => [
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

  const columns: DataTableColumn<WarehouseDto>[] = [
    {
      accessor: 'warehouseCode',
      title: 'Warehouse Code',
      // Wide enough that an indented code still clears its chevron before the column ends.
      width: 300,
      render: (row) => {
        const info = engine.treeInfo(row)
        const open = info.open

        return (
          <Group gap={6} wrap="nowrap" style={{ paddingLeft: info.depth * INDENT }}>
            {info.hasChildren ? (
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={`${open ? 'Collapse' : 'Expand'} ${row.warehouseName}`}
                onClick={() => engine.toggleNode(row)}
              >
                {open ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
              </ActionIcon>
            ) : (
              // Keeps every code on the same left edge, chevron or not.
              <Box w={26} />
            )}

            <IconBuildingWarehouse
              size={16}
              color={info.hasChildren ? 'var(--mantine-color-brand-6)' : 'var(--mantine-color-gray-5)'}
            />
            {/* A parent is a grouping rather than a place stock sits in, so it carries its weight. */}
            <Text fz="sm" fw={info.hasChildren ? 600 : 400}>
              {row.warehouseCode}
            </Text>
            {row.childCount > 0 ? (
              <Text fz="xs" c="dimmed">
                ({row.childCount})
              </Text>
            ) : null}
          </Group>
        )
      },
    },
    {
      accessor: 'warehouseName',
      title: 'Warehouse Name',
    },
    {
      accessor: 'branchName',
      title: 'Branch / Site',
      render: (row) =>
        <Text fz="sm" title={row.branchCode}>{row.branchName}</Text>,
    },
    {
      accessor: 'address',
      title: 'Address',
      render: (row) => row.address ?? '-',
    },
    {
      accessor: 'isMainWarehouse',
      title: 'Is Main Warehouse',
      width: 205,
      render: (row) => <MainFlag isMain={row.isMainWarehouse} />,
    },
    {
      accessor: 'isActive',
      title: 'Status',
      width: 150,
      render: (row) => <StatusBadge active={row.isActive} />,
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
            // A parent's children have to be moved or deleted first; the procedure says so too.
            disabled: warehouse.isMainWarehouse || warehouse.childCount > 0,
            disabledReason: warehouse.isMainWarehouse
              ? 'The main warehouse cannot be deleted'
              : 'Warehouses stand under this one. Move or delete them first.',
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
        {/* No paging: a page break would cut a branch from the warehouses standing in it, and page 2
            would be a list of warehouses with no branch above them. The table is small and already
            loads in full, so every row is here. */}
        <DataTable<WarehouseDto>
          storeKey="masterdata.warehouses"
          engine={engine}
          exportFileName="warehouses"
          columns={columns}
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

const YES_NO_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]
