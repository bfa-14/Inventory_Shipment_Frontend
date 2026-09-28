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
import { columnFilter } from '../../components/ui/columnFilter'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useGridFilters, type ColumnText } from '../../components/ui/gridFilters'
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

/** The closed set the Status funnel offers, whatever the loaded rows happen to contain. */
const STATUS_VALUES = ['Active', 'Inactive']

/**
 * What each column SHOWS - the text its header filter matches and its funnel lists. The Stage cell
 * prints the stage over its explanation; the funnel matches the stage, which is what it is picked by.
 */
const COLUMN_TEXT: Record<string, ColumnText<MovementTypeDto>> = {
  typeCode: (r) => r.typeCode,
  typeName: (r) => r.typeName,
  stage: (r) => r.stage,
  sortOrder: (r) => formatNumber(r.sortOrder),
  usedCount: (r) => formatNumber(r.usedCount),
  isActive: (r) => (r.isActive ? 'Active' : 'Inactive'),
}

/** Sorts on whatever column was clicked: numbers numerically, flags with Inactive first. */
function compareRows(a: MovementTypeDto, b: MovementTypeDto, key: keyof MovementTypeDto): number {
  const left = a[key]
  const right = b[key]
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true })
}

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

  // A filter that leaves three rows must not strand the reader on page 4 of the old result.
  const columnFilters = useGridFilters(COLUMN_TEXT, () => grid.setPage(1))
  const { apply: applyColumnFilters, options: columnOptions } = columnFilters

  /** What the funnels left - the rows this page then sorts, pages and counts. */
  const narrowed = useMemo(() => applyColumnFilters(rows), [rows, applyColumnFilters])

  const sortKey = grid.sortStatus.columnAccessor as keyof MovementTypeDto
  const sortDirection = grid.sortStatus.direction

  const sorted = useMemo(() => {
    const ordered = [...narrowed].sort((a, b) => compareRows(a, b, sortKey))
    if (sortDirection === 'desc') ordered.reverse()
    return ordered
  }, [narrowed, sortKey, sortDirection])

  const records = sorted.slice((grid.page - 1) * grid.pageSize, grid.page * grid.pageSize)

  /** The tick lists come from EVERY row, not from the ones surviving the filters. */
  const values = useMemo(
    () => ({
      typeCode: columnOptions(rows, 'typeCode'),
      typeName: columnOptions(rows, 'typeName'),
      stage: columnOptions(rows, 'stage'),
      sortOrder: columnOptions(rows, 'sortOrder'),
      usedCount: columnOptions(rows, 'usedCount'),
    }),
    [rows, columnOptions],
  )

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
    rowNumberColumn<MovementTypeDto>(grid.page, grid.pageSize),
    {
      accessor: 'typeCode',
      title: 'Code',
      sortable: true,
      width: 120,
      ...columnFilter({ ...columnFilters.bind('typeCode'), label: 'Code', options: values.typeCode }),
      render: (row) => <Text fw={600} fz="sm">{row.typeCode}</Text>,
    },
    {
      accessor: 'typeName',
      title: 'Name',
      sortable: true,
      ...columnFilter({ ...columnFilters.bind('typeName'), label: 'Name', options: values.typeName }),
    },
    {
      accessor: 'stage',
      title: 'Stage',
      sortable: true,
      width: 320,
      ...columnFilter({ ...columnFilters.bind('stage'), label: 'Stage', options: values.stage, withText: false }),
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
      sortable: true,
      width: 110,
      textAlign: 'right',
      ...columnFilter({ ...columnFilters.bind('sortOrder'), label: 'Sort Order', options: values.sortOrder }),
      render: (row) => formatNumber(row.sortOrder),
    },
    {
      accessor: 'usedCount',
      title: 'Movements',
      sortable: true,
      width: 110,
      textAlign: 'right',
      ...columnFilter({ ...columnFilters.bind('usedCount'), label: 'Movements', options: values.usedCount }),
      render: (row) => formatNumber(row.usedCount),
    },
    {
      accessor: 'isActive',
      title: 'Status',
      sortable: true,
      width: 120,
      ...columnFilter({ ...columnFilters.bind('isActive'), label: 'Status', options: STATUS_VALUES, withText: false }),
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
          records={records}
          columns={columns}
          // What the funnels left, which is what the footer must count.
          totalRecords={narrowed.length}
          filters={{ activeCount: columnFilters.activeCount, clearAll: columnFilters.clearAll }}
          page={grid.page}
          recordsPerPage={grid.pageSize}
          onPageChange={grid.setPage}
          onRecordsPerPageChange={grid.setPageSize}
          sortStatus={grid.sortStatus}
          onSortStatusChange={grid.setSortStatus}
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

