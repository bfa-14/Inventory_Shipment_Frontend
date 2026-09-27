import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, Anchor, Badge, Button, Group, Paper, Select, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useDebouncedValue } from '@mantine/hooks'
import { IconArrowRight, IconFileSpreadsheet, IconFilterOff, IconPlus, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi } from '../../api/logistics/containers'
import {
  MOVEMENT_STATUSES,
  movementsApi,
  movementStatusColour,
  type MovementListDto,
  type MovementQuery,
  type MovementStatusCode,
} from '../../api/logistics/movements'
import { movementTypesApi, type MovementTypeLookupDto } from '../../api/masterdata/movementTypes'
import { portLabel, portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import { useAuth } from '../../auth/useAuth'
import { dateLabel, isoDate } from '../../components/documents/documentKind'
import { formatMoney, formatNumber } from '../../components/format'
import { StageIcon } from '../../components/logistics/movementStage'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'

export const MOVEMENTS_ROUTE = '/logistics/movements'

interface Filters {
  search: string
  status: string | null
  movementTypeId: string | null
  placeId: string | null
  containerId: string | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = {
  search: '',
  status: null,
  movementTypeId: null,
  placeId: null,
  containerId: null,
  dateFrom: null,
  dateTo: null,
}

/** The columns usp_Movement_Search can sort by; every other column is left unsortable. */
const ACCESSOR_TO_SORT: Record<string, string> = {
  movementNo: 'MovementNo',
  startDate: 'StartDate',
  eta: 'Eta',
  endDate: 'EndDate',
  status: 'Status',
}

type Option = { value: string; label: string }

/** The filters as the API reads them; the grid and the Excel export send the same thing. */
function toQuery(filters: Filters): MovementQuery {
  return {
    search: filters.search.trim() || undefined,
    status: filters.status === null ? undefined : (Number(filters.status) as MovementStatusCode),
    movementTypeId: filters.movementTypeId === null ? undefined : Number(filters.movementTypeId),
    placeId: filters.placeId === null ? undefined : Number(filters.placeId),
    containerId: filters.containerId === null ? undefined : Number(filters.containerId),
    dateFrom: filters.dateFrom ?? undefined,
    dateTo: filters.dateTo ?? undefined,
  }
}

/**
 * Every leg of every route: which containers travel, from where to where, when, with whom and at
 * what cost. A red "Late" badge flags a planned or running leg whose ETA is behind us.
 */
export function MovementsPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSIONS.movementsManage)

  const [types, setTypes] = useState<MovementTypeLookupDto[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  const [containerSearch, setContainerSearch] = useState('')
  const [containerOptions, setContainerOptions] = useState<Option[]>([])
  const [pickedContainer, setPickedContainer] = useState<Option | null>(null)
  const [debouncedContainerSearch] = useDebouncedValue(containerSearch, 300)

  const grid = useGridQuery<Filters, MovementListDto, Awaited<ReturnType<typeof movementsApi.list>>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'startDate', direction: 'desc' },
    errorMessage: 'The movements could not be loaded.',
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        movementsApi.list(
          {
            ...toQuery(filters),
            sortBy: ACCESSOR_TO_SORT[sortStatus.columnAccessor as string] ?? 'StartDate',
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
    movementTypesApi.lookup(false).then(setTypes).catch(() => {})
    portsApi.lookup(false).then(setPorts).catch(() => {})
  }, [])

  // The container filter searches the server as it is typed: there can be thousands of containers.
  useEffect(() => {
    const controller = new AbortController()
    containersApi
      .list({ search: debouncedContainerSearch.trim() || undefined, pageSize: 50, sortBy: 'OrderDate', sortDir: 'desc' }, controller.signal)
      .then((result) =>
        setContainerOptions(
          result.items.map((c) => ({ value: String(c.id), label: c.containerNo ? `${c.containerRef} - ${c.containerNo}` : c.containerRef })),
        ),
      )
      .catch(() => {})
    return () => controller.abort()
  }, [debouncedContainerSearch])

  const typeOptions = useMemo(() => types.map((t) => ({ value: String(t.id), label: `${t.typeCode} - ${t.typeName}` })), [types])
  const portOptions = useMemo(() => ports.map((p) => ({ value: String(p.id), label: `${p.portCode} - ${portLabel(p)}` })), [ports])
  // The picked container stays in the list even when the search that found it has moved on.
  const containerData = useMemo(() => {
    if (!pickedContainer || containerOptions.some((o) => o.value === pickedContainer.value)) return containerOptions
    return [pickedContainer, ...containerOptions]
  }, [containerOptions, pickedContainer])

  async function exportList() {
    try {
      await movementsApi.exportToExcel(toQuery(filters))
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The movements could not be exported.')
    }
  }

  const dash = <Text fz="sm" c="dimmed">—</Text>
  const text = (value: string | null) => (value ? <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>{value}</Text> : dash)

  const columns: DataTableColumn<MovementListDto>[] = [
    rowNumberColumn<MovementListDto>(grid.page, grid.pageSize),
    {
      accessor: 'movementNo',
      title: 'Movement No.',
      sortable: true,
      width: 160,
      render: (row) => (
        <Anchor component={Link} to={`${MOVEMENTS_ROUTE}/${row.id}`} fz="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
          {row.movementNo}
        </Anchor>
      ),
    },
    {
      accessor: 'typeName',
      title: 'Type',
      width: 170,
      render: (row) => (
        <Group gap={6} wrap="nowrap">
          <StageIcon stage={row.stage} />
          <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
            {row.typeName}
          </Text>
        </Group>
      ),
    },
    {
      accessor: 'route',
      title: 'From → To',
      width: 220,
      render: (row) => (
        <Group gap={4} wrap="nowrap">
          <Text fz="sm" fw={600} title={row.fromName}>
            {row.fromCode}
          </Text>
          {row.toPlaceId === row.fromPlaceId ? null : (
            <>
              <IconArrowRight size={14} color="var(--mantine-color-dimmed)" />
              <Text fz="sm" fw={600} title={row.toName}>
                {row.toCode}
              </Text>
            </>
          )}
          <Text fz="xs" c="dimmed" truncate maw={120}>
            {row.toPlaceId === row.fromPlaceId ? row.fromName : `${row.fromName} → ${row.toName}`}
          </Text>
        </Group>
      ),
    },
    { accessor: 'plannedDate', title: 'Planned', width: 105, render: (row) => dateLabel(row.plannedDate) },
    { accessor: 'startDate', title: 'Start', sortable: true, width: 105, render: (row) => dateLabel(row.startDate) },
    {
      accessor: 'eta',
      title: 'ETA',
      sortable: true,
      width: 105,
      render: (row) => (
        <Text fz="sm" c={row.isLate ? 'red' : undefined} fw={row.isLate ? 600 : undefined}>
          {dateLabel(row.eta)}
        </Text>
      ),
    },
    { accessor: 'endDate', title: 'End', sortable: true, width: 105, render: (row) => dateLabel(row.endDate) },
    { accessor: 'carrierName', title: 'Carrier', width: 160, render: (row) => text(row.carrierName) },
    {
      accessor: 'vehicleOrVessel',
      title: 'Vessel / Truck',
      width: 150,
      render: (row) => text([row.vehicleOrVessel, row.voyageNo].filter(Boolean).join(' · ') || null),
    },
    {
      accessor: 'containerRefs',
      title: 'Containers',
      width: 170,
      render: (row) => (
        <Group gap={6} wrap="nowrap">
          {text(row.containerRefs)}
          <Badge variant="light" color="gray" size="sm">
            {formatNumber(row.containerCount)}
          </Badge>
        </Group>
      ),
    },
    {
      accessor: 'chargesPostedBase',
      title: 'Charges',
      width: 130,
      textAlign: 'right',
      render: (row) => (row.chargesPostedBase ? formatMoney(row.chargesPostedBase, 'USD') : dash),
    },
    { accessor: 'attachmentCount', title: 'Documents', width: 100, textAlign: 'right', render: (row) => formatNumber(row.attachmentCount) },
    {
      accessor: 'status',
      title: 'Status',
      sortable: true,
      width: 150,
      render: (row) => (
        <Group gap={4} wrap="nowrap">
          <Badge color={movementStatusColour(row.status)} variant="light" style={{ whiteSpace: 'nowrap' }}>
            {row.statusName}
          </Badge>
          {row.isLate ? (
            <Badge color="red" variant="filled" size="sm">
              Late
            </Badge>
          ) : null}
        </Group>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Movements"
        subtitle="The legs of every container's route: sea freight, port, customs, border and delivery."
        actions={
          <>
            <MoreActionsMenu actions={[{ label: 'Export to Excel', icon: <IconFileSpreadsheet size={16} />, onClick: () => void exportList() }]} />
            {canManage ? (
              <Button leftSection={<IconPlus size={16} />} onClick={() => void navigate(`${MOVEMENTS_ROUTE}/new`)}>
                New movement
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput
            label="Search"
            placeholder="Movement no., vessel, truck, reference"
            leftSection={<IconSearch size={16} />}
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
            data={MOVEMENT_STATUSES.map((s) => ({ value: String(s.value), label: s.label }))}
            value={filters.status}
            onChange={(next) => setFilter('status', next)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Type" placeholder="All types" data={typeOptions} value={filters.movementTypeId} onChange={(next) => setFilter('movementTypeId', next)} clearable searchable nothingFoundMessage="No type matches" />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select label="Place" placeholder="Any place" data={portOptions} value={filters.placeId} onChange={(next) => setFilter('placeId', next)} clearable searchable nothingFoundMessage="No place matches" />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Container"
            placeholder="Any container"
            data={containerData}
            value={filters.containerId}
            onChange={(next, option) => {
              setPickedContainer(next ? { value: option.value, label: option.label } : null)
              setFilter('containerId', next)
            }}
            searchable
            searchValue={containerSearch}
            onSearchChange={setContainerSearch}
            // The server has already filtered by what was typed; filtering again would hide "KTG-…" found by its number.
            filter={({ options }) => options}
            clearable
            nothingFoundMessage="No container matches"
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput label="Date from" placeholder="Any" valueFormat="DD/MM/YYYY" value={filters.dateFrom} onChange={(next) => setFilter('dateFrom', next ? isoDate(new Date(next)) : null)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput label="Date to" placeholder="Any" valueFormat="DD/MM/YYYY" value={filters.dateTo} onChange={(next) => setFilter('dateTo', next ? isoDate(new Date(next)) : null)} clearable />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Button
            variant="default"
            leftSection={<IconFilterOff size={16} />}
            onClick={() => {
              setPickedContainer(null)
              setContainerSearch('')
              grid.clearFilters()
            }}
            disabled={grid.isDefault}
          >
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" withBorder>
        <DataTable<MovementListDto>
          storeKey="logistics.movements"
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
          noRecordsText={grid.isDefault ? 'No movements yet.' : 'No movements match these filters.'}
          onRowClick={({ record }) => void navigate(`${MOVEMENTS_ROUTE}/${record.id}`)}
        />
      </Paper>
    </div>
  )
}
