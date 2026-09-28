import { useCallback, useMemo, useState } from 'react'
import { Alert, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconSearch } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import { containerTypesApi, type ContainerTypeDto } from '../../api/masterdata/containerTypes'
import { useAuth } from '../../auth/useAuth'
import { formatNumber } from '../../components/format'
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
import { ContainerTypeFormModal } from './ContainerTypeFormModal'

interface Filters {
  search: string
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', isActive: null }

/** The closed set the Status funnel offers, whatever the loaded rows happen to contain. */
const STATUS_VALUES = ['Active', 'Inactive']

/** An unset capacity reads as a dash, and its funnel has to match the dash the reader sees. */
const DASH = '—'

/** What each column SHOWS - the text its header filter matches and its funnel lists. */
const COLUMN_TEXT: Record<string, ColumnText<ContainerTypeDto>> = {
  typeCode: (r) => r.typeCode,
  typeName: (r) => r.typeName,
  maxUnits: (r) => (r.maxUnits === null ? DASH : formatNumber(r.maxUnits)),
  maxWeightKg: (r) => (r.maxWeightKg === null ? DASH : formatNumber(r.maxWeightKg, 0)),
  maxVolumeCbm: (r) => (r.maxVolumeCbm === null ? DASH : formatNumber(r.maxVolumeCbm, 1)),
  isActive: (r) => (r.isActive ? 'Active' : 'Inactive'),
}

/** Sorts on whatever column was clicked: numbers numerically, flags with Inactive first. */
function compareRows(a: ContainerTypeDto, b: ContainerTypeDto, key: keyof ContainerTypeDto): number {
  const left = a[key]
  const right = b[key]
  if (typeof left === 'number' || typeof right === 'number') {
    // An unset capacity sorts as nothing rather than as zero, which would read as "holds none".
    return (typeof left === 'number' ? left : -Infinity) - (typeof right === 'number' ? right : -Infinity)
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true })
}

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

  // A filter that leaves three rows must not strand the reader on page 4 of the old result.
  const columnFilters = useGridFilters(COLUMN_TEXT, () => grid.setPage(1))
  const { apply: applyColumnFilters, options: columnOptions } = columnFilters

  /** What the funnels left - the rows this page then sorts, pages and counts. */
  const narrowed = useMemo(() => applyColumnFilters(rows), [rows, applyColumnFilters])

  const sortKey = grid.sortStatus.columnAccessor as keyof ContainerTypeDto
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
      maxUnits: columnOptions(rows, 'maxUnits'),
    }),
    [rows, columnOptions],
  )

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
    rowNumberColumn<ContainerTypeDto>(grid.page, grid.pageSize),
    {
      accessor: 'typeCode',
      title: 'Type Code',
      sortable: true,
      width: 120,
      ...columnFilter({ ...columnFilters.bind('typeCode'), label: 'Type Code', options: values.typeCode }),
      render: (row) => <Text fw={600} fz="sm">{row.typeCode}</Text>,
    },
    {
      accessor: 'typeName',
      title: 'Type Name',
      sortable: true,
      ...columnFilter({ ...columnFilters.bind('typeName'), label: 'Type Name', options: values.typeName }),
    },
    {
      accessor: 'maxUnits',
      title: 'Max Units',
      sortable: true,
      width: 120,
      textAlign: 'right',
      ...columnFilter({ ...columnFilters.bind('maxUnits'), label: 'Max Units', options: values.maxUnits }),
      render: (row) => (row.maxUnits === null ? <Text c="dimmed">{DASH}</Text> : formatNumber(row.maxUnits)),
    },
    {
      accessor: 'maxWeightKg',
      title: 'Max Weight (kg)',
      sortable: true,
      width: 150,
      textAlign: 'right',
      ...columnFilter({ ...columnFilters.bind('maxWeightKg'), label: 'Max Weight' }),
      render: (row) => (row.maxWeightKg === null ? <Text c="dimmed">{DASH}</Text> : formatNumber(row.maxWeightKg, 0)),
    },
    {
      accessor: 'maxVolumeCbm',
      title: 'Max Volume (CBM)',
      sortable: true,
      width: 160,
      textAlign: 'right',
      ...columnFilter({ ...columnFilters.bind('maxVolumeCbm'), label: 'Max Volume' }),
      render: (row) => (row.maxVolumeCbm === null ? <Text c="dimmed">{DASH}</Text> : formatNumber(row.maxVolumeCbm, 1)),
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
        subtitle="Container sizes and how many units each one holds."
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

