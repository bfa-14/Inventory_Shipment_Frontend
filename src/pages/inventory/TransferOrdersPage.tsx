import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Pagination,
  Paper,
  Progress,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { IconFilterOff, IconSearch } from '@tabler/icons-react'
import {
  transfersApi,
  type TransferOrderListItemDto,
  type TransferOrderTotalsDto,
  type TransferStatusFilter,
} from '../../api/inventory/transfers'
import { branchesApi } from '../../api/masterdata/branches'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BranchLookupDto, WarehouseLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { dateLabel, isoDate } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { transferWarehouseChoices, utcToday, warehouseText } from '../../components/transfers/transferModel'
import {
  LATE_BADGE,
  LOST_BADGE_COLOUR,
  lostBadgeLabel,
  TRANSFER_STATUS_FILTER_OPTIONS,
  transferStatusColour,
  transferStatusLabel,
} from '../../components/transfers/transferStatus'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { PageHeader } from '../../components/ui/PageHeader'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { routes } from '../../routes'

interface Filters {
  search: string
  branchId: string | null
  fromWarehouseId: string | null
  toWarehouseId: string | null
  status: string | null
  onTheWayOnly: boolean
  lateOnly: boolean
  waitingForApproval: boolean
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = {
  search: '',
  branchId: null,
  fromWarehouseId: null,
  toWarehouseId: null,
  status: null,
  onTheWayOnly: false,
  lateOnly: false,
  waitingForApproval: false,
  dateFrom: null,
  dateTo: null,
}

const STATUS_DATA = TRANSFER_STATUS_FILTER_OPTIONS.map((s) => ({ value: s.value, label: s.label }))

/** "Assigned on release" on a draft of a type that numbers then; the number otherwise. */
const numberText = (row: TransferOrderListItemDto) => row.documentNumber ?? 'Assigned on release'

/** Late to DISPATCH: something still to dispatch after the Expected arrival (UTC today, the server's rule T27). */
function lateToDispatch(row: TransferOrderListItemDto): boolean {
  return (
    row.status === 'Released' &&
    row.displayStatus !== 'Closed' &&
    row.toDispatchBase > 0 &&
    row.expectedArrival !== null &&
    row.expectedArrival < utcToday()
  )
}

/** What each column IS, for the grid engine; how a cell LOOKS stays in the column definitions. */
const GRID_COLUMNS: GridColumnMeta<TransferOrderListItemDto>[] = [
  { accessor: 'documentNumber', summary: 'count', value: numberText, text: numberText },
  { accessor: 'documentDate', kind: 'date' },
  { accessor: 'from', kind: 'list', value: (r) => warehouseText(r.from), text: (r) => warehouseText(r.from) },
  { accessor: 'to', kind: 'list', value: (r) => warehouseText(r.to), text: (r) => warehouseText(r.to) },
  {
    accessor: 'displayStatus',
    kind: 'list',
    value: (r) => transferStatusLabel(r.displayStatus),
    text: (r) => `${transferStatusLabel(r.displayStatus)}${r.isLate ? ' · Late' : ''}`,
  },
  { accessor: 'itemCount', kind: 'number', text: (r) => formatNumber(r.itemCount) },
  { accessor: 'orderedBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.orderedBase) },
  {
    accessor: 'dispatchedBase',
    kind: 'number',
    text: (r) => `${formatNumber(r.dispatchedBase)} / ${formatNumber(r.orderedBase)}`,
  },
  {
    accessor: 'receivedBase',
    kind: 'number',
    text: (r) => `${formatNumber(r.receivedBase)} / ${formatNumber(r.orderedBase)}`,
  },
  { accessor: 'onTheWayBase', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.onTheWayBase) },
  { accessor: 'expectedArrival', kind: 'date', text: (r) => dateLabel(r.expectedArrival) },
  { accessor: 'referenceNo', text: (r) => r.referenceNo ?? '' },
  { accessor: 'createdByName', kind: 'list', text: (r) => r.createdByName ?? '' },
]

/** A share as a short bar and "40 / 84" (dispatched or received of what was ordered). */
function progressCell(done: number, ordered: number, colour: string, meaning: string) {
  const value = ordered > 0 ? Math.min(100, (done * 100) / ordered) : 0
  return (
    <Tooltip label={`${formatNumber(done)} of ${formatNumber(ordered)} pcs ${meaning}`} withArrow>
      <Group gap={6} wrap="nowrap">
        <Progress value={value} size="sm" w={56} color={value >= 100 ? 'teal' : colour} aria-label={meaning} />
        <Text fz="xs" style={{ whiteSpace: 'nowrap' }}>
          {formatNumber(done)} / {formatNumber(ordered)}
        </Text>
      </Group>
    </Tooltip>
  )
}

/** The status badge, then the red filled "Late" and the orange "{n} lost". */
function statusBadges(row: TransferOrderListItemDto) {
  const lost = lostBadgeLabel(row.lostBase)
  return (
    <Group gap={4} wrap="wrap">
      <Badge variant="light" color={transferStatusColour(row.displayStatus)}>
        {transferStatusLabel(row.displayStatus)}
      </Badge>
      {row.isLate && (
        <Badge color={LATE_BADGE.colour} variant={LATE_BADGE.variant}>
          {LATE_BADGE.label}
        </Badge>
      )}
      {lost && (
        <Badge color={LOST_BADGE_COLOUR} variant="light" style={{ textTransform: 'none' }}>
          {lost}
        </Badge>
      )}
    </Group>
  )
}

/** A warehouse with its branch dimmed below: "LKS-01 - Likasi Warehouse" / "BR-003". */
function warehouseCell(ref: TransferOrderListItemDto['from']) {
  return (
    <>
      <Text fz="sm" lineClamp={2}>
        {warehouseText(ref)}
      </Text>
      {ref.branchCode ? (
        <Text fz="xs" c="dimmed">
          {ref.branchCode}
        </Text>
      ) : null}
    </>
  )
}

/**
 * Inventory › Transfer Orders (script 90, 2.6.2): every order that moves stock between two warehouses, with how far its
 * dispatches and receipts went - what is still on the way, what is late, what was written off.
 *
 * LOADED WHOLE (newest first, up to the grid's cap) like the other document lists: the bar above narrows what the
 * server sends, the column funnels then narrow that, and the summary line counts what is on screen.
 */
export function TransferOrdersPage() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const phone = useMediaQuery('(max-width: 48em)')

  const canCreate = hasPermission(PERMISSIONS.transfersCreate)
  const canApprove = hasPermission(PERMISSIONS.transfersApprove)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  /** The totals of the last search, over every order it matched (not only the rows loaded). */
  const [totals, setTotals] = useState<TransferOrderTotalsDto | null>(null)

  const grid = useGridQuery<
    Filters,
    TransferOrderListItemDto,
    { items: TransferOrderListItemDto[]; truncated: boolean }
  >({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'documentDate', direction: 'desc' },
    paging: 'client',
    errorMessage: 'The transfer orders could not be loaded.',
    fetcher: useCallback(async ({ filters, signal }) => {
      const query = {
        search: filters.search.trim() || undefined,
        status: (filters.status as TransferStatusFilter | null) ?? undefined,
        branchId: filters.branchId === null ? undefined : Number(filters.branchId),
        fromWarehouseId: filters.fromWarehouseId === null ? undefined : Number(filters.fromWarehouseId),
        toWarehouseId: filters.toWarehouseId === null ? undefined : Number(filters.toWarehouseId),
        onTheWayOnly: filters.onTheWayOnly || undefined,
        lateOnly: filters.lateOnly || undefined,
        waitingForApproval: filters.waitingForApproval || undefined,
        dateFrom: filters.dateFrom ?? undefined,
        dateTo: filters.dateTo ?? undefined,
        sortColumn: 'DocumentDate' as const,
        sortDirection: 'DESC' as const,
      }
      const PAGE = 200
      const MAX = 5000
      const first = await transfersApi.list({ ...query, page: 1, pageSize: PAGE }, signal)
      setTotals(first.totals)
      const items = [...first.items]
      const wanted = Math.min(first.totalCount, MAX)
      for (let page = 2; items.length < wanted; page++) {
        const next = await transfersApi.list({ ...query, page, pageSize: PAGE }, signal)
        if (next.items.length === 0) break
        items.push(...next.items)
      }
      return { items, truncated: first.totalCount > MAX }
    }, []),
  })

  const { filters, setFilter, data, loading, error } = grid
  const rows = useMemo(() => data?.items ?? [], [data])
  const unfiltered = grid.isDefault

  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'inventory.transferOrders',
    sort: [{ accessor: 'documentDate', direction: 'desc' }],
  })

  useEffect(() => {
    branchesApi
      .lookup(false)
      .then(setBranches)
      .catch(() => {})
    warehousesApi
      .lookup(false)
      .then(setWarehouses)
      .catch(() => {})
  }, [])

  /* From and To offer the leaves of every branch (never an On the way warehouse), grouped by branch. */
  const warehouseData = useMemo(
    () => transferWarehouseChoices(warehouses, [], filters.branchId === null ? null : Number(filters.branchId)),
    [warehouses, filters.branchId],
  )

  /* THE SUMMARY LINE: Orders, On the way (pcs), Late orders. The server's totals answer for every order the bar's
     filters match (beyond the rows loaded); once a column funnel narrows the rows, the line counts those. */
  const summary = useMemo(() => {
    if (engine.activeCount === 0 && totals)
      return { orders: totals.orders, onTheWay: totals.onTheWayBase, late: totals.lateOrders }
    const shown = engine.rows
    return {
      orders: shown.length,
      onTheWay: shown.reduce((sum, r) => sum + r.onTheWayBase, 0),
      late: shown.filter((r) => r.isLate).length,
    }
  }, [engine.activeCount, engine.rows, totals])

  const open = (row: TransferOrderListItemDto) => void navigate(routes.transferOrder(row.id))

  const columns: DataTableColumn<TransferOrderListItemDto>[] = [
    rowNumberColumn<TransferOrderListItemDto>(engine.page, engine.pageSize),
    {
      accessor: 'documentNumber',
      title: 'Number',
      // Per-branch numbers are long ("TRO-BR-003-000012"): the column never truncates one.
      width: 190,
      render: (row) => (
        <>
          <Anchor
            component={Link}
            to={routes.transferOrder(row.id)}
            fz="sm"
            fw={500}
            c={row.documentNumber ? undefined : 'dimmed'}
            style={{ whiteSpace: 'nowrap' }}
            onClick={(event) => event.stopPropagation()}
          >
            {numberText(row)}
          </Anchor>
          {row.returnOfNumber ? (
            <Text fz="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              Return of {row.returnOfNumber}
            </Text>
          ) : null}
        </>
      ),
    },
    { accessor: 'documentDate', title: 'Date', width: 105, render: (row) => dateLabel(row.documentDate) },
    { accessor: 'from', title: 'From', width: 200, render: (row) => warehouseCell(row.from) },
    { accessor: 'to', title: 'To', width: 200, render: (row) => warehouseCell(row.to) },
    { accessor: 'displayStatus', title: 'Status', width: 190, render: statusBadges },
    {
      accessor: 'itemCount',
      title: 'Items',
      width: 80,
      textAlign: 'right',
      render: (row) => formatNumber(row.itemCount),
    },
    {
      accessor: 'orderedBase',
      title: 'Ordered (pcs)',
      width: 130,
      textAlign: 'right',
      render: (row) => formatNumber(row.orderedBase),
    },
    {
      accessor: 'dispatchedBase',
      title: 'Dispatched',
      width: 150,
      render: (row) => progressCell(row.dispatchedBase, row.orderedBase, 'indigo', 'dispatched'),
    },
    {
      accessor: 'receivedBase',
      title: 'Received',
      width: 150,
      render: (row) => progressCell(row.receivedBase, row.orderedBase, 'green', 'received'),
    },
    {
      accessor: 'onTheWayBase',
      title: 'On the way',
      width: 115,
      textAlign: 'right',
      render: (row) => (
        <Text fz="sm" fw={row.onTheWayBase > 0 ? 700 : undefined}>
          {formatNumber(row.onTheWayBase)}
        </Text>
      ),
    },
    {
      accessor: 'expectedArrival',
      title: 'Expected arrival',
      width: 140,
      render: (row) => {
        const late = lateToDispatch(row)
        return (
          <Text fz="sm" c={late ? 'red' : undefined} fw={late ? 700 : undefined}>
            {dateLabel(row.expectedArrival)}
          </Text>
        )
      },
    },
    { accessor: 'referenceNo', title: 'Reference', width: 150, render: (row) => row.referenceNo || '—' },
    { accessor: 'createdByName', title: 'Created by', width: 150, render: (row) => row.createdByName ?? '—' },
  ]

  const newButton = canCreate ? (
    <Button onClick={() => void navigate(routes.newTransferOrder)} data-new-transfer-order>
      + New transfer order
    </Button>
  ) : null

  const empty = !loading && !error && rows.length === 0

  return (
    <div>
      <PageHeader title="Transfer Orders" actions={newButton ?? undefined} />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput
            label="Search"
            placeholder="Number, reference, warehouse or item"
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(event) => setFilter('search', event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Branch"
            placeholder="All branches"
            data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
            value={filters.branchId}
            onChange={(next) => setFilter('branchId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="From"
            placeholder="Any"
            data={warehouseData}
            value={filters.fromWarehouseId}
            onChange={(next) => setFilter('fromWarehouseId', next)}
            clearable
            searchable
            nothingFoundMessage="No warehouse matches"
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="To"
            placeholder="Any"
            data={warehouseData}
            value={filters.toWarehouseId}
            onChange={(next) => setFilter('toWarehouseId', next)}
            clearable
            searchable
            nothingFoundMessage="No warehouse matches"
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Status"
            placeholder="All"
            data={STATUS_DATA}
            value={filters.status}
            onChange={(next) => setFilter('status', next)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date from"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateFrom}
            onChange={(next) => setFilter('dateFrom', next ? isoDate(next) : null)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date to"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateTo}
            onChange={(next) => setFilter('dateTo', next ? isoDate(next) : null)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Switch
            label="On the way only"
            checked={filters.onTheWayOnly}
            onChange={(event) => setFilter('onTheWayOnly', event.currentTarget.checked)}
            pb={8}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Switch
            label="Late only"
            checked={filters.lateOnly}
            onChange={(event) => setFilter('lateOnly', event.currentTarget.checked)}
            pb={8}
          />
        </FilterBar.Col>
        {canApprove && (
          <FilterBar.Col span={2}>
            <Switch
              label="Waiting for approval"
              checked={filters.waitingForApproval}
              onChange={(event) => setFilter('waitingForApproval', event.currentTarget.checked)}
              pb={8}
            />
          </FilterBar.Col>
        )}
        <FilterBar.Col span={2}>
          <Button
            variant="default"
            leftSection={<IconFilterOff size={16} />}
            onClick={grid.clearFilters}
            disabled={unfiltered}
          >
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      {data?.truncated ? (
        <Alert color="yellow" mb="md" title="Showing the newest rows only">
          There are more transfer orders than the grid loads at once. Narrow the list with the filters above (dates,
          status, warehouses) to see the rest.
        </Alert>
      ) : null}

      {empty && unfiltered ? (
        <Paper radius="lg" withBorder p="xl">
          <Stack align="center" gap="sm">
            <Text c="dimmed">No transfer orders yet.</Text>
            {newButton}
          </Stack>
        </Paper>
      ) : phone ? (
        /* A phone: one card per order - its number and badges, the way it goes, how far it went, when it is expected. */
        <Stack gap="sm">
          {empty && (
            <Text c="dimmed" ta="center" py="md">
              No transfer order matches these filters.
            </Text>
          )}
          {engine.pageRows.map((row) => (
            <UnstyledButton key={row.id} onClick={() => open(row)} data-transfer-card={row.id}>
              <Paper withBorder radius="md" p="sm">
                <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
                  <Text
                    fz="sm"
                    fw={600}
                    c={row.documentNumber ? undefined : 'dimmed'}
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    {numberText(row)}
                  </Text>
                  {statusBadges(row)}
                </Group>
                <Text fz="sm" mt={4}>
                  {row.from.code} → {row.to.code}
                </Text>
                <Text fz="sm" c="dimmed">
                  {formatNumber(row.dispatchedBase)} / {formatNumber(row.orderedBase)} dispatched ·{' '}
                  {formatNumber(row.onTheWayBase)} on the way
                </Text>
                <Text fz="xs" c={lateToDispatch(row) ? 'red' : 'dimmed'} fw={lateToDispatch(row) ? 700 : undefined}>
                  Expected arrival {dateLabel(row.expectedArrival)}
                </Text>
              </Paper>
            </UnstyledButton>
          ))}
          {engine.total > engine.pageSize && (
            <Group justify="center">
              <Pagination
                total={Math.ceil(engine.total / engine.pageSize)}
                value={engine.page}
                onChange={engine.setPage}
                size="sm"
              />
            </Group>
          )}
        </Stack>
      ) : (
        <Paper radius="lg" withBorder>
          <DataTable
            storeKey="inventory.transferOrders"
            engine={engine}
            exportFileName="transfer-orders"
            columns={columns}
            fetching={loading}
            noRecordsText={unfiltered ? 'No transfer orders yet.' : 'No transfer order matches these filters.'}
            onRowClick={({ record }) => open(record)}
          />
        </Paper>
      )}

      {rows.length > 0 && (
        <Text size="sm" mt="xs" c="dimmed" data-transfer-summary>
          Orders: {formatNumber(summary.orders)} · On the way: {formatNumber(summary.onTheWay)} pcs · Late orders:{' '}
          {formatNumber(summary.late)}
        </Text>
      )}
    </div>
  )
}
