import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  Alert, Anchor, Badge, Button, Drawer, Group, Loader, MultiSelect, Paper, Select, Stack, Switch, Table, Text, TextInput,
  Tooltip, UnstyledButton,
} from '@mantine/core'
import { DateInput } from '../../components/ui/DateInput'
import { IconAlertTriangle, IconFileExport, IconFilterOff, IconPlayerPlay, IconPrinter, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import { currenciesApi } from '../../api/masterdata/currencies'
import { itemFamiliesApi } from '../../api/masterdata/itemFamilies'
import {
  itemBalanceApi,
  queryFromParams,
  toParams,
  type ItemBalanceMovementsResult,
  type ItemBalanceQuery,
  type ItemBalanceReportResult,
  type ItemBalanceRowDto,
  type ItemBalanceWarehouseDto,
} from '../../api/reports/itemBalance'
import type { CurrencyLookupDto, ItemFamilyLookupDto, ItemLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { dateLabel, stamp } from '../../components/documents/documentKind'
import { stockDocumentRoute } from '../../components/documents/stockDocumentRoute'
import { formatDateTime, formatNumber, todayDateOnly } from '../../components/format'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { familyOptions } from '../inventory/lookups'
import { balanceColumns, cellText, rateText, type BalanceColumn } from './itemBalanceColumns'
import { monthEnd } from '../../components/typedDate'

/** A row of the grid: the answer's row with the texts the grid sorts, filters and groups by. */
type GridRow = ItemBalanceRowDto & { key: string; warehouse: string; location: string; status: string }

/** What the Check column says (and filters and groups by): the first that applies. */
function statusOf(row: ItemBalanceRowDto): string {
  if (!row.integrityOk) return 'Does not add up'
  if (row.isNegative) return 'Negative'
  if (row.isTransit) return 'On the way'
  return 'OK'
}

const ACCESSOR_CHARS: Record<string, string> = { '+': '_in', '-': '_out', ':': '__' }

/** A grid accessor from a column key ("GRN+:qty" -> "GRN_in__qty"): the engine and the chooser key on plain names. */
const accessorOf = (column: BalanceColumn) => column.key.replace(/[^A-Za-z0-9_]/g, (ch) => ACCESSOR_CHARS[ch] ?? '_')

/** The identification columns that hold few values: filtered by ticking values, not by typing. */
const LIST_COLUMNS = new Set(['unit', 'warehouse', 'location'])

const RATE_TYPES = [
  { value: '1', label: 'Official' },
  { value: '2', label: 'Non-official' },
  { value: '3', label: 'Market' },
]

function defaultQuery(): ItemBalanceQuery {
  const today = todayDateOnly()
  return {
    warehouseIds: [],
    dateFrom: `${today.slice(0, 8)}01`,
    dateTo: today,
    currencyId: null,
    rateType: 1,
    itemIds: [],
    familyIds: [],
    showZeroBalance: false,
    hideEmptyColumns: true,
  }
}

/** "WH-001 LUBUMBASHI -Main", indented under its parent, so the tree reads in a flat list. */
function warehouseOptions(warehouses: ItemBalanceWarehouseDto[]) {
  const byParent = new Map<number | null, ItemBalanceWarehouseDto[]>()
  const ids = new Set(warehouses.map((w) => w.id))
  for (const w of warehouses) {
    const parent = w.parentId !== null && ids.has(w.parentId) ? w.parentId : null
    byParent.set(parent, [...(byParent.get(parent) ?? []), w])
  }
  const out: { value: string; label: string }[] = []
  const walk = (parent: number | null, depth: number) => {
    for (const w of byParent.get(parent) ?? []) {
      const tail = [w.hasChildren ? 'and its warehouses' : null, w.isTransit ? 'transfers on the way' : null, w.isActive ? null : 'inactive']
        .filter(Boolean).join(', ')
      out.push({ value: String(w.id), label: `${'· '.repeat(depth)}${w.warehouseCode} ${w.warehouseName}${tail ? ` (${tail})` : ''}` })
      walk(w.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/**
 * Reports › Item Balance Report by Warehouse (script 103): for month-end, each item in each warehouse - the opening on
 * Date From, one quantity and amount per kind of movement in the period (signed: out is negative), the totals in and out,
 * what the average cost did, and the closing on Date To - at the company's average cost, translated into the currency
 * chosen (the opening at the rate of the day before Date From, each movement at its day's, the closing at Date To's).
 *
 * THE FILTERS LIVE IN THE ADDRESS, as on the Attachment Report: what is typed counts once "Run Report" is clicked, and a
 * refresh or a shared link reruns it. Each run is logged by the API with its filters and user.
 *
 * A movement figure opens the documents behind it; a warehouse a sub-location stands under is shown beside it, never
 * rolled up; a row with negative stock is red, a row whose opening and movements do not give the ledger's quantity is
 * flagged, both counted above the table and in the footer.
 */
export function ItemBalanceReportPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const applied = useMemo(() => queryFromParams(params), [params])
  const [draft, setDraft] = useState<ItemBalanceQuery>(() => applied ?? defaultQuery())

  const [warehouses, setWarehouses] = useState<ItemBalanceWarehouseDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])
  const [families, setFamilies] = useState<ItemFamilyLookupDto[]>([])
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])

  const [report, setReport] = useState<ItemBalanceReportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The grid's quick search: item, family, warehouse or location. */
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)

  const [drill, setDrill] = useState<{ row: ItemBalanceRowDto; group: string; label: string } | null>(null)
  const [movements, setMovements] = useState<ItemBalanceMovementsResult | null>(null)
  const [drillError, setDrillError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    itemBalanceApi.warehouses(controller.signal).then(setWarehouses).catch(() => {})
    // Inactive ones too: last year's movements still name them.
    itemsApi.lookup(false).then(setItems).catch(() => {})
    itemFamiliesApi.lookup(false).then(setFamilies).catch(() => {})
    currenciesApi.lookup(false).then(setCurrencies).catch(() => {})
    return () => controller.abort()
  }, [])

  const load = useCallback(async (signal: AbortSignal) => {
    if (!applied) return
    setLoading(true)
    setError(null)
    try {
      const loaded = await itemBalanceApi.report(applied, signal)
      if (signal.aborted) return
      setReport(loaded)
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
      setReport(null)
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The report could not be loaded.')
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [applied])

  useEffect(() => {
    const controller = new AbortController()
    // Fetching is the "synchronize with an external system" case: loading has to show before the await.
    // eslint-disable-next-line react/set-state-in-effect
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  // The drill-down: the documents behind the cell clicked.
  useEffect(() => {
    if (!drill || !applied) return
    const controller = new AbortController()
    itemBalanceApi
      .movements(applied, { itemId: drill.row.itemId, warehouseId: drill.row.warehouseId, group: drill.group || null }, controller.signal)
      .then((answer) => {
        setMovements(answer)
        setDrillError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setDrillError(err instanceof ApiError ? err.message : 'The movements could not be loaded.')
      })
    return () => controller.abort()
  }, [drill, applied])

  const dateError = !draft.dateFrom || !draft.dateTo
    ? 'Enter Date From and Date To.'
    : draft.dateFrom > draft.dateTo ? 'Date From is after Date To.' : null

  function run() {
    if (dateError) return
    const next = toParams(draft)
    setParams(next, { replace: false })
  }

  function reset() {
    setDraft(defaultQuery())
    setReport(null)
    setParams({}, { replace: false })
  }

  async function exportToExcel() {
    if (!applied) return
    setExporting(true)
    try {
      await itemBalanceApi.exportToExcel({ ...applied, hideEmptyColumns: draft.hideEmptyColumns })
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The export could not be made.')
    } finally {
      setExporting(false)
    }
  }

  function print() {
    if (!applied) return
    void navigate(`/reports/item-balance/print?${toParams({ ...applied, hideEmptyColumns: draft.hideEmptyColumns }).toString()}`)
  }

  function openCell(row: ItemBalanceRowDto, column: BalanceColumn) {
    if (column.drill === undefined) return
    setMovements(null)
    setDrillError(null)
    setDrill({ row, group: column.drill, label: column.group })
  }

  // "Hide empty transaction columns" redraws at once: the answer carries every kind of movement with its activity.
  const columns = useMemo(() => (report ? balanceColumns(report, draft.hideEmptyColumns) : []), [report, draft.hideEmptyColumns])
  const decimals = report?.currency?.decimalPlaces ?? 2

  const gridRows = useMemo<GridRow[]>(() => {
    const needle = search.trim().toLowerCase()
    return (report?.rows ?? [])
      .map((r) => ({
        ...r,
        key: `${r.itemId}-${r.warehouseId}`,
        warehouse: `${r.warehouseCode} ${r.warehouseName}`,
        // A warehouse at the top of its tree is its own location here, so grouping by location never makes a blank group.
        location: r.locationCode ? `${r.locationCode} ${r.locationName ?? ''}` : `${r.warehouseCode} ${r.warehouseName}`,
        status: statusOf(r),
      }))
      .filter((r) => !needle || [r.itemCode, r.itemName, r.familyName ?? '', r.warehouse, r.location]
        .some((text) => text.toLowerCase().includes(needle)))
  }, [report, search])

  /*
   * THE GRID ENGINE: sort (Shift-click for a second key), a funnel and a filter row per column, Group by with each group's
   * subtotals, the column chooser, footer totals over the rows the filters leave, CSV of what is on screen. The columns
   * are balanceColumns' (the print page's and the Excel's), flattened: "Sales delivery · Qty".
   */
  const gridMeta = useMemo<GridColumnMeta<GridRow>[]>(() => {
    const meta: GridColumnMeta<GridRow>[] = []
    for (const c of columns) {
      if (c.key === 'warehouse') continue   // not in the grid (the owner's wish): Location names the warehouse
      if (c.kind === 'text') {
        meta.push({ accessor: accessorOf(c), kind: LIST_COLUMNS.has(c.key) ? 'list' : 'text', summary: c.key === 'itemCode' ? 'count' : undefined })
      } else {
        meta.push({
          accessor: accessorOf(c),
          kind: 'number',
          value: (r) => c.value(r) as number | null,
          text: (r) => cellText(c, c.value(r), decimals, false),
          summary: c.total ? 'sum' : undefined,
        })
      }
      if (c.key === 'itemName') meta.push({ accessor: 'familyName', kind: 'list', text: (r) => r.familyName ?? '' })
    }
    meta.push({ accessor: 'status', kind: 'list' })
    return meta
  }, [columns, decimals])

  const engine = useDataGrid({
    rows: gridRows,
    columns: gridMeta,
    storeKey: 'reports.itemBalance',
    pageSize: 100,
    // Grouped by location to start (the owner's wish): one group per warehouse the stock is in, with its subtotals.
    groupBy: 'location',
    sort: [{ accessor: 'location', direction: 'asc' }, { accessor: 'itemCode', direction: 'asc' }],
  })
  const gridColumns: DataTableColumn<GridRow>[] = []
  for (const c of columns) {
    if (c.key === 'warehouse') continue
    gridColumns.push({
      accessor: accessorOf(c),
      title: c.group ? `${c.group} · ${c.header}` : c.header,
      width: c.kind === 'text' ? (c.key === 'itemName' ? 220 : 150) : 120,
      textAlign: c.kind === 'text' ? 'left' : 'right',
      render: (row) => {
        const value = c.key === 'location' ? row.location : c.value(row)
        const text = cellText(c, value, decimals)
        const negative = typeof value === 'number' && value < 0
        if (c.drill !== undefined && text !== '') {
          return (
            <UnstyledButton fz="sm" c={negative ? 'red' : 'blue'} td="underline" onClick={() => openCell(row, c)}>
              {text}
            </UnstyledButton>
          )
        }
        return negative ? <Text span fz="sm" c="red">{text}</Text> : text
      },
    })
    if (c.key === 'itemName') gridColumns.push({ accessor: 'familyName', title: 'Family', width: 140 })
  }
  gridColumns.push({
    accessor: 'status',
    title: 'Check',
    width: 150,
    render: (row) => (
      row.status === 'OK' ? '' : (
        <Tooltip label={row.integrityOk ? row.status : `The ledger holds ${formatNumber(row.ledgerQuantity)} on Date To.`}>
          <Badge color={!row.integrityOk ? 'orange' : row.isNegative ? 'red' : 'gray'} variant="light">{row.status}</Badge>
        </Tooltip>
      )
    ),
  })

  const baseCurrency = currencies.find((c) => c.isBaseCurrency) ?? null
  const chosenCurrency = currencies.find((c) => c.id === draft.currencyId) ?? baseCurrency
  const seesAmounts = report?.seesAmounts ?? true

  return (
    <div>
      <PageHeader
        title="Item Balance Report by Warehouse"
        subtitle="Opening, movements and closing of each item in each warehouse over a period, at the company's average cost. Quantities in the item's base unit, out as negative."
        actions={
          <Group gap="xs">
            <Button variant="default" leftSection={<IconFileExport size={16} />} onClick={() => void exportToExcel()}
              disabled={!report} loading={exporting}>
              Export to Excel
            </Button>
            <Tooltip label="Opens the report for printing; choose “Save as PDF” in the print dialog for a PDF.">
              <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={print} disabled={!report}>
                Print / PDF
              </Button>
            </Tooltip>
          </Group>
        }
      />

      <FilterBar>
        <FilterBar.Col span={4}>
          <MultiSelect
            label="Warehouse"
            placeholder={draft.warehouseIds.length === 0 ? 'All my warehouses' : undefined}
            description="Only your warehouses are offered; a warehouse takes those under it."
            data={warehouseOptions(warehouses)}
            value={draft.warehouseIds.map(String)}
            onChange={(next) => setDraft((d) => ({ ...d, warehouseIds: next.map(Number) }))}
            searchable
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date from"
            required
            valueFormat="DD/MM/YYYY"
            value={draft.dateFrom || null}
            onChange={(next) => setDraft((d) => ({ ...d, dateFrom: next ?? '', ...(next ? { dateTo: monthEnd(next) } : {}) }))}
            error={dateError && !draft.dateFrom ? dateError : undefined}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date to"
            required
            valueFormat="DD/MM/YYYY"
            value={draft.dateTo || null}
            onChange={(next) => setDraft((d) => ({ ...d, dateTo: next ?? '' }))}
            error={dateError && draft.dateFrom ? dateError : undefined}
          />
        </FilterBar.Col>
        {seesAmounts && (
          <>
            <FilterBar.Col span={2}>
              <Select
                label="Currency"
                data={currencies.map((c) => ({ value: String(c.id), label: `${c.currencyCode}${c.isBaseCurrency ? ' (base)' : ''}` }))}
                value={chosenCurrency ? String(chosenCurrency.id) : null}
                onChange={(next) => setDraft((d) => ({ ...d, currencyId: next && Number(next) !== baseCurrency?.id ? Number(next) : null }))}
                allowDeselect={false}
                searchable
              />
            </FilterBar.Col>
            <FilterBar.Col span={2}>
              <Select
                label="Rate type"
                data={RATE_TYPES}
                value={String(draft.rateType)}
                onChange={(next) => setDraft((d) => ({ ...d, rateType: Number(next) || 1 }))}
                allowDeselect={false}
                disabled={!chosenCurrency || chosenCurrency.isBaseCurrency}
              />
            </FilterBar.Col>
          </>
        )}
        <FilterBar.Col span={4}>
          <MultiSelect
            label="Item"
            placeholder={draft.itemIds.length === 0 ? 'All items' : undefined}
            data={items.map((i) => ({ value: String(i.id), label: `${i.itemCode} - ${i.itemName}` }))}
            value={draft.itemIds.map(String)}
            onChange={(next) => setDraft((d) => ({ ...d, itemIds: next.map(Number) }))}
            searchable
            clearable
            limit={100}
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <MultiSelect
            label="Item family"
            placeholder={draft.familyIds.length === 0 ? 'All families' : undefined}
            data={familyOptions(families)}
            value={draft.familyIds.map(String)}
            onChange={(next) => setDraft((d) => ({ ...d, familyIds: next.map(Number) }))}
            searchable
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={5}>
          <Stack gap={6} pt={4}>
            <Switch
              label="Show zero-balance items"
              checked={draft.showZeroBalance}
              onChange={(e) => {
                const checked = e.currentTarget.checked
                setDraft((d) => ({ ...d, showZeroBalance: checked }))
              }}
            />
            <Switch
              label="Hide empty transaction columns"
              checked={draft.hideEmptyColumns}
              onChange={(e) => {
                const checked = e.currentTarget.checked
                setDraft((d) => ({ ...d, hideEmptyColumns: checked }))
              }}
            />
          </Stack>
        </FilterBar.Col>
        <FilterBar.Col span={12}>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={reset}>Clear Filters</Button>
            <Button leftSection={<IconPlayerPlay size={16} />} onClick={run} disabled={dateError !== null} loading={loading}>
              Run Report
            </Button>
          </Group>
        </FilterBar.Col>
      </FilterBar>

      {error && <Alert color="red" mb="md">{error}</Alert>}

      {!applied && !report && (
        <Text c="dimmed" ta="center" py="xl">Choose the warehouses and the period, then Run Report.</Text>
      )}

      {loading && !report && (
        <Group justify="center" py="xl"><Loader /></Group>
      )}

      {report && (
        <Stack gap="sm">
          <Paper withBorder p="sm">
            <Group gap="lg" wrap="wrap">
              <Text fz="sm"><b>Warehouses:</b> {report.warehousesLabel}</Text>
              <Text fz="sm"><b>Period:</b> {dateLabel(report.dateFrom)} to {dateLabel(report.dateTo)}</Text>
              {report.itemsLabel && <Text fz="sm"><b>Items:</b> {report.itemsLabel}</Text>}
              {report.seesAmounts && report.currency ? (
                <Text fz="sm">
                  <b>Currency:</b> {report.currency.currencyCode}
                  {report.currency.isBaseCurrency ? ' (base currency)' : ` · ${report.rateTypeName} rate · opening ${rateText(report, 'opening')} · movements at each day's rate · closing ${rateText(report, 'closing')}`}
                </Text>
              ) : (
                <Text fz="sm" c="dimmed">Quantities only: the amounts need the View item costs permission.</Text>
              )}
              <Text fz="sm" c="dimmed">Run {formatDateTime(report.generatedAtUtc)} by {report.generatedBy}</Text>
            </Group>
          </Paper>

          {report.integrityFailures > 0 && (
            <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
              {report.integrityFailures} row(s) do not add up: their opening and movements do not give the ledger's quantity on
              Date To. They are flagged in the table.
            </Alert>
          )}

          {report.rows.length === 0 ? (
            <Paper withBorder p="xl">
              <Text ta="center" c="dimmed">No data for the selected criteria.</Text>
            </Paper>
          ) : (
            <Stack gap="xs">
              <TextInput
                placeholder="Search item, family, warehouse or location"
                leftSection={<IconSearch size={16} />}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                maw={420}
              />
              <Paper radius="lg" withBorder>
                <DataTable
                  storeKey="reports.itemBalance"
                  engine={engine}
                  exportFileName="item-balance"
                  columns={gridColumns}
                  idAccessor="key"
                  fetching={loading}
                  pinFirstColumn
                  rowClassName={(row) => (!row.integrityOk ? 'app-grid__row--warning' : row.isNegative ? 'app-grid__row--danger' : undefined)}
                  noRecordsText="No row matches the search or the column filters."
                />
              </Paper>
            </Stack>
          )}

          <Stack gap={2}>
            <Text fz="xs" c={report.integrityFailures === 0 ? 'dimmed' : 'orange'}>
              {report.integrityFailures === 0
                ? 'Integrity check: every row’s opening and movements give the ledger’s quantity on Date To.'
                : `Integrity check: ${report.integrityFailures} row(s) do not add up (flagged).`}
            </Text>
            {report.negativeRows > 0 && (
              <Text fz="xs" c="red">{report.negativeRows} row(s) with negative stock, in red, included in the totals.</Text>
            )}
            {report.roundingNotes.map((note) => <Text key={note} fz="xs" c="dimmed">{note}</Text>)}
            {report.seesAmounts && (
              <Text fz="xs" c="dimmed">
                Average cost change: what the company’s average cost did to the row’s stock between the opening and the
                closing (receipts into other warehouses, cost adjustments), so each row adds up and the closings equal Stock
                Valuation.
              </Text>
            )}
          </Stack>
        </Stack>
      )}

      <Drawer
        opened={drill !== null}
        onClose={() => setDrill(null)}
        position="right"
        size="lg"
        title={drill ? `${drill.row.itemCode} in ${drill.row.locationCode ?? drill.row.warehouseCode}: ${drill.label}` : ''}
      >
        {drillError && <Alert color="red">{drillError}</Alert>}
        {!movements && !drillError && <Group justify="center" py="xl"><Loader /></Group>}
        {movements && (
          movements.movements.length === 0 ? (
            <Text c="dimmed">No movement.</Text>
          ) : (
            <Table striped fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Document</Table.Th>
                  <Table.Th>Kind</Table.Th>
                  <Table.Th ta="right">Qty</Table.Th>
                  {seesAmounts && <Table.Th ta="right">Unit cost</Table.Th>}
                  {seesAmounts && <Table.Th ta="right">Amount{movements.currencyCode ? ` (${movements.currencyCode})` : ''}</Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {movements.movements.map((m, i) => {
                  const route = m.documentTypeCode && m.documentId !== null
                    ? stockDocumentRoute({ documentTypeCode: m.documentTypeCode, documentId: m.documentId, transferOrderId: m.transferOrderId }, hasPermission)
                    : null
                  return (
                    <Table.Tr key={`${m.documentNumber}-${i}`}>
                      <Table.Td>{stamp(m.eventAt)}</Table.Td>
                      <Table.Td>
                        {route ? <Anchor component={Link} to={route} fz="sm">{m.documentNumber}</Anchor> : (m.documentNumber ?? '')}
                      </Table.Td>
                      <Table.Td>{m.groupLabel}</Table.Td>
                      <Table.Td ta="right" c={m.quantity < 0 ? 'red' : undefined}>{m.quantity === 0 ? '' : formatNumber(m.quantity)}</Table.Td>
                      {seesAmounts && <Table.Td ta="right">{m.unitCost === null ? '' : formatNumber(m.unitCost, decimals)}</Table.Td>}
                      {seesAmounts && (
                        <Table.Td ta="right" c={(m.amount ?? 0) < 0 ? 'red' : undefined}>{m.amount === null ? '' : formatNumber(m.amount, decimals)}</Table.Td>
                      )}
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          )
        )}
      </Drawer>
    </div>
  )
}
