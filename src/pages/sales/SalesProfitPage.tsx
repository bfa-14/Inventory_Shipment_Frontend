import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Paper, Select, SimpleGrid, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconFileExport, IconFilterOff } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import { brandsApi } from '../../api/masterdata/brands'
import { branchesApi } from '../../api/masterdata/branches'
import { itemFamiliesApi } from '../../api/masterdata/itemFamilies'
import { partiesApi } from '../../api/masterdata/parties'
import {
  SALES_PROFIT_GROUPINGS,
  salesProfitApi,
  showsCogsAdjustments,
  type SalesProfitGrouping,
  type SalesProfitQuery,
  type SalesProfitRowDto,
} from '../../api/sales/profit'
import type {
  BranchLookupDto,
  BrandLookupDto,
  ItemFamilyLookupDto,
  ItemLookupDto,
  PartyLookupDto,
} from '../../api/types'
import { isoDate, money } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { partyLabel } from '../../components/sales/salesLines'
import { columnFilter } from '../../components/ui/columnFilter'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useGridFilters, type ColumnText } from '../../components/ui/gridFilters'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { useGridQuery } from '../../hooks/useGridQuery'
import { brandLabel, familyOptions } from '../inventory/lookups'

interface Filters {
  dateFrom: string | null
  dateTo: string | null
  branchId: string | null
  clientId: string | null
  salesmanId: string | null
  itemFamilyId: string | null
  brandId: string | null
  itemId: string | null
  groupBy: SalesProfitGrouping
}

/**
 * The report opens on THIS MONTH - from the 1st to today. A margin report over all of history is a
 * question nobody asks, and Clear Filters therefore comes back to this month rather than to a blank
 * range that would ask the server for every invoice ever posted.
 */
function currentMonth(): { from: string; to: string } {
  const now = new Date()
  return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(now) }
}

const MONTH = currentMonth()

const NO_FILTERS: Filters = {
  dateFrom: MONTH.from,
  dateTo: MONTH.to,
  branchId: null,
  clientId: null,
  salesmanId: null,
  itemFamilyId: null,
  brandId: null,
  itemId: null,
  groupBy: 'Invoice',
}

const numberOrUndefined = (value: string | null) => (value === null ? undefined : Number(value))

function toQuery(filters: Filters): SalesProfitQuery {
  return {
    dateFrom: filters.dateFrom ?? undefined,
    dateTo: filters.dateTo ?? undefined,
    branchId: numberOrUndefined(filters.branchId),
    clientId: numberOrUndefined(filters.clientId),
    salesmanId: numberOrUndefined(filters.salesmanId),
    itemFamilyId: numberOrUndefined(filters.itemFamilyId),
    brandId: numberOrUndefined(filters.brandId),
    itemId: numberOrUndefined(filters.itemId),
    groupBy: filters.groupBy,
  }
}

/** Everything the report adds up; the percentage is derived from the two totals, never averaged. */
interface Totals {
  invoiceCount: number
  returnCount: number
  quantityBase: number
  grossSalesBase: number
  discountBase: number
  netSalesBase: number
  cogsBase: number
  grossProfitBase: number
  cogsAdjustmentsBase: number
}

const ZERO: Totals = {
  invoiceCount: 0,
  returnCount: 0,
  quantityBase: 0,
  grossSalesBase: 0,
  discountBase: 0,
  netSalesBase: 0,
  cogsBase: 0,
  grossProfitBase: 0,
  cogsAdjustmentsBase: 0,
}

/** "24.50 %", or the blank marker when there were no sales to take a percentage of. */
const percent = (value: number | null) => (value === null ? '—' : `${formatNumber(value, 2)} %`)

/**
 * What each column SHOWS for a row - the text its header filter matches. The figures are matched as
 * the cells format them ("1,250.00", "12.50 %"), so a filter narrows by what is read. No tick lists
 * on this grid: every column but the group is a figure, and its list would be one entry per row.
 */
const COLUMN_TEXT: Record<string, ColumnText<SalesProfitRowDto>> = {
  groupLabel: (r) => r.groupLabel,
  invoiceCount: (r) => formatNumber(r.invoiceCount),
  returnCount: (r) => formatNumber(r.returnCount),
  quantityBase: (r) => formatNumber(r.quantityBase),
  grossSalesBase: (r) => formatNumber(r.grossSalesBase, 2),
  discountBase: (r) => formatNumber(r.discountBase, 2),
  netSalesBase: (r) => formatNumber(r.netSalesBase, 2),
  cogsBase: (r) => formatNumber(r.cogsBase, 2),
  grossProfitBase: (r) => formatNumber(r.grossProfitBase, 2),
  grossProfitPct: (r) => percent(r.grossProfitPct),
  cogsAdjustmentsBase: (r) => formatNumber(r.cogsAdjustmentsBase, 2),
}

/** Sorts on whatever column was clicked: numbers numerically, the group label as text. */
function compareRows(a: SalesProfitRowDto, b: SalesProfitRowDto, key: keyof SalesProfitRowDto): number {
  const left = a[key]
  const right = b[key]
  if (typeof left === 'number' || typeof right === 'number') {
    return (typeof left === 'number' ? left : 0) - (typeof right === 'number' ? right : 0)
  }
  return String(left ?? '').localeCompare(String(right ?? ''))
}

/**
 * What selling the goods earned, grouped the way the reader asks for.
 *
 * The endpoint answers with ONE FLAT LIST - a grouping has as many rows as there are groups - so the
 * page sorts and pages it itself and the totals are taken over every row, not the page on screen.
 */
export function SalesProfitPage() {
  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [clients, setClients] = useState<PartyLookupDto[]>([])
  const [salesmen, setSalesmen] = useState<PartyLookupDto[]>([])
  const [families, setFamilies] = useState<ItemFamilyLookupDto[]>([])
  const [brands, setBrands] = useState<BrandLookupDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])

  const grid = useGridQuery<Filters, SalesProfitRowDto, SalesProfitRowDto[]>({
    initialFilters: NO_FILTERS,
    initialSort: { columnAccessor: 'netSalesBase', direction: 'desc' },
    // One flat list: turning a page or re-sorting must not ask the server for rows it already sent.
    paging: 'client',
    errorMessage: 'The sales profit report could not be loaded.',
    fetcher: useCallback(({ filters: applied, signal }) => salesProfitApi.report(toQuery(applied), signal), []),
  })

  const { filters, setFilter, loading, error } = grid
  const rows = useMemo(() => grid.data ?? [], [grid.data])

  useEffect(() => {
    // Inactive records are offered too: a sale posted last quarter still points at the client or the
    // item that has since been retired, and a report that could not name them would hide those rows.
    branchesApi.lookup(false).then(setBranches).catch(() => {})
    partiesApi.lookup({ partyType: 'Client', activeOnly: false }).then(setClients).catch(() => {})
    partiesApi.lookup({ partyType: 'Salesman', activeOnly: false }).then(setSalesmen).catch(() => {})
    itemFamiliesApi.lookup(false).then(setFamilies).catch(() => {})
    brandsApi.lookup(false).then(setBrands).catch(() => {})
    itemsApi.lookup(false).then(setItems).catch(() => {})
  }, [])

  // A filter that leaves three rows must not strand the reader on page 4 of the old result.
  const columnFilters = useGridFilters(COLUMN_TEXT, () => grid.setPage(1))
  const { apply: applyColumnFilters } = columnFilters

  const sortKey = grid.sortStatus.columnAccessor as keyof SalesProfitRowDto
  const sortDirection = grid.sortStatus.direction

  /** What the funnels left of the report - the rows this page then sorts, pages and totals. */
  const narrowed = useMemo(() => applyColumnFilters(rows), [rows, applyColumnFilters])

  const sorted = useMemo(() => {
    const ordered = [...narrowed].sort((a, b) => compareRows(a, b, sortKey))
    if (sortDirection === 'desc') ordered.reverse()
    return ordered
  }, [narrowed, sortKey, sortDirection])

  const records = sorted.slice((grid.page - 1) * grid.pageSize, grid.page * grid.pageSize)

  const totals = useMemo(
    () =>
      narrowed.reduce<Totals>(
        (sum, row) => ({
          invoiceCount: sum.invoiceCount + row.invoiceCount,
          returnCount: sum.returnCount + row.returnCount,
          quantityBase: sum.quantityBase + row.quantityBase,
          grossSalesBase: sum.grossSalesBase + row.grossSalesBase,
          discountBase: sum.discountBase + row.discountBase,
          netSalesBase: sum.netSalesBase + row.netSalesBase,
          cogsBase: sum.cogsBase + row.cogsBase,
          grossProfitBase: sum.grossProfitBase + row.grossProfitBase,
          cogsAdjustmentsBase: sum.cogsAdjustmentsBase + row.cogsAdjustmentsBase,
        }),
        ZERO,
      ),
    [narrowed],
  )

  // Taken from the two totals rather than averaging the rows' percentages: an invoice worth ten
  // dollars would otherwise weigh as much as one worth ten thousand.
  const totalPct = totals.netSalesBase === 0 ? null : (totals.grossProfitBase / totals.netSalesBase) * 100

  const withAdjustments = showsCogsAdjustments(filters.groupBy)

  async function exportToExcel() {
    try {
      await salesProfitApi.exportToExcel(toQuery(filters))
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The report could not be exported.')
    }
  }

  const amountFooter = (value: number) => (
    <Text fz="sm" fw={700}>
      {formatNumber(value, 2)}
    </Text>
  )

  const countFooter = (value: number) => (
    <Text fz="sm" fw={700}>
      {formatNumber(value)}
    </Text>
  )

  const columns: DataTableColumn<SalesProfitRowDto>[] = [
    {
      accessor: 'groupLabel',
      title: 'Group',
      sortable: true,
      width: 240,
      // The footer sums every row the funnels LEFT, not the page on screen: a total that changed as
      // the reader turned a page would answer no question at all, while one that ignored the funnels
      // would answer a question they had just narrowed away from.
      footer: (
        <Text fz="sm" fw={700}>
          Total ({formatNumber(narrowed.length)} rows)
        </Text>
      ),
      ...columnFilter({ ...columnFilters.bind('groupLabel'), label: 'Group' }),
      render: (row) => (
        <Text fz="sm" fw={500}>
          {row.groupLabel}
        </Text>
      ),
    },
    {
      accessor: 'invoiceCount',
      title: 'Invoices',
      sortable: true,
      width: 90,
      textAlign: 'right',
      footer: countFooter(totals.invoiceCount),
      ...columnFilter({ ...columnFilters.bind('invoiceCount'), label: 'Invoices' }),
      render: (row) => formatNumber(row.invoiceCount),
    },
    {
      accessor: 'returnCount',
      title: 'Returns',
      sortable: true,
      width: 90,
      textAlign: 'right',
      footer: countFooter(totals.returnCount),
      ...columnFilter({ ...columnFilters.bind('returnCount'), label: 'Returns' }),
      render: (row) => formatNumber(row.returnCount),
    },
    {
      accessor: 'quantityBase',
      title: 'Qty',
      sortable: true,
      width: 100,
      textAlign: 'right',
      footer: countFooter(totals.quantityBase),
      ...columnFilter({ ...columnFilters.bind('quantityBase'), label: 'Qty' }),
      render: (row) => formatNumber(row.quantityBase),
    },
    {
      accessor: 'grossSalesBase',
      title: 'Gross Sales (USD)',
      sortable: true,
      width: 140,
      textAlign: 'right',
      footer: amountFooter(totals.grossSalesBase),
      ...columnFilter({ ...columnFilters.bind('grossSalesBase'), label: 'Gross Sales' }),
      render: (row) => formatNumber(row.grossSalesBase, 2),
    },
    {
      accessor: 'discountBase',
      title: 'Discount (USD)',
      sortable: true,
      width: 130,
      textAlign: 'right',
      footer: amountFooter(totals.discountBase),
      ...columnFilter({ ...columnFilters.bind('discountBase'), label: 'Discount' }),
      render: (row) => formatNumber(row.discountBase, 2),
    },
    {
      accessor: 'netSalesBase',
      title: 'Net Sales (USD)',
      sortable: true,
      width: 140,
      textAlign: 'right',
      footer: amountFooter(totals.netSalesBase),
      ...columnFilter({ ...columnFilters.bind('netSalesBase'), label: 'Net Sales' }),
      render: (row) => (
        <Text fz="sm" fw={500}>
          {formatNumber(row.netSalesBase, 2)}
        </Text>
      ),
    },
    {
      accessor: 'cogsBase',
      title: 'COGS (USD)',
      sortable: true,
      width: 130,
      textAlign: 'right',
      footer: amountFooter(totals.cogsBase),
      ...columnFilter({ ...columnFilters.bind('cogsBase'), label: 'COGS' }),
      render: (row) => formatNumber(row.cogsBase, 2),
    },
    {
      accessor: 'grossProfitBase',
      title: 'Gross Profit (USD)',
      sortable: true,
      width: 150,
      textAlign: 'right',
      footer: amountFooter(totals.grossProfitBase),
      ...columnFilter({ ...columnFilters.bind('grossProfitBase'), label: 'Gross Profit' }),
      render: (row) => (
        <Text fz="sm" fw={500} c={row.grossProfitBase < 0 ? 'red' : undefined}>
          {formatNumber(row.grossProfitBase, 2)}
        </Text>
      ),
    },
    {
      accessor: 'grossProfitPct',
      title: 'GP %',
      sortable: true,
      width: 100,
      textAlign: 'right',
      footer: (
        <Text fz="sm" fw={700} c={totalPct !== null && totalPct < 0 ? 'red' : undefined}>
          {percent(totalPct)}
        </Text>
      ),
      ...columnFilter({ ...columnFilters.bind('grossProfitPct'), label: 'GP %' }),
      // Red is the point of the column: a group sold below its own cost is what a margin report is read for.
      render: (row) => (
        <Text fz="sm" c={row.grossProfitPct !== null && row.grossProfitPct < 0 ? 'red' : undefined}>
          {percent(row.grossProfitPct)}
        </Text>
      ),
    },
    // Only where a landed cost adjustment can be attributed: it knows its item and its date, never
    // its invoice, so the column would be a row of zeros on the groupings that cannot carry it.
    ...(withAdjustments
      ? [
          {
            accessor: 'cogsAdjustmentsBase',
            title: 'COGS adjustments (USD)',
            sortable: true,
            width: 180,
            textAlign: 'right',
            footer: amountFooter(totals.cogsAdjustmentsBase),
            ...columnFilter({ ...columnFilters.bind('cogsAdjustmentsBase'), label: 'COGS adjustments' }),
            render: (row: SalesProfitRowDto) => formatNumber(row.cogsAdjustmentsBase, 2),
          } satisfies DataTableColumn<SalesProfitRowDto>,
        ]
      : []),
  ]

  const stat = (label: string, value: string, hint: string, danger = false) => (
    <Paper radius="lg" p="md" withBorder>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fw={700} fz="lg" c={danger ? 'red' : undefined}>
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {hint}
      </Text>
    </Paper>
  )

  return (
    <div>
      <PageHeader
        title="Sales Profit"
        subtitle="Net sales less the cost frozen on each line when the invoice was posted - the figures do not move afterwards."
        actions={
          <Button variant="default" leftSection={<IconFileExport size={16} />} onClick={() => void exportToExcel()}>
            Export to Excel
          </Button>
        }
      />

      <FilterBar>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date from"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateFrom}
            onChange={(next) => setFilter('dateFrom', next)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date to"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateTo}
            onChange={(next) => setFilter('dateTo', next)}
            clearable
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
        <FilterBar.Col span={3}>
          <Select
            label="Client"
            placeholder="All clients"
            data={clients.map((c) => ({ value: String(c.id), label: partyLabel(c) }))}
            value={filters.clientId}
            onChange={(next) => setFilter('clientId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Salesman"
            placeholder="All salesmen"
            data={salesmen.map((s) => ({ value: String(s.id), label: partyLabel(s) }))}
            value={filters.salesmanId}
            onChange={(next) => setFilter('salesmanId', next)}
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
            label="Brand"
            placeholder="All brands"
            data={brands.map((b) => ({ value: String(b.id), label: brandLabel(b) }))}
            value={filters.brandId}
            onChange={(next) => setFilter('brandId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Item"
            placeholder="All items"
            data={items.map((i) => ({ value: String(i.id), label: `${i.itemCode} - ${i.itemName}` }))}
            value={filters.itemId}
            onChange={(next) => setFilter('itemId', next)}
            clearable
            searchable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Group by"
            data={[...SALES_PROFIT_GROUPINGS]}
            value={filters.groupBy}
            // Matched against the list rather than cast: the report has to be grouped by something,
            // so an unknown value keeps the grouping the reader is already looking at.
            onChange={(next) => setFilter('groupBy', SALES_PROFIT_GROUPINGS.find((g) => g === next) ?? filters.groupBy)}
            allowDeselect={false}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Button
            variant="default"
            fullWidth
            mt={25}
            leftSection={<IconFilterOff size={16} />}
            disabled={grid.isDefault}
            onClick={grid.clearFilters}
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

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md" mb="md">
        {stat('Net Sales', money(totals.netSalesBase), 'after discounts, base currency')}
        {stat('COGS', money(totals.cogsBase), 'cost frozen at posting')}
        {stat('Gross Profit', money(totals.grossProfitBase), 'net sales less COGS', totals.grossProfitBase < 0)}
        {stat('GP %', percent(totalPct), 'of net sales', totalPct !== null && totalPct < 0)}
      </SimpleGrid>

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="sales.salesProfit"
          records={records}
          columns={columns}
          idAccessor="groupKey"
          // The count the footer reads from is what the funnels left, not what the report returned.
          totalRecords={narrowed.length}
          filters={{ activeCount: columnFilters.activeCount, clearAll: columnFilters.clearAll }}
          page={grid.page}
          recordsPerPage={grid.pageSize}
          onPageChange={grid.setPage}
          onRecordsPerPageChange={grid.setPageSize}
          sortStatus={grid.sortStatus}
          onSortStatusChange={grid.setSortStatus}
          fetching={loading}
          noRecordsText="No sales were posted in this period."
        />
      </Paper>
    </div>
  )
}
