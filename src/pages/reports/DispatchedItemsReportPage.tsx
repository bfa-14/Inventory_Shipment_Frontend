import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  Alert, Anchor, Badge, Button, Drawer, Group, Loader, Paper, SegmentedControl, Select, SimpleGrid, Stack, Table, Text,
  TextInput, Tooltip, UnstyledButton,
} from '@mantine/core'
import { IconFileExport, IconFilterOff, IconPlayerPlay, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import { itemFamiliesApi } from '../../api/masterdata/itemFamilies'
import { partiesApi } from '../../api/masterdata/parties'
import {
  dispatchedItemsReportApi,
  LOCATION_TEXT,
  queryFromParams,
  toParams,
  type DispatchedItemDto,
  type DispatchedItemsQuery,
  type DispatchedItemsReportResult,
  type DispatchedLocation,
  type DispatchedRowDto,
} from '../../api/reports/dispatchedItems'
import type { ItemFamilyLookupDto, ItemLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { dateLabel } from '../../components/documents/documentKind'
import { formatDateTime, formatNumber, todayDateOnly } from '../../components/format'
import { partyLabel } from '../../components/sales/salesLines'
import { monthEnd } from '../../components/typedDate'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { DateInput } from '../../components/ui/DateInput'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { COUNTRIES } from '../../data/countries'
import { PERMISSIONS } from '../../navigation'
import { familyOptions } from '../inventory/lookups'

type View = 'balance' | 'details'

/** A row of the item balance grid: the item and the texts the grid sorts, filters and groups by. */
type BalanceRow = DispatchedItemDto & { family: string }

/** A row of the items / containers grid. */
type DetailRow = DispatchedRowDto & { item: string; where: string; oil: number | null }

const LOCATION_COLOR: Record<DispatchedLocation, string> = { AtSea: 'blue', AtPort: 'cyan', OnTheRoad: 'orange', Offloaded: 'green' }

function defaultQuery(): DispatchedItemsQuery {
  const today = todayDateOnly()
  const from = `${today.slice(0, 8)}01`
  return {
    dispatchFrom: from,
    dispatchTo: monthEnd(from),
    loadingCountry: 'IN',
    supplierId: null,
    itemFamilyId: null,
    itemId: null,
    search: '',
    location: 'All',
  }
}

const money = (value: number | null | undefined) => (value === null || value === undefined ? '' : formatNumber(value, 2))
const count = (value: number | null | undefined) => (value === null || value === undefined ? '' : formatNumber(value))
const oilText = (qty: number | null, included: boolean | null) => (qty !== null ? formatNumber(qty, 2) : included ? 'Included' : '')

/**
 * Reports › Dispatched Items (script 106): the items dispatched in a period - from India by default - the purchasing
 * team's "DISPATCH FROM INDIA" sheet, worked out by the system, in two views:
 * - ITEM BALANCE: one row per item (containers, pieces, FOB, oil, the oil deduction, and where its pieces are now),
 *   grouped by top family, so the vehicles are added up apart from the spare parts. A row opens the item's containers.
 * - ITEMS / CONTAINERS: one row per container line, grouped by item, with the sheet's columns.
 *
 * THE FILTERS LIVE IN THE ADDRESS, as on the other reports: what is typed counts once "Run Report" is clicked. The oil
 * deduction needs View Container Charges, the payment columns View Supplier Payments: the server sends them empty to
 * others and the page draws none.
 */
export function DispatchedItemsReportPage() {
  const [params, setParams] = useSearchParams()
  const { hasPermission } = useAuth()
  const applied = useMemo(() => queryFromParams(params), [params])
  const [draft, setDraft] = useState<DispatchedItemsQuery>(() => applied ?? defaultQuery())
  const view: View = params.get('view') === 'details' ? 'details' : 'balance'

  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])
  const [families, setFamilies] = useState<ItemFamilyLookupDto[]>([])
  const [report, setReport] = useState<DispatchedItemsReportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [opened, setOpened] = useState<DetailRow | null>(null)

  useEffect(() => {
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setSuppliers).catch(() => {})
    itemsApi.lookup(false).then(setItems).catch(() => {})
    itemFamiliesApi.lookup(false).then(setFamilies).catch(() => {})
  }, [])

  const load = useCallback(async (signal: AbortSignal) => {
    if (!applied) return
    setLoading(true)
    setError(null)
    try {
      const loaded = await dispatchedItemsReportApi.report(applied, signal)
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

  const formError = !draft.dispatchFrom || !draft.dispatchTo
    ? 'Choose the dispatch date from and to.'
    : draft.dispatchFrom > draft.dispatchTo ? 'Date From is after Date To.' : null

  function setView(next: View) {
    setParams((current) => {
      const p = new URLSearchParams(current)
      if (next === 'details') p.set('view', 'details')
      else p.delete('view')
      return p
    }, { replace: true })
  }

  function run() {
    if (formError) return
    const p = toParams(draft)
    if (view === 'details') p.set('view', 'details')
    setParams(p, { replace: false })
  }

  function reset() {
    setDraft(defaultQuery())
    setReport(null)
    setSearch('')
    setParams({}, { replace: false })
  }

  async function exportToExcel() {
    if (!applied) return
    setExporting(true)
    try {
      await dispatchedItemsReportApi.exportToExcel(applied)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The export could not be made.')
    } finally {
      setExporting(false)
    }
  }

  const seesDeduction = report?.deductionVisible ?? true
  const seesPayments = report?.paymentsVisible ?? true
  const deductionName = report?.deductionName ?? 'Oil deduction'
  const canOpenContainers = hasPermission(PERMISSIONS.containersView)
  const base = report?.baseCurrencyCode ?? 'USD'

  /* ── view 1: the item balance ───────────────────────────────────────────────────────────── */

  const balanceRows = useMemo<BalanceRow[]>(
    () => (report?.items ?? []).map((i) => ({ ...i, family: i.rootFamilyName ?? 'No family' })),
    [report],
  )

  const balanceMeta = useMemo<GridColumnMeta<BalanceRow>[]>(() => {
    const meta: GridColumnMeta<BalanceRow>[] = [
      { accessor: 'itemCode' },
      { accessor: 'itemName' },
      { accessor: 'family', kind: 'list' },
      { accessor: 'itemFamilyName', kind: 'list', text: (r) => r.itemFamilyName ?? '' },
      { accessor: 'containers', kind: 'number', summary: 'sum' },
      { accessor: 'quantity', kind: 'number', summary: 'sum' },
      { accessor: 'fobAmountBase', kind: 'number', text: (r) => money(r.fobAmountBase), summary: 'sum' },
      { accessor: 'fobPerUnitBase', kind: 'number', text: (r) => money(r.fobPerUnitBase) },
      { accessor: 'oilQty', kind: 'number', text: (r) => oilText(r.oilQty, r.oilIncludedLines > 0), summary: 'sum' },
    ]
    if (seesDeduction) meta.push({ accessor: 'deductionBase', kind: 'number', text: (r) => money(r.deductionBase), summary: 'sum' })
    meta.push(
      { accessor: 'atSea', kind: 'number', summary: 'sum' },
      { accessor: 'atPort', kind: 'number', summary: 'sum' },
      { accessor: 'onTheRoad', kind: 'number', summary: 'sum' },
      { accessor: 'offloaded', kind: 'number', summary: 'sum' },
    )
    return meta
  }, [seesDeduction])

  const balance = useDataGrid({
    rows: balanceRows,
    columns: balanceMeta,
    storeKey: 'reports.dispatchedItems.balance',
    pageSize: 100,
    // Grouped by top family: the vehicles are added up apart from the spare parts, as the team's "QTY (MOTOS)".
    groupBy: 'family',
    sort: [{ accessor: 'itemCode', direction: 'asc' }],
  })

  function openItem(row: BalanceRow) {
    setSearch(row.itemCode)
    setView('details')
  }

  const balanceColumns: DataTableColumn<BalanceRow>[] = [
    {
      accessor: 'itemCode',
      title: 'Item',
      width: 130,
      render: (r) => (
        <Tooltip label="Its containers">
          <UnstyledButton fz="sm" c="blue" td="underline" onClick={() => openItem(r)}>{r.itemCode}</UnstyledButton>
        </Tooltip>
      ),
    },
    { accessor: 'itemName', title: 'Model', width: 220 },
    { accessor: 'family', title: 'Top family', width: 170, defaultToggle: false },
    { accessor: 'itemFamilyName', title: 'Family', width: 150, defaultToggle: false },
    { accessor: 'containers', title: 'Containers', width: 110, textAlign: 'right' },
    { accessor: 'quantity', title: 'Qty', width: 100, textAlign: 'right', render: (r) => count(r.quantity) },
    {
      accessor: 'fobAmountBase',
      title: `FOB value (${base})`,
      width: 150,
      textAlign: 'right',
      render: (r) => (
        <Text span fz="sm" fs={r.fobIsEstimate ? 'italic' : undefined} c={r.fobIsEstimate ? 'dimmed' : undefined}>{money(r.fobAmountBase)}</Text>
      ),
    },
    { accessor: 'fobPerUnitBase', title: 'FOB / unit', width: 110, textAlign: 'right', render: (r) => money(r.fobPerUnitBase) },
    { accessor: 'oilQty', title: 'Oil qty', width: 100, textAlign: 'right', render: (r) => oilText(r.oilQty, r.oilIncludedLines > 0) },
  ]
  if (seesDeduction) {
    balanceColumns.push({ accessor: 'deductionBase', title: deductionName, width: 150, textAlign: 'right', render: (r) => money(r.deductionBase) })
  }
  balanceColumns.push(
    { accessor: 'atSea', title: 'At sea', width: 90, textAlign: 'right', render: (r) => count(r.atSea) },
    { accessor: 'atPort', title: 'At port', width: 90, textAlign: 'right', render: (r) => count(r.atPort) },
    { accessor: 'onTheRoad', title: 'On the road', width: 110, textAlign: 'right', render: (r) => count(r.onTheRoad) },
    { accessor: 'offloaded', title: 'Offloaded', width: 100, textAlign: 'right', render: (r) => count(r.offloaded) },
  )

  /* ── view 2: the items / containers ─────────────────────────────────────────────────────── */

  const detailRows = useMemo<DetailRow[]>(() => {
    const needle = search.trim().toLowerCase()
    return (report?.rows ?? [])
      .map((r) => ({
        ...r,
        item: `${r.itemCode} · ${r.model}`,
        where: LOCATION_TEXT[report?.locations[r.rowKey] ?? 'AtSea'],
        oil: r.totalOilQty,
      }))
      .filter((r) => !needle || [r.itemCode, r.model, r.containerRef ?? '', r.containerNo ?? '', r.poNumber ?? '', r.piNumber ?? '',
        r.commercialInvoiceNos ?? '', r.exporterReferences ?? '', r.blNo ?? '', r.stageLabel, r.finalDestination ?? '']
        .some((text) => text.toLowerCase().includes(needle)))
  }, [report, search])

  const dateText = (value: string | null) => (value ? dateLabel(value) : '')

  const detailMeta = useMemo<GridColumnMeta<DetailRow>[]>(() => {
    const meta: GridColumnMeta<DetailRow>[] = [
      { accessor: 'item', kind: 'list' },
      { accessor: 'containerRef', text: (r) => r.containerRef ?? '', summary: 'count' },
      { accessor: 'containerNo', text: (r) => r.containerNo ?? '' },
      { accessor: 'quantity', kind: 'number', summary: 'sum' },
      { accessor: 'model' },
      { accessor: 'orderDate', kind: 'date', text: (r) => dateText(r.orderDate) },
      { accessor: 'orderMonth', kind: 'list', text: (r) => r.orderMonth ?? '' },
      { accessor: 'piNumber', text: (r) => r.piNumber ?? '' },
      { accessor: 'exporterReferences', text: (r) => r.exporterReferences ?? '' },
      { accessor: 'commercialInvoiceNos', text: (r) => r.commercialInvoiceNos ?? '' },
      { accessor: 'invoiceDates', text: (r) => r.invoiceDates ?? '' },
      { accessor: 'fobAmountBase', kind: 'number', text: (r) => money(r.fobAmountBase), summary: 'sum' },
      { accessor: 'oil', kind: 'number', text: (r) => oilText(r.totalOilQty, r.oilIncluded), summary: 'sum' },
    ]
    if (seesDeduction) meta.push({ accessor: 'deductionBase', kind: 'number', text: (r) => money(r.deductionBase), summary: 'sum' })
    if (seesPayments) {
      meta.push(
        { accessor: 'paidDates', text: (r) => r.paidDates ?? '' },
        { accessor: 'paymentReferences', text: (r) => r.paymentReferences ?? '' },
        { accessor: 'paymentStatus', kind: 'list', text: (r) => r.paymentStatus ?? '' },
      )
    }
    meta.push(
      { accessor: 'dispatchDate', kind: 'date', text: (r) => dateText(r.dispatchDate) },
      { accessor: 'arrivedPortDate', kind: 'date', text: (r) => dateText(r.arrivedPortDate) },
      { accessor: 'leftPortDate', kind: 'date', text: (r) => dateText(r.leftPortDate) },
      { accessor: 'finalDestination', kind: 'list', text: (r) => r.finalDestination ?? '' },
      { accessor: 'trucks', text: (r) => r.trucks ?? '' },
      { accessor: 'offloadedDate', kind: 'date', text: (r) => dateText(r.offloadedDate) },
      { accessor: 'leadTimeMonths', kind: 'number', text: (r) => (r.leadTimeMonths === null ? '' : formatNumber(r.leadTimeMonths, 2)) },
      { accessor: 'where', kind: 'list' },
      { accessor: 'stageLabel', kind: 'list' },
      { accessor: 'statusName', kind: 'list' },
      { accessor: 'blNo', text: (r) => r.blNo ?? '' },
      { accessor: 'supplierName', kind: 'list', text: (r) => r.supplierName ?? '' },
      { accessor: 'poNumber', text: (r) => r.poNumber ?? '' },
    )
    return meta
  }, [seesDeduction, seesPayments])

  const details = useDataGrid({
    rows: detailRows,
    columns: detailMeta,
    storeKey: 'reports.dispatchedItems.details',
    pageSize: 100,
    // Grouped by item, as the team's sheet.
    groupBy: 'item',
    sort: [{ accessor: 'dispatchDate', direction: 'asc' }],
  })

  const detailColumns: DataTableColumn<DetailRow>[] = [
    { accessor: 'item', title: 'Item', width: 200, defaultToggle: false },
    {
      accessor: 'containerRef',
      title: 'Con. ref.',
      width: 120,
      render: (r) => <UnstyledButton fz="sm" c="blue" td="underline" onClick={() => setOpened(r)}>{r.containerRef}</UnstyledButton>,
    },
    { accessor: 'containerNo', title: 'Container no.', width: 150 },
    { accessor: 'quantity', title: 'Qty', width: 80, textAlign: 'right', render: (r) => count(r.quantity) },
    { accessor: 'model', title: 'Model', width: 190, defaultToggle: false },
    { accessor: 'orderDate', title: 'Order date', width: 110, render: (r) => dateText(r.orderDate) },
    { accessor: 'orderMonth', title: 'Order month', width: 100, defaultToggle: false },
    { accessor: 'piNumber', title: 'PI no.', width: 150 },
    { accessor: 'exporterReferences', title: "PI exporter's ref.", width: 140, defaultToggle: false },
    { accessor: 'commercialInvoiceNos', title: 'Invoice no.', width: 140 },
    { accessor: 'invoiceDates', title: 'C.I. & P.L. date', width: 120, defaultToggle: false },
    {
      accessor: 'fobAmountBase',
      title: `FOB (${base})`,
      width: 130,
      textAlign: 'right',
      render: (r) => (
        <Text span fz="sm" fs={r.fobIsEstimate ? 'italic' : undefined} c={r.fobIsEstimate ? 'dimmed' : undefined}>{money(r.fobAmountBase)}</Text>
      ),
    },
    { accessor: 'oil', title: 'Oil qty', width: 90, textAlign: 'right', render: (r) => oilText(r.totalOilQty, r.oilIncluded) },
  ]
  if (seesDeduction) {
    detailColumns.push({ accessor: 'deductionBase', title: deductionName, width: 140, textAlign: 'right', render: (r) => money(r.deductionBase) })
  }
  if (seesPayments) {
    detailColumns.push(
      { accessor: 'paidDates', title: 'Paid date', width: 110 },
      { accessor: 'paymentReferences', title: 'Payment ref.', width: 170, defaultToggle: false },
      { accessor: 'paymentStatus', title: 'Payment', width: 110, defaultToggle: false },
    )
  }
  detailColumns.push(
    { accessor: 'dispatchDate', title: 'Dispatched', width: 110, render: (r) => dateText(r.dispatchDate) },
    { accessor: 'arrivedPortDate', title: 'Arrived port', width: 110, render: (r) => dateText(r.arrivedPortDate) },
    { accessor: 'leftPortDate', title: 'Left port', width: 110, render: (r) => dateText(r.leftPortDate) },
    { accessor: 'finalDestination', title: 'Final destination', width: 170 },
    { accessor: 'trucks', title: 'Truck #', width: 150, defaultToggle: false },
    { accessor: 'offloadedDate', title: 'Offloaded', width: 110, render: (r) => dateText(r.offloadedDate) },
    {
      accessor: 'leadTimeMonths',
      title: 'Lead time (m)',
      width: 110,
      textAlign: 'right',
      render: (r) => (r.leadTimeMonths === null ? '' : `${formatNumber(r.leadTimeMonths, 2)}${r.leadTimeSoFar ? ' so far' : ''}`),
    },
    {
      accessor: 'where',
      title: 'Where now',
      width: 120,
      render: (r) => {
        const location = report?.locations[r.rowKey]
        return location ? <Badge variant="light" color={LOCATION_COLOR[location]}>{LOCATION_TEXT[location]}</Badge> : ''
      },
    },
    { accessor: 'stageLabel', title: 'Current location', width: 200, defaultToggle: false },
    { accessor: 'statusName', title: 'Status', width: 110, defaultToggle: false },
    { accessor: 'blNo', title: 'B/L', width: 140, defaultToggle: false },
    { accessor: 'supplierName', title: 'Supplier', width: 160, defaultToggle: false },
    { accessor: 'poNumber', title: 'PO no.', width: 160, defaultToggle: false },
  )

  /* ── the page ───────────────────────────────────────────────────────────────────────────── */

  const countryData = useMemo(
    () => [{ value: '', label: 'Any country' }, ...COUNTRIES.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))],
    [],
  )

  return (
    <div>
      <PageHeader
        title="Dispatched Items"
        subtitle="The items dispatched in a period, per item and per container, with their FOB, oil and where they are now. Amounts in the base currency."
        actions={
          <Button variant="default" leftSection={<IconFileExport size={16} />} onClick={() => void exportToExcel()}
            disabled={!report} loading={exporting}>
            Export to Excel
          </Button>
        }
      />

      <FilterBar>
        <FilterBar.Col span={2}>
          <DateInput
            label="Dispatch date from"
            required
            valueFormat="DD/MM/YYYY"
            value={draft.dispatchFrom || null}
            onChange={(next) => setDraft((d) => ({ ...d, dispatchFrom: next ?? '', ...(next ? { dispatchTo: monthEnd(next) } : {}) }))}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Dispatch date to"
            required
            valueFormat="DD/MM/YYYY"
            value={draft.dispatchTo || null}
            onChange={(next) => setDraft((d) => ({ ...d, dispatchTo: next ?? '' }))}
            error={draft.dispatchFrom && draft.dispatchTo && draft.dispatchFrom > draft.dispatchTo ? 'Date From is after Date To.' : undefined}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Loaded in"
            description="Port of loading's country"
            inputWrapperOrder={['label', 'input', 'description']}
            data={countryData}
            value={draft.loadingCountry}
            onChange={(next) => setDraft((d) => ({ ...d, loadingCountry: next ?? '' }))}
            searchable
            allowDeselect={false}
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Supplier"
            placeholder="All suppliers"
            data={suppliers.map((s) => ({ value: String(s.id), label: partyLabel(s) }))}
            value={draft.supplierId === null ? null : String(draft.supplierId)}
            onChange={(next) => setDraft((d) => ({ ...d, supplierId: next ? Number(next) : null }))}
            searchable
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Item family"
            placeholder="All families"
            data={familyOptions(families)}
            value={draft.itemFamilyId === null ? null : String(draft.itemFamilyId)}
            onChange={(next) => setDraft((d) => ({ ...d, itemFamilyId: next ? Number(next) : null }))}
            searchable
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Item"
            placeholder="All items"
            data={items.map((i) => ({ value: String(i.id), label: `${i.itemCode} - ${i.itemName}` }))}
            value={draft.itemId === null ? null : String(draft.itemId)}
            onChange={(next) => setDraft((d) => ({ ...d, itemId: next ? Number(next) : null }))}
            searchable
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Where now"
            data={[
              { value: 'All', label: 'Anywhere' },
              { value: 'AtSea', label: 'At sea' },
              { value: 'AtPort', label: 'At port' },
              { value: 'OnTheRoad', label: 'On the road' },
              { value: 'Offloaded', label: 'Offloaded' },
            ]}
            value={draft.location}
            onChange={(next) => setDraft((d) => ({ ...d, location: (next ?? 'All') as DispatchedItemsQuery['location'] }))}
            allowDeselect={false}
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <TextInput
            label="Container or document"
            placeholder="Ref., container no., B/L, PO, PI or invoice"
            value={draft.search}
            onChange={(e) => {
              const value = e.currentTarget.value
              setDraft((d) => ({ ...d, search: value }))
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') run() }}
          />
        </FilterBar.Col>
        <FilterBar.Col span={12}>
          <Group justify="space-between" gap="xs">
            <SegmentedControl
              value={view}
              onChange={(next) => setView(next as View)}
              data={[{ value: 'balance', label: 'Item balance' }, { value: 'details', label: 'Items / containers' }]}
            />
            <Group gap="xs">
              <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={reset}>Clear Filters</Button>
              <Tooltip label={formError ?? ''} disabled={!formError}>
                <Button leftSection={<IconPlayerPlay size={16} />} onClick={run} disabled={formError !== null} loading={loading}>
                  Run Report
                </Button>
              </Tooltip>
            </Group>
          </Group>
        </FilterBar.Col>
      </FilterBar>

      {error && <Alert color="red" mb="md">{error}</Alert>}

      {!applied && !report && (
        <Text c="dimmed" ta="center" py="xl">Choose the dispatch period, then Run Report.</Text>
      )}

      {loading && !report && <Group justify="center" py="xl"><Loader /></Group>}

      {report && (
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 2, sm: seesDeduction ? 5 : 4 }} spacing="sm">
            <Paper withBorder p="sm">
              <Text fz="xs" c="dimmed">Containers</Text>
              <Text fz="xl" fw={500}>{count(report.totals.containers)}</Text>
            </Paper>
            <Paper withBorder p="sm">
              <Text fz="xs" c="dimmed">Quantity by top family</Text>
              {report.families.length === 0 ? <Text fz="xl" fw={500}>0</Text> : report.families.map((f) => (
                <Text fz="sm" key={f.rootFamilyName}><b>{count(f.quantity)}</b> {f.rootFamilyName}</Text>
              ))}
            </Paper>
            <Paper withBorder p="sm">
              <Text fz="xs" c="dimmed">FOB value {base}</Text>
              <Text fz="xl" fw={500}>{money(report.totals.fobAmountBase)}</Text>
            </Paper>
            {seesDeduction && (
              <Paper withBorder p="sm">
                <Text fz="xs" c="dimmed">{deductionName} {base}</Text>
                <Text fz="xl" fw={500}>{money(report.totals.deductionBase)}</Text>
              </Paper>
            )}
            <Paper withBorder p="sm">
              <Text fz="xs" c="dimmed">Containers now</Text>
              <Text fz="sm">
                {report.totals.containersAtSea} at sea · {report.totals.containersAtPort} at port · {report.totals.containersOnTheRoad} on the road
                · <b>{report.totals.containersOffloaded} offloaded</b>
              </Text>
            </Paper>
          </SimpleGrid>

          <Paper withBorder p="sm">
            <Group gap="lg" wrap="wrap">
              <Text fz="sm">
                <b>Dispatched:</b> {dateLabel(report.dispatchFrom)} to {dateLabel(report.dispatchTo)}
                {' · '}<b>Loaded in:</b> {report.loadingCountry ? COUNTRIES.find((c) => c.code === report.loadingCountry)?.name ?? report.loadingCountry : 'any country'}
              </Text>
              {report.totals.oilQty !== null && <Text fz="sm"><b>Oil:</b> {formatNumber(report.totals.oilQty, 2)}</Text>}
              {!seesDeduction && <Text fz="sm" c="dimmed">The oil deduction is not shown: it needs the View Container Charges permission.</Text>}
              {!seesPayments && <Text fz="sm" c="dimmed">Payments not shown: they need the View Supplier Payments permission.</Text>}
              <Text fz="sm" c="dimmed">Run {formatDateTime(report.generatedAtUtc)} by {report.generatedBy}</Text>
            </Group>
          </Paper>

          {report.rows.length === 0 ? (
            <Paper withBorder p="xl"><Text ta="center" c="dimmed">No container dispatched in this period for the selected criteria.</Text></Paper>
          ) : view === 'balance' ? (
            <Stack gap="xs">
              <Paper radius="lg" withBorder>
                <DataTable
                  storeKey="reports.dispatchedItems.balance"
                  engine={balance}
                  exportFileName="dispatched-items-balance"
                  columns={balanceColumns}
                  idAccessor="itemId"
                  fetching={loading}
                  pinFirstColumn
                  noRecordsText="No item matches the column filters."
                />
              </Paper>
              <Text fz="xs" c="dimmed">
                Grouped by top family, so the vehicles are added up apart from the spare parts. A container of two items counts
                in both rows. FOB in grey italics is an estimate until the goods are received. Click an item for its containers.
              </Text>
            </Stack>
          ) : (
            <Stack gap="xs">
              <TextInput
                placeholder="Search item, container, PO, PI, invoice, B/L or place"
                leftSection={<IconSearch size={16} />}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                maw={460}
              />
              <Paper radius="lg" withBorder>
                <DataTable
                  storeKey="reports.dispatchedItems.details"
                  engine={details}
                  exportFileName="dispatched-items-containers"
                  columns={detailColumns}
                  idAccessor="rowKey"
                  fetching={loading}
                  pinFirstColumn
                  noRecordsText="No container line matches the search or the column filters."
                />
              </Paper>
              <Text fz="xs" c="dimmed">
                One row per container line, grouped by item. More columns in the column chooser. Click a container ref. for its
                journey.
              </Text>
            </Stack>
          )}
        </Stack>
      )}

      <Drawer
        opened={opened !== null}
        onClose={() => setOpened(null)}
        position="right"
        size="lg"
        title={opened ? `${opened.containerRef ?? ''}${opened.containerNo ? ` · ${opened.containerNo}` : ''}` : ''}
      >
        {opened && (
          <Stack gap="sm">
            <Text fz="sm">{count(opened.quantity)} × {opened.itemCode} · {opened.model}</Text>
            <Text fz="sm">{opened.stageLabel}{opened.finalDestination ? ` · to ${opened.finalDestination}` : ''}</Text>
            {canOpenContainers && opened.containerId !== null && (
              <Anchor component={Link} to={`/logistics/containers/${opened.containerId}`} fz="sm">Open container</Anchor>
            )}
            <Table fz="sm" withRowBorders={false}>
              <Table.Tbody>
                {([
                  ['Order', `${opened.poNumber ?? ''} · ${dateText(opened.orderDate)}`],
                  ['PI no.', opened.piNumber],
                  ['Invoice no.', opened.commercialInvoiceNos],
                  ['C.I. & P.L. date', opened.invoiceDates],
                  [`FOB (${base})`, `${money(opened.fobAmountBase)}${opened.fobIsEstimate ? ' (estimate)' : ''}`],
                  ['Oil', oilText(opened.totalOilQty, opened.oilIncluded)],
                  ...(seesDeduction ? [[deductionName, money(opened.deductionBase)]] : []),
                  ...(seesPayments ? [['Paid', opened.paidDates ? `${opened.paidDates} · ${opened.paymentReferences ?? ''}` : opened.paymentStatus]] : []),
                  ['Dispatched', dateText(opened.dispatchDate)],
                  ['Arrived port', dateText(opened.arrivedPortDate)],
                  ['Left port', dateText(opened.leftPortDate)],
                  ['Trucks', opened.trucks],
                  ['Offloaded', dateText(opened.offloadedDate)],
                  ['Lead time', opened.leadTimeMonths === null ? '' : `${formatNumber(opened.leadTimeMonths, 2)} months${opened.leadTimeSoFar ? ' so far' : ''}`],
                  ['B/L', opened.blNo],
                  ['Supplier', opened.supplierName],
                ] as [string, string | null][]).map(([label, value]) => (
                  <Table.Tr key={label}>
                    <Table.Td c="dimmed" w={150}>{label}</Table.Td>
                    <Table.Td>{value || '—'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        )}
      </Drawer>
    </div>
  )
}
