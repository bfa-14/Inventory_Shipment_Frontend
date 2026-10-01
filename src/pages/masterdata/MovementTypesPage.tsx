import { useCallback, useMemo, useState } from 'react'
import { Alert, Button, Group, Paper, Select, Stack, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconSearch } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import {
  MOVEMENT_STAGES,
  movementTypesApi,
  stageExplanation,
  type MovementStage,
  type MovementTypeDto,
} from '../../api/masterdata/movementTypes'
import { useAuth } from '../../auth/useAuth'
import { formatNumber } from '../../components/format'
import { StageIcon } from '../../components/logistics/movementStage'
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
import { MovementTypeFormModal } from './MovementTypeFormModal'

export const MOVEMENT_TYPES_ROUTE = '/setup/master-data/movement-types'

interface Filters {
  search: string
  stage: string | null
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', stage: null, isActive: null }

/**
 * What each column SHOWS - the text its header filter matches and its funnel lists. The Stage cell
 * prints the stage over its explanation; the funnel matches the stage, which is what it is picked by.
 */
/**
 * What each column IS, for the grid engine: its kind (so a number compares as a number and a date
 * as a date), and what it shows. How a cell LOOKS stays in the column definitions below.
 */
const GRID_COLUMNS: GridColumnMeta<MovementTypeDto>[] = [
  { accessor: 'typeCode', summary: 'count' },
  { accessor: 'typeName' },
  { accessor: 'stage' },
  { accessor: 'sortOrder', kind: 'number', text: (r) => formatNumber(r.sortOrder) },
  { accessor: 'usedCount', kind: 'number', text: (r) => formatNumber(r.usedCount) },
  { accessor: 'isActive', kind: 'boolean', text: (r) => (r.isActive ? 'Active' : 'Inactive') },
]

type Dialog = { kind: 'create' } | { kind: 'edit'; movementType: MovementTypeDto } | null

/**
 * The legs a container's route is made of - loading, sea freight, port arrival, customs, delivery.
 * The STAGE is the part that matters: it decides what starting and completing a movement of the
 * type does to the containers on it.
 */
export function MovementTypesPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const canManage = hasPermission(PERMISSIONS.movementTypesManage)

  const grid = useGridQuery<Filters, MovementTypeDto, AllRows<MovementTypeDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'sortOrder', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The movement types could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          movementTypesApi.list(
            {
              search: filters.search.trim() || undefined,
              stage: (filters.stage as MovementStage | null) ?? undefined,
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
    storeKey: 'masterdata.movementTypes',
    sort: [{ accessor: 'sortOrder', direction: 'asc' }],
  })

  // A filter that leaves three rows must not strand the reader on page 4 of the old result.

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function setStatus(row: MovementTypeDto, activating: boolean) {
    try {
      await movementTypesApi.setActive(row.id, activating, row.rowVersion)
      await afterSave(activating ? 'Movement type activated.' : 'Movement type deactivated.')
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The movement type could not be updated.')
      if (err instanceof ApiError && err.code === 'CONCURRENCY') await load()
    }
  }

  async function handleToggleStatus(row: MovementTypeDto) {
    const activating = !row.isActive
    const go = await confirm({
      title: activating ? 'Activate movement type' : 'Deactivate movement type',
      message: activating
        ? `Activate ${row.typeCode} - ${row.typeName}?`
        : `Deactivate ${row.typeCode} - ${row.typeName}? It will no longer be offered on a new movement.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (go) await setStatus(row, activating)
  }

  async function handleDelete(row: MovementTypeDto) {
    const go = await confirm({
      title: 'Delete movement type',
      message: `Delete movement type ${row.typeCode} - ${row.typeName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    try {
      await movementTypesApi.remove(row.id)
      await afterSave('Movement type deleted successfully.')
    } catch (err) {
      // The icon is already disabled for a type in use, so IN_USE only reaches here when the row in
      // hand is out of date - a movement was planned with it since the page loaded. Offer the way out.
      if (err instanceof ApiError && err.code === 'IN_USE') {
        const deactivate = await confirm({
          title: 'Movement type cannot be deleted',
          message: err.messages[0] as string,
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) await setStatus(row, false)
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The movement type could not be deleted.')
    }
  }

  const columns: DataTableColumn<MovementTypeDto>[] = [
    rowNumberColumn<MovementTypeDto>(engine.page, engine.pageSize),
    {
      accessor: 'typeCode',
      title: 'Code',
      width: 120,
      render: (row) => <Text fw={600} fz="sm">{row.typeCode}</Text>,
    },
    {
      accessor: 'typeName',
      title: 'Name',
    },
    {
      accessor: 'stage',
      title: 'Stage',
      width: 320,
      render: (row) => (
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <StageIcon stage={row.stage} />
          <Stack gap={0}>
            <Text fz="sm">{row.stage}</Text>
            <Text fz="xs" c="dimmed">
              {stageExplanation(row.stage)}
            </Text>
          </Stack>
        </Group>
      ),
    },
    {
      accessor: 'sortOrder',
      title: 'Sort Order',
      width: 110,
      textAlign: 'right',
      render: (row) => formatNumber(row.sortOrder),
    },
    {
      accessor: 'usedCount',
      title: 'Movements',
      width: 110,
      textAlign: 'right',
      render: (row) => formatNumber(row.usedCount),
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
          edit={{ visible: canManage, onClick: () => setDialog({ kind: 'edit', movementType: row }) }}
          toggleStatus={{ visible: canManage, active: row.isActive, onClick: () => void handleToggleStatus(row) }}
          remove={{
            visible: canManage,
            disabled: row.usedCount > 0,
            disabledReason: `Used by ${formatNumber(row.usedCount)} movements - deactivate instead`,
            onClick: () => void handleDelete(row),
          }}
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Movement Types"
        subtitle="The legs of a container's route, and what each stage does to the containers."
        actions={
          canManage ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
              New Movement Type
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <FilterBar.Col span={5}>
          <TextInput
            placeholder="Code or name"
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
          <Select label="Stage" placeholder="All stages" data={STAGE_OPTIONS} value={filters.stage} onChange={(value) => setFilter('stage', value)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Status" placeholder="All" data={STATUS_OPTIONS} value={filters.isActive} onChange={(value) => setFilter('isActive', value)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={grid.clearFilters} disabled={grid.isDefault}>
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load movement types">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<MovementTypeDto>
          storeKey="masterdata.movementTypes"
          engine={engine}
          exportFileName="movement-types"
          columns={columns}
          fetching={loading}
          onRowActivate={canManage ? ({ record }) => setDialog({ kind: 'edit', movementType: record }) : undefined}
          noRecordsText={grid.isDefault ? 'No movement types yet.' : 'No movement types found. Try clearing the filters.'}
        />
      </Paper>

      {dialog ? (
        <MovementTypeFormModal
          mode={dialog.kind}
          movementType={dialog.kind === 'edit' ? dialog.movementType : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(dialog.kind === 'create' ? 'Movement type created successfully.' : 'Movement type updated successfully.')
          }
        />
      ) : null}
    </>
  )
}

const STAGE_OPTIONS = MOVEMENT_STAGES.map((s) => ({ value: s.value, label: s.label }))

const STATUS_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
]

