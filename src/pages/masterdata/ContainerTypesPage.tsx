import { useCallback, useMemo, useState } from 'react'
import { Alert, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconSearch } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import { containerTypesApi, type ContainerTypeDto } from '../../api/masterdata/containerTypes'
import { useAuth } from '../../auth/useAuth'
import { formatNumber } from '../../components/format'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { ContainerTypeFormModal } from './ContainerTypeFormModal'

interface Filters {
  search: string
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', isActive: null }

/** An unset capacity reads as a dash, and its funnel has to match the dash the reader sees. */
const DASH = '—'

/**
 * What each column IS, for the grid engine: its kind (so a number compares as a number and a date
 * as a date), and what it shows. How a cell LOOKS stays in the column definitions below.
 */
const GRID_COLUMNS: GridColumnMeta<ContainerTypeDto>[] = [
  { accessor: 'typeCode', summary: 'count' },
  { accessor: 'typeName' },
  { accessor: 'maxWeightKg', kind: 'number', text: (r) => (r.maxWeightKg === null ? DASH : formatNumber(r.maxWeightKg, 0)) },
  { accessor: 'maxVolumeCbm', kind: 'number', text: (r) => (r.maxVolumeCbm === null ? DASH : formatNumber(r.maxVolumeCbm, 1)) },
  { accessor: 'isActive', kind: 'boolean', text: (r) => (r.isActive ? 'Active' : 'Inactive') },
]

type Dialog = { kind: 'create' } | { kind: 'edit'; containerType: ContainerTypeDto } | null

/**
 * Container types and their capacity. The capacity is a number of UNITS (the customer counts
 * motorcycles, not cubic metres); weight and volume are kept for the forwarder's paperwork.
 */
export function ContainerTypesPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const canManage = hasPermission(PERMISSIONS.containerTypesManage)

  const grid = useGridQuery<Filters, ContainerTypeDto, AllRows<ContainerTypeDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'typeCode', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The container types could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          containerTypesApi.list(
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
    storeKey: 'masterdata.containerTypes',
    sort: [{ accessor: 'typeCode', direction: 'asc' }],
  })

  // A filter that leaves three rows must not strand the reader on page 4 of the old result.

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function handleToggleStatus(row: ContainerTypeDto) {
    const activating = !row.isActive
    const go = await confirm({
      title: activating ? 'Activate container type' : 'Deactivate container type',
      message: activating
        ? `Activate ${row.typeCode} - ${row.typeName}?`
        : `Deactivate ${row.typeCode} - ${row.typeName}? It will no longer be offered on a new container.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (!go) return
    try {
      await containerTypesApi.setActive(row.id, activating, row.rowVersion)
      await afterSave(activating ? 'Container type activated.' : 'Container type deactivated.')
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The container type could not be updated.')
      if (err instanceof ApiError && err.code === 'CONCURRENCY') await load()
    }
  }

  async function handleDelete(row: ContainerTypeDto) {
    const go = await confirm({
      title: 'Delete container type',
      message: `Delete container type ${row.typeCode} - ${row.typeName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    try {
      await containerTypesApi.remove(row.id)
      await afterSave('Container type deleted successfully.')
    } catch (err) {
      // IN_USE included: the server's sentence already says to deactivate it instead.
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The container type could not be deleted.')
    }
  }

  const columns: DataTableColumn<ContainerTypeDto>[] = [
    rowNumberColumn<ContainerTypeDto>(engine.page, engine.pageSize),
    {
      accessor: 'typeCode',
      title: 'Type Code',
      width: 120,
      render: (row) => <Text fw={600} fz="sm">{row.typeCode}</Text>,
    },
    {
      accessor: 'typeName',
      title: 'Type Name',
    },
    {
      accessor: 'maxWeightKg',
      title: 'Max Weight (kg)',
      width: 150,
      textAlign: 'right',
      render: (row) => (row.maxWeightKg === null ? <Text c="dimmed">{DASH}</Text> : formatNumber(row.maxWeightKg, 0)),
    },
    {
      accessor: 'maxVolumeCbm',
      title: 'Max Volume (CBM)',
      width: 160,
      textAlign: 'right',
      render: (row) => (row.maxVolumeCbm === null ? <Text c="dimmed">{DASH}</Text> : formatNumber(row.maxVolumeCbm, 1)),
    },
    {
      accessor: 'isActive',
      title: 'Status',
      width: 120,
      render: (row) => <StatusBadge active={row.isActive} />,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      render: (row) => (
        <RowActions
          label={row.typeCode}
          edit={{ visible: canManage, onClick: () => setDialog({ kind: 'edit', containerType: row }) }}
          toggleStatus={{ visible: canManage, active: row.isActive, onClick: () => void handleToggleStatus(row) }}
          remove={{
            visible: canManage,
            disabled: row.usedCount > 0,
            disabledReason: `Used by ${formatNumber(row.usedCount)} container(s) - deactivate instead`,
            onClick: () => void handleDelete(row),
          }}
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Container Types"
        subtitle="Container sizes, their weight and volume. How many pieces a container holds is each item's Container unit (Item Definition)."
        actions={
          canManage ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
              New Container Type
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <FilterBar.Col span={6}>
          <TextInput
            placeholder="Type code or name"
            leftSection={<IconSearch size={16} />}
            label="Search"
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select label="Status" placeholder="All" data={STATUS_OPTIONS} value={filters.isActive} onChange={(value) => setFilter('isActive', value)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={grid.clearFilters} disabled={grid.isDefault}>
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load container types">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<ContainerTypeDto>
          storeKey="masterdata.containerTypes"
          engine={engine}
          exportFileName="container-types"
          columns={columns}
          fetching={loading}
          onRowActivate={canManage ? ({ record }) => setDialog({ kind: 'edit', containerType: record }) : undefined}
          noRecordsText={
            grid.isDefault ? 'No container types yet.' : 'No container types found. Try clearing the filters.'
          }
        />
      </Paper>

      {dialog ? (
        <ContainerTypeFormModal
          mode={dialog.kind}
          containerType={dialog.kind === 'edit' ? dialog.containerType : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(dialog.kind === 'create' ? 'Container type created successfully.' : 'Container type updated successfully.')
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

