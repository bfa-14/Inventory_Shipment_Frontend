import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Alert, Anchor, Badge, Button, Group, Paper, Select, SimpleGrid, Switch, Text, TextInput, UnstyledButton } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconFileExport, IconFilterOff, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import {
  containerReportApi,
  type ContainerReportQuery,
  type ContainerReportResult,
  type ContainerReportRowDto,
} from '../../api/logistics/containerReport'
import { branchesApi } from '../../api/masterdata/branches'
import { itemFamiliesApi } from '../../api/masterdata/itemFamilies'
import { partiesApi } from '../../api/masterdata/parties'
import type { BranchLookupDto, ItemFamilyLookupDto, ItemLookupDto, PartyLookupDto } from '../../api/types'
import { formatNumber } from '../../components/format'
import { partyLabel } from '../../components/sales/salesLines'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { useGridQuery } from '../../hooks/useGridQuery'
import { familyOptions } from '../inventory/lookups'

interface Filters {
  search: string
  supplierId: string | null
  itemId: string | null
  itemFamilyId: string | null
  branchId: string | null
  orderDateFrom: string | null
  orderDateTo: string | null
  offloadedFrom: string | null
  offloadedTo: string | null
  includePending: boolean
  includeReceived: boolean
}

const NO_FILTERS: Filters = {
  search: '',
  supplierId: null,
  itemId: null,
  itemFamilyId: null,
  branchId: null,
  orderDateFrom: null,
  orderDateTo: null,
  offloadedFrom: null,
  offloadedTo: null,
  includePending: true,
  includeReceived: true,
}

const numberOrUndefined = (value: string | null) => (value === null ? undefined : Number(value))

function toQuery(filters: Filters): ContainerReportQuery {
  return {
    search: filters.search.trim() || undefined,
    supplierId: numberOrUndefined(filters.supplierId),
    itemId: numberOrUndefined(filters.itemId),
    itemFamilyId: numberOrUndefined(filters.itemFamilyId),
    branchId: numberOrUndefined(filters.branchId),
    orderDateFrom: filters.orderDateFrom ?? undefined,
    orderDateTo: filters.orderDateTo ?? undefined,
    offloadedFrom: filters.offloadedFrom ?? undefined,
    offloadedTo: filters.offloadedTo ?? undefined,
    includePending: filters.includePending,
    includeReceived: filters.includeReceived,
  }
}

/**
 * "12/10/2026": the API sends a calendar date as "2026-10-12T00:00:00". Built from its parts, so a reader west of
 * Greenwich never sees the day before, and always day / month / year, as the tracking sheet and the export write it.
 */
function dateText(value: string | null): string {
  if (!value) return ''
  const [year, month, day] = value.slice(0, 10).split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

/** The raw value a date column sorts and compares by: the "yyyy-MM-dd" part. */
const dateValue = (value: string | null) => (value ? value.slice(0, 10) : null)

const chargeAccessor = (id: number) => `charge_${id}`

const amount = (value: number | null) => (value === null ? '' : formatNumber(value, 2))

/** A figure that moves until the goods are received: grey, with "est." after it. */
function Estimate({ value, estimate, decimals = 2 }: { value: number | null; estimate: boolean; decimals?: number }) {
  if (value === null) return null
  return estimate ? (
    <Text fz="sm" c="dimmed" fs="italic" span>
      {formatNumber(value, decimals)} est.
    </Text>
  ) : (
    <>{formatNumber(value, decimals)}</>
  )
}

const ALERT_COLOURS: Record<string, string> = {
  Late: 'red',
  'Free time over': 'red',
  'Not invoiced': 'orange',
  'Not paid': 'orange',
  'Partly paid': 'yellow',
  'No container no.': 'gray',
  'No B/L': 'gray',
}

/** One tile per stage: its lines, containers, pieces and value. */
interface StageTile {
  label: string
  sort: number
  lines: number
  containers: number
  quantity: number
  value: number
}

/**
 * Reports › Container Report: every container and every order still to load, with its order, PI, invoices, payments,
 * journey, charges and cost, GROUPED BY WHERE THE GOODS ARE NOW - the purchasing team's tracking sheet, worked out from
 * the movements, goods receipts, invoices, payments and charges instead of typed and moved by hand.
 *
 * The endpoint answers with the whole report: the grid groups it by stage (each group with its own totals), the tiles
 * above narrow it to one stage, and the footer totals every row the filters left.
 */
export function ContainerReportPage() {
  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])
  const [families, setFamilies] = useState<ItemFamilyLookupDto[]>([])
  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [stage, setStage] = useState<string | null>(null)

  const grid = useGridQuery<Filters, ContainerReportRowDto, ContainerReportResult>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'stageLabel', direction: 'asc' },
    paging: 'client',
    errorMessage: 'The container report could not be loaded.',
    fetcher: useCallback(({ filters: applied, signal }) => containerReportApi.report(toQuery(applied), signal), []),
  })

  const { filters, setFilter, loading, error } = grid
  const result = grid.data
  const allRows = useMemo(() => result?.rows ?? [], [result])
  const chargeTypes = useMemo(() => result?.chargeTypes ?? [], [result])
  const chargesVisible = result?.chargesVisible ?? false
  const paymentsVisible = result?.paymentsVisible ?? false

  useEffect(() => {
    // Inactive records too: a container received last year still names the supplier or item retired since.
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setSuppliers).catch(() => {})
    itemsApi.lookup(false).then(setItems).catch(() => {})
    itemFamiliesApi.lookup(false).then(setFamilies).catch(() => {})
    branchesApi.lookup(false).then(setBranches).catch(() => {})
  }, [])

  const tiles = useMemo(() => {
    const byStage = new Map<string, StageTile & { ids: Set<number> }>()
    for (const row of allRows) {
      const tile = byStage.get(row.stageLabel) ?? {
        label: row.stageLabel, sort: row.stageSort, lines: 0, containers: 0, quantity: 0, value: 0, ids: new Set<number>(),
      }
      tile.lines += 1
      tile.quantity += row.quantity
      tile.value += row.totalExpensesBase ?? 0
      if (row.containerId !== null) tile.ids.add(row.containerId)
      tile.containers = tile.ids.size
      tile.sort = Math.min(tile.sort, row.stageSort)
      byStage.set(row.stageLabel, tile)
    }
    return [...byStage.values()].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
  }, [allRows])

  // A stage picked on a tile that the new answer no longer has would leave an empty grid nobody asked for.
  const activeStage = stage !== null && tiles.some((t) => t.label === stage) ? stage : null
  const rows = useMemo(
    () => (activeStage === null ? allRows : allRows.filter((r) => r.stageLabel === activeStage)),
    [allRows, activeStage],
  )

  const gridColumns = useMemo<GridColumnMeta<ContainerReportRowDto>[]>(
    () => [
      { accessor: 'containerRef', summary: 'count' },
      // The stage leads the order and names the groups: sorted by its place in the journey, shown by its words.
      { accessor: 'stageLabel', value: (r) => r.stageSort, text: (r) => r.stageLabel },
      { accessor: 'orderDate', kind: 'date', value: (r) => dateValue(r.orderDate), text: (r) => dateText(r.orderDate) },
      { accessor: 'invoiceDates' },
      { accessor: 'orderMonth' },
      { accessor: 'containerNo' },
      { accessor: 'quantity', kind: 'number', summary: 'sum', text: (r) => formatNumber(r.quantity) },
      { accessor: 'model' },
      { accessor: 'piNumber' },
      { accessor: 'exporterReferences' },
      { accessor: 'commercialInvoiceNos' },
      { accessor: 'fobAmountBase', kind: 'number', summary: 'sum', text: (r) => amount(r.fobAmountBase) },
      { accessor: 'oilQtyPerUnit', kind: 'number', text: (r) => (r.oilQtyPerUnit === null ? '' : formatNumber(r.oilQtyPerUnit, 2)) },
      ...(paymentsVisible
        ? [{ accessor: 'paidDates' }, { accessor: 'paymentReferences' }, { accessor: 'paymentStatus', kind: 'list' as const }]
        : []),
      { accessor: 'dispatchDate', kind: 'date', value: (r) => dateValue(r.dispatchDate), text: (r) => dateText(r.dispatchDate) },
      { accessor: 'arrivedPortDate', kind: 'date', value: (r) => dateValue(r.arrivedPortDate), text: (r) => dateText(r.arrivedPortDate) },
      { accessor: 'leftPortDate', kind: 'date', value: (r) => dateValue(r.leftPortDate), text: (r) => dateText(r.leftPortDate) },
      { accessor: 'finalDestination', kind: 'list' },
      { accessor: 'trucks' },
      { accessor: 'offloadedDate', kind: 'date', value: (r) => dateValue(r.offloadedDate), text: (r) => dateText(r.offloadedDate) },
      { accessor: 'leadTimeMonths', kind: 'number', text: (r) => (r.leadTimeMonths === null ? '' : formatNumber(r.leadTimeMonths, 2)) },
      { accessor: 'blNo' },
      { accessor: 'feriNo' },
      ...(chargesVisible
        ? [
            { accessor: 'transportReferences' },
            { accessor: 'transportInvoices' },
            { accessor: 'transportBase', kind: 'number' as const, summary: 'sum' as const, text: (r: ContainerReportRowDto) => amount(r.transportBase) },
            ...chargeTypes.map((t) => ({
              accessor: chargeAccessor(t.id),
              kind: 'number' as const,
              summary: 'sum' as const,
              value: (r: ContainerReportRowDto) => r.charges?.[String(t.id)] ?? null,
              text: (r: ContainerReportRowDto) => amount(r.charges?.[String(t.id)] ?? null),
            })),
            { accessor: 'chargesBase', kind: 'number' as const, summary: 'sum' as const, text: (r: ContainerReportRowDto) => amount(r.chargesBase) },
          ]
        : []),
      { accessor: 'totalExpensesBase', kind: 'number', summary: 'sum', text: (r) => amount(r.totalExpensesBase) },
      { accessor: 'costPerUnitBase', kind: 'number', text: (r) => amount(r.costPerUnitBase) },
      { accessor: 'statusName', kind: 'list' },
      { accessor: 'poNumber' },
      { accessor: 'invoiceNumbers' },
      { accessor: 'goodsReceiptNumbers' },
      { accessor: 'supplierName', kind: 'list' },
      { accessor: 'warehouseCode', kind: 'list' },
      { accessor: 'alerts', kind: 'list', text: (r) => r.alerts.join(', '), sortable: false },
    ],
    [chargeTypes, chargesVisible, paymentsVisible],
  )

  const engine = useDataGrid({
    rows,
    columns: gridColumns,
    storeKey: 'logistics.containerReport',
    pageSize: 100,
    groupBy: 'stageLabel',
    sort: [{ accessor: 'stageLabel', direction: 'asc' }, { accessor: 'containerRef', direction: 'asc' }],
  })

  async function exportToExcel() {
    try {
      await containerReportApi.exportToExcel(toQuery(filters))
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The report could not be exported.')
    }
  }

  const text = (value: string | null, width?: number) => (
    <Text fz="sm" lineClamp={2} maw={width}>
      {value ?? ''}
    </Text>
  )

  const columns: DataTableColumn<ContainerReportRowDto>[] = [
    {
      accessor: 'containerRef',
      title: 'CON. REF.',
      width: 130,
      render: (r) =>
        r.containerId !== null ? (
          <Anchor component={Link} to={`/logistics/containers/${r.containerId}`} fz="sm" fw={500}>
            {r.containerRef}
          </Anchor>
        ) : (
          <Text fz="sm" c="dimmed" fs="italic">
            Not loaded
          </Text>
        ),
    },
    { accessor: 'stageLabel', title: 'STAGE', width: 220, render: (r) => text(r.stageLabel, 220) },
    { accessor: 'orderDate', title: 'ORDER DATE', width: 110, render: (r) => dateText(r.orderDate) },
    { accessor: 'invoiceDates', title: 'INVOICE DATE', width: 120, render: (r) => text(r.invoiceDates) },
    { accessor: 'orderMonth', title: 'ORDER MONTH', width: 100 },
    { accessor: 'containerNo', title: 'CONTAINER N°', width: 130 },
    { accessor: 'quantity', title: 'QTY.', width: 80, textAlign: 'right', render: (r) => formatNumber(r.quantity) },
    { accessor: 'model', title: 'MODEL', width: 200, render: (r) => text(r.model, 200) },
    { accessor: 'piNumber', title: 'PI N°', width: 150, render: (r) => text(r.piNumber, 150) },
    { accessor: 'exporterReferences', title: "PI EXPORTER'S REF.", width: 140, render: (r) => text(r.exporterReferences, 140) },
    { accessor: 'commercialInvoiceNos', title: 'INVOICE N°', width: 130, render: (r) => text(r.commercialInvoiceNos, 130) },
    {
      accessor: 'fobAmountBase',
      title: 'FOB PRICE',
      width: 130,
      textAlign: 'right',
      render: (r) => <Estimate value={r.fobAmountBase} estimate={r.fobIsEstimate} />,
    },
    {
      accessor: 'oilQtyPerUnit',
      title: 'OIL (L / UNIT)',
      width: 100,
      textAlign: 'right',
      render: (r) => (r.oilQtyPerUnit === null ? '' : formatNumber(r.oilQtyPerUnit, 2)),
    },
    ...(paymentsVisible
      ? ([
          { accessor: 'paidDates', title: 'PAID DATE', width: 120, render: (r) => text(r.paidDates) },
          { accessor: 'paymentReferences', title: 'PAYMENT REFERENCE NUMBER', width: 190, render: (r) => text(r.paymentReferences, 190) },
          { accessor: 'paymentStatus', title: 'PAYMENT STATUS', width: 120 },
        ] satisfies DataTableColumn<ContainerReportRowDto>[])
      : []),
    { accessor: 'dispatchDate', title: 'DISPATCH DATE (SEA)', width: 120, render: (r) => dateText(r.dispatchDate) },
    { accessor: 'arrivedPortDate', title: 'ARRIVED IN PORT DATE', width: 120, render: (r) => dateText(r.arrivedPortDate) },
    { accessor: 'leftPortDate', title: 'LEFT PORT DATE', width: 120, render: (r) => dateText(r.leftPortDate) },
    { accessor: 'finalDestination', title: 'FINAL DESTINATION', width: 180, render: (r) => text(r.finalDestination, 180) },
    { accessor: 'trucks', title: 'TRUCK #', width: 150, render: (r) => text(r.trucks, 150) },
    { accessor: 'offloadedDate', title: 'OFFLOADED DATE', width: 120, render: (r) => dateText(r.offloadedDate) },
    {
      accessor: 'leadTimeMonths',
      title: 'LEAD TIME (MONTHS)',
      width: 110,
      textAlign: 'right',
      render: (r) =>
        r.leadTimeMonths === null ? null : r.leadTimeSoFar ? (
          <Text fz="sm" c="dimmed" fs="italic" span>
            {formatNumber(r.leadTimeMonths, 2)} so far
          </Text>
        ) : (
          formatNumber(r.leadTimeMonths, 2)
        ),
    },
    { accessor: 'blNo', title: 'B.L.', width: 150 },
    { accessor: 'feriNo', title: 'FERI', width: 110 },
    ...(chargesVisible
      ? ([
          { accessor: 'transportReferences', title: 'F.A. INVOICE REFERENCE', width: 150, render: (r) => text(r.transportReferences, 150) },
          { accessor: 'transportInvoices', title: 'TRANSPORT INVOICES', width: 260, render: (r) => text(r.transportInvoices, 260) },
          { accessor: 'transportBase', title: 'TOTAL TRANSPORT AMOUNT', width: 130, textAlign: 'right', render: (r) => amount(r.transportBase) },
          ...chargeTypes.map(
            (t): DataTableColumn<ContainerReportRowDto> => ({
              accessor: chargeAccessor(t.id),
              title: t.chargeName.toUpperCase(),
              width: 120,
              textAlign: 'right',
              render: (r) => amount(r.charges?.[String(t.id)] ?? null),
            }),
          ),
          { accessor: 'chargesBase', title: 'TOTAL CHARGES', width: 130, textAlign: 'right', render: (r) => amount(r.chargesBase) },
        ] satisfies DataTableColumn<ContainerReportRowDto>[])
      : []),
    {
      accessor: 'totalExpensesBase',
      title: 'TOTAL EXPENSES',
      width: 140,
      textAlign: 'right',
      render: (r) => <Estimate value={r.totalExpensesBase} estimate={r.fobIsEstimate} />,
    },
    {
      accessor: 'costPerUnitBase',
      title: 'COST PER UNIT',
      width: 130,
      textAlign: 'right',
      render: (r) => <Estimate value={r.costPerUnitBase} estimate={r.costIsEstimate} />,
    },
    { accessor: 'statusName', title: 'STATUS', width: 110 },
    {
      accessor: 'poNumber',
      title: 'PO N°',
      width: 150,
      render: (r) => (
        <Anchor component={Link} to={`/purchase/orders/${r.purchaseOrderId}`} fz="sm">
          {r.poNumber ?? 'Order'}
        </Anchor>
      ),
    },
    { accessor: 'invoiceNumbers', title: 'SYSTEM INVOICE N°', width: 170, render: (r) => text(r.invoiceNumbers, 170) },
    { accessor: 'goodsReceiptNumbers', title: 'GOODS RECEIPT N°', width: 170, render: (r) => text(r.goodsReceiptNumbers, 170) },
    { accessor: 'supplierName', title: 'SUPPLIER', width: 160, render: (r) => text(r.supplierName, 160) },
    { accessor: 'warehouseCode', title: 'WAREHOUSE', width: 110 },
    {
      accessor: 'alerts',
      title: 'ALERTS',
      width: 220,
      render: (r) => (
        <Group gap={4}>
          {r.alerts.map((a) => (
            <Badge key={a} size="xs" variant="light" color={ALERT_COLOURS[a] ?? 'gray'}>
              {a}
            </Badge>
          ))}
        </Group>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Container Report"
        subtitle="Every container and every order still to load, with its order, invoices, payments, journey, charges and cost, by where the goods are now. Amounts in the base currency; est. = an estimate until the goods are received."
        actions={
          <Button variant="default" leftSection={<IconFileExport size={16} />} onClick={() => void exportToExcel()}>
            Export to Excel
          </Button>
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput
            label="Search"
            placeholder="Container, B/L, order, PI, invoice"
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(event) => setFilter('search', event.currentTarget.value)}
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Supplier"
            placeholder="All suppliers"
            data={suppliers.map((s) => ({ value: String(s.id), label: partyLabel(s) }))}
            value={filters.supplierId}
            onChange={(next) => setFilter('supplierId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Model / Item"
            placeholder="All items"
            data={items.map((i) => ({ value: String(i.id), label: `${i.itemCode} - ${i.itemName}` }))}
            value={filters.itemId}
            onChange={(next) => setFilter('itemId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Family"
            placeholder="All families"
            data={familyOptions(families)}
            value={filters.itemFamilyId}
            onChange={(next) => setFilter('itemFamilyId', next)}
            clearable
            searchable
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
          <DateInput
            label="Order date from"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.orderDateFrom}
            onChange={(next) => setFilter('orderDateFrom', next)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Order date to"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.orderDateTo}
            onChange={(next) => setFilter('orderDateTo', next)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Offloaded from"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.offloadedFrom}
            onChange={(next) => setFilter('offloadedFrom', next)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Offloaded to"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.offloadedTo}
            onChange={(next) => setFilter('offloadedTo', next)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Button
            variant="default"
            fullWidth
            mt={25}
            leftSection={<IconFilterOff size={16} />}
            disabled={grid.isDefault && activeStage === null}
            onClick={() => {
              grid.clearFilters()
              setStage(null)
            }}
          >
            Clear Filters
          </Button>
        </FilterBar.Col>
        <FilterBar.Col span={6}>
          <Group gap="lg" mt={8}>
            <Switch
              label="Orders still to load"
              checked={filters.includePending}
              onChange={(event) => setFilter('includePending', event.currentTarget.checked)}
            />
            <Switch
              label="Received containers"
              checked={filters.includeReceived}
              onChange={(event) => setFilter('includeReceived', event.currentTarget.checked)}
            />
          </Group>
        </FilterBar.Col>
      </FilterBar>

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      {tiles.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="sm" mb="md">
          {tiles.map((tile) => {
            const selected = activeStage === tile.label
            return (
              <UnstyledButton
                key={tile.label}
                onClick={() => setStage(selected ? null : tile.label)}
                aria-pressed={selected}
              >
                <Paper radius="lg" p="sm" withBorder style={selected ? { borderColor: 'var(--mantine-color-blue-6)', borderWidth: 2 } : undefined}>
                  <Text size="sm" fw={600} lineClamp={1}>
                    {tile.label}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {formatNumber(tile.containers)} containers · {formatNumber(tile.lines)} lines · {formatNumber(tile.quantity)} pcs
                  </Text>
                  <Text fw={700} fz="md">
                    {formatNumber(tile.value, 2)}
                  </Text>
                </Paper>
              </UnstyledButton>
            )
          })}
        </SimpleGrid>
      )}

      <Text fz="xs" c="dimmed" mb="xs">
        {activeStage === null
          ? 'Click a stage to show only its rows. Grey "est." figures move until the goods are received; a lead time "so far" is counted to today.'
          : `Showing ${activeStage} only. Click it again to show every stage.`}
      </Text>

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="logistics.containerReport"
          engine={engine}
          exportFileName="container-report"
          columns={columns}
          idAccessor="rowKey"
          fetching={loading}
          pinFirstColumn
          noRecordsText="No container or order matches these filters."
        />
      </Paper>
    </div>
  )
}
