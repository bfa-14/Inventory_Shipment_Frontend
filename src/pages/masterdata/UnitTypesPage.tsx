import { useCallback, useMemo, useState } from 'react'
import { Alert, Button, Paper, Select, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconRefresh, IconSearch, IconTableExport } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import { unitTypesApi } from '../../api/masterdata/unitTypes'
import type { UnitTypeDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { formatDateTime } from '../../components/format'
import { downloadCsv } from '../../components/masterdata/csv'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { UnitTypeFormModal } from './UnitTypeFormModal'

/** The filters the reader edits. Paging and sorting are the grid's own, held by useGridQuery. */
interface Filters {
  search: string
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', isActive: null }

/**
 * What each column IS, for the grid engine: its kind (so a number compares as a number and a date
 * as a date), and what it shows. How a cell LOOKS stays in the column definitions below.
 */
const GRID_COLUMNS: GridColumnMeta<UnitTypeDto>[] = [
  { accessor: 'unitTypeName', summary: 'count' },
  { accessor: 'isActive', kind: 'boolean', text: (u) => (u.isActive ? 'Active' : 'Inactive') },
  { accessor: 'createdAtUtc', kind: 'date', text: (u) => formatDateTime(u.createdAtUtc) },
]

type Dialog = { kind: 'create' } | { kind: 'edit'; unitType: UnitTypeDto } | null

export function UnitTypesPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)

  const canCreate = hasPermission(PERMISSIONS.unitTypesCreate)
  const canEdit = hasPermission(PERMISSIONS.unitTypesEdit)
  const canDelete = hasPermission(PERMISSIONS.unitTypesDelete)

  const grid = useGridQuery<Filters, UnitTypeDto, AllRows<UnitTypeDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'unitTypeName', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The unit types could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          unitTypesApi.search(
            {
              search: filters.search.trim() || undefined,
              isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
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

  /* THE ENGINE HOLDS THE WHOLE TABLE AND ANSWERS FOR EVERY COLUMN: typed filters, multi-column sort,
     paging, footer totals over all the filtered rows, CSV. The bar above the grid still narrows what
     is loaded from the server; the column filters then narrow what was loaded. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'masterdata.unitTypes',
    sort: [{ accessor: 'unitTypeName', direction: 'asc' }],
  })

  function exportCsv() {
    downloadCsv(
      'unit-types.csv',
      ['Name', 'Status', 'Created'],
      // What the reader is looking at, funnels and all - not the whole table behind them.
      engine.rows.map((u) => [
        u.unitTypeName,
        u.isActive ? 'Active' : 'Inactive',
        formatDateTime(u.createdAtUtc),
      ]),
    )
  }

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function handleDelete(unitType: UnitTypeDto) {
    const confirmed = await confirm({
      title: 'Delete unit type',
      message: `Delete unit type ${unitType.unitTypeName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await unitTypesApi.remove(unitType.id)
      await afterSave('Unit type deleted successfully.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REFERENCED') {
        const deactivate = await confirm({
          title: 'Unit type cannot be deleted',
          message: err.messages[0] as string,
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) await setStatus(unitType, false)
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The unit type could not be deleted.')
    }
  }

  async function setStatus(unitType: UnitTypeDto, isActive: boolean) {
    try {
      await unitTypesApi.setStatus(unitType.id, isActive)
      await afterSave(isActive ? 'Unit type activated.' : 'Unit type deactivated.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONCURRENCY') {
        notify.error(err.messages[0] as string)
        await load()
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The unit type could not be updated.')
    }
  }

  async function handleToggleStatus(unitType: UnitTypeDto) {
    const activating = !unitType.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate unit type' : 'Deactivate unit type',
      message: activating
        ? `Activate ${unitType.unitTypeName}?`
        : `Deactivate ${unitType.unitTypeName}? It will no longer be offered when an item's packaging is defined.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (confirmed) await setStatus(unitType, activating)
  }

  const columns: DataTableColumn<UnitTypeDto>[] = [
    rowNumberColumn<UnitTypeDto>(engine.page, engine.pageSize),
    {
      accessor: 'unitTypeName',
      title: 'Name',
    },
    {
      accessor: 'isActive',
      title: 'Status',
      width: 150,
      render: (u) => <StatusBadge active={u.isActive} />,
    },
    {
      accessor: 'createdAtUtc',
      title: 'Created',
      width: 180,
      // No tick list: every row is a different instant, so the list would be one entry per row.
      render: (u) => formatDateTime(u.createdAtUtc),
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      render: (unitType) => (
        <RowActions
          label={unitType.unitTypeName}
          edit={{ visible: canEdit, onClick: () => setDialog({ kind: 'edit', unitType }) }}
          toggleStatus={{
            visible: canEdit,
            active: unitType.isActive,
            onClick: () => void handleToggleStatus(unitType),
          }}
          remove={{ visible: canDelete, onClick: () => void handleDelete(unitType) }}
        />
      ),
    },
  ]

  const filtered = !grid.isDefault

  return (
    <>
      <PageHeader
        title="Unit Types"
        subtitle="The units of measure an item can be packed in - PC, Box, Pallet, Container."
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
                New Unit Type
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={7}>
          <TextInput
            placeholder="Search by name..."
            leftSection={<IconSearch size={16} />}
            label="Search"
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') grid.commitFilters()
            }}
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

        <FilterBar.Col span={3}>
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
        <Alert color="red" mb="md" title="Could not load unit types">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<UnitTypeDto>
          storeKey="masterdata.unitTypes"
          engine={engine}
          exportFileName="unit-types"
          columns={columns}
          fetching={loading}
          // Enter on the selected row does what its pencil does.
          onRowActivate={canEdit ? ({ record }) => setDialog({ kind: 'edit', unitType: record }) : undefined}
          noRecordsText={
            filtered ? 'No unit types found. Try clearing the filters to see every unit type.' : 'No unit types found.'
          }
        />
      </Paper>

      {dialog ? (
        <UnitTypeFormModal
          mode={dialog.kind}
          unitType={dialog.kind === 'edit' ? dialog.unitType : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(
              dialog.kind === 'create' ? 'Unit type created successfully.' : 'Unit type updated successfully.',
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

