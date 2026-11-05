import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  Alert, Anchor, Badge, Button, Drawer, Group, Loader, MultiSelect, Paper, Radio, Select, SimpleGrid, Stack, Table, Text,
  TextInput, Tooltip, UnstyledButton,
} from '@mantine/core'
import { DateInput } from '../../components/ui/DateInput'
import { IconFileExport, IconFilterOff, IconPlayerPlay, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  containerChargesReportApi,
  queryFromParams,
  toParams,
  type ChargeCellStatus,
  type ChargePaymentStatus,
  type ContainerChargeCellDto,
  type ContainerChargeOptions,
  type ContainerChargeQuery,
  type ContainerChargeReportResult,
  type ContainerChargeRowDto,
} from '../../api/reports/containerCharges'
import { useAuth } from '../../auth/useAuth'
import { dateLabel } from '../../components/documents/documentKind'
import { formatDateTime, formatNumber, todayDateOnly } from '../../components/format'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'
import { monthEnd } from '../../components/typedDate'

/** A row of the grid: the answer's row with its number and the texts the grid sorts, filters and groups by. */
type GridRow = ContainerChargeRowDto & { n: number; location: string }

const STATUS_COLOR: Record<ChargeCellStatus, string> = { Entered: 'green', Draft: 'gray', Missing: 'red' }
const PAYMENT_COLOR: Record<ChargePaymentStatus, string> = { Paid: 'green', PartlyPaid: 'orange', Unpaid: 'red', NotPayable: 'gray' }
const PAYMENT_TEXT: Record<ChargePaymentStatus, string> = { Paid: 'Paid', PartlyPaid: 'Partly paid', Unpaid: 'Unpaid', NotPayable: 'Not payable' }

function defaultQuery(): ContainerChargeQuery {
  const today = todayDateOnly()
  return {
    chargeTypeIds: [],
    dateBasis: 'Offload',
    dateFrom: `${today.slice(0, 8)}01`,
    dateTo: today,
    search: '',
    supplierId: null,
    entered: 'All',
    payment: 'All',
  }
}

const money = (value: number | null | undefined) => (value === null || value === undefined ? '' : formatNumber(value, 2))
const statusText = (cell: ContainerChargeCellDto) => `${cell.status}${cell.count > 1 ? ` (${cell.count})` : ''}`

/**
 * Reports › Container Charges (script 105): the containers offloaded or dispatched in a period - one date basis at a
 * time, the radio button - and, for each charge type chosen, a group of columns: Status (Entered / Draft / Missing),
 * Amount, Paid and Payment (Paid / Partly paid / Unpaid). The logistics team's "charge per CONTAINER" sheet, worked out
 * by the system, with the count and the total above it.
 *
 * THE FILTERS LIVE IN THE ADDRESS, as on the other reports: what is typed counts once "Run report" is clicked. The grid
 * starts grouped by current location, as the Container Report; a row opens a drawer with each charge and its payments.
 * The payment columns need View Supplier Payments: the server sends them empty to others and the page draws none.
 */
export function ContainerChargesReportPage() {
  const [params, setParams] = useSearchParams()
  const { hasPermission } = useAuth()
  const applied = useMemo(() => queryFromParams(params), [params])
  const [draft, setDraft] = useState<ContainerChargeQuery>(() => applied ?? defaultQuery())

  const [options, setOptions] = useState<ContainerChargeOptions>({ chargeTypes: [], suppliers: [] })
  const [report, setReport] = useState<ContainerChargeReportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [opened, setOpened] = useState<ContainerChargeRowDto | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    containerChargesReportApi.options(controller.signal).then(setOptions).catch(() => {})
    return () => controller.abort()
  }, [])

  const load = useCallback(async (signal: AbortSignal) => {
    if (!applied) return
    setLoading(true)
    setError(null)
    try {
      const loaded = await containerChargesReportApi.report(applied, signal)
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

  const formError = draft.chargeTypeIds.length === 0
    ? 'Choose at least one charge type.'
    : draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo ? 'Date From is after Date To.' : null

  function run() {
    if (formError) return
    setParams(toParams(draft), { replace: false })
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
      await containerChargesReportApi.exportToExcel(applied)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The export could not be made.')
    } finally {
      setExporting(false)
    }
  }

  const types = useMemo(() => report?.chargeTypes ?? [], [report])
  const sees = report?.seesPayments ?? true
  const canOpenContainers = hasPermission(PERMISSIONS.containersView)

  const gridRows = useMemo<GridRow[]>(() => {
    const needle = search.trim().toLowerCase()
    return (report?.rows ?? [])
      .map((r, i) => ({ ...r, n: i + 1, location: r.stageLabel }))
      .filter((r) => !needle || [r.containerRef, r.containerNo ?? '', r.blNo ?? '', r.items ?? '', r.finalDestination ?? '',
        r.stageLabel, r.suppliers ?? '', r.orders ?? ''].some((text) => text.toLowerCase().includes(needle)))
  }, [report, search])

  /*
   * THE GRID ENGINE: sort, funnels and a filter row, Group by with subtotals, the column chooser, footer totals over the
   * rows the filters leave, CSV. One group of columns per charge type: "Freight / Shipping · Amount".
   */
  const gridMeta = useMemo<GridColumnMeta<GridRow>[]>(() => {
    const meta: GridColumnMeta<GridRow>[] = [
      { accessor: 'n', kind: 'number', summary: 'count' },
      { accessor: 'containerRef' },
      { accessor: 'containerNo', text: (r) => r.containerNo ?? '' },
      { accessor: 'items', text: (r) => r.items ?? '' },
      { accessor: 'pieces', kind: 'number', summary: 'sum' },
      { accessor: 'finalDestination', kind: 'list', text: (r) => r.finalDestination ?? '' },
      { accessor: 'location', kind: 'list' },
      { accessor: 'dispatchDate', kind: 'date', text: (r) => (r.dispatchDate ? dateLabel(r.dispatchDate) : '') },
      { accessor: 'offloadedDate', kind: 'date', text: (r) => (r.offloadedDate ? dateLabel(r.offloadedDate) : '') },
      { accessor: 'suppliers', kind: 'list', text: (r) => r.suppliers ?? '' },
      { accessor: 'orders', text: (r) => r.orders ?? '' },
      { accessor: 'blNo', text: (r) => r.blNo ?? '' },
    ]
    for (const t of types) {
      const cell = (r: GridRow) => r.charges[String(t.id)]
      meta.push({ accessor: `s${t.id}`, kind: 'list', value: (r) => cell(r).status, text: (r) => statusText(cell(r)) })
      meta.push({ accessor: `a${t.id}`, kind: 'number', value: (r) => cell(r).amount, text: (r) => money(cell(r).amount), summary: 'sum' })
      if (sees) {
        meta.push({
          accessor: `p${t.id}`, kind: 'number', summary: 'sum',
          value: (r) => (cell(r).status === 'Missing' ? null : cell(r).paid), text: (r) => (cell(r).status === 'Missing' ? '' : money(cell(r).paid)),
        })
        meta.push({
          accessor: `q${t.id}`, kind: 'list',
          value: (r) => cell(r).paymentStatus ?? '', text: (r) => { const s = cell(r).paymentStatus; return s ? PAYMENT_TEXT[s] : '' },
        })
      }
    }
    if (types.length > 1) {
      meta.push({ accessor: 'amount', kind: 'number', text: (r) => money(r.amount), summary: 'sum' })
      if (sees) {
        meta.push({ accessor: 'paid', kind: 'number', text: (r) => money(r.paid), summary: 'sum' })
        meta.push({ accessor: 'balance', kind: 'number', text: (r) => money(r.balance), summary: 'sum' })
      }
    }
    return meta
  }, [types, sees])

  const engine = useDataGrid({
    rows: gridRows,
    columns: gridMeta,
    storeKey: 'reports.containerCharges',
    pageSize: 100,
    // Grouped by current location to start, as the Container Report and the team's sheet.
    groupBy: 'location',
    sort: [{ accessor: 'n', direction: 'asc' }],
  })

  const gridColumns: DataTableColumn<GridRow>[] = [
    { accessor: 'n', title: '#', width: 60, textAlign: 'right' },
    {
      accessor: 'containerRef',
      title: 'Container ref.',
      width: 130,
      render: (row) => (
        <UnstyledButton fz="sm" c="blue" td="underline" onClick={() => setOpened(row)}>{row.containerRef}</UnstyledButton>
      ),
    },
    { accessor: 'containerNo', title: 'Container number', width: 170 },
    { accessor: 'items', title: 'Items', width: 180 },
    { accessor: 'pieces', title: 'Pcs', width: 80, textAlign: 'right', defaultToggle: false },
    { accessor: 'finalDestination', title: 'Final destination', width: 170 },
    { accessor: 'location', title: 'Current location', width: 190 },
    { accessor: 'dispatchDate', title: 'Dispatched', width: 110, render: (r) => (r.dispatchDate ? dateLabel(r.dispatchDate) : '') },
    { accessor: 'offloadedDate', title: 'Offloaded', width: 110, render: (r) => (r.offloadedDate ? dateLabel(r.offloadedDate) : '') },
    { accessor: 'suppliers', title: 'Supplier', width: 140, defaultToggle: false },
    { accessor: 'orders', title: 'Order', width: 160, defaultToggle: false },
    { accessor: 'blNo', title: 'B/L', width: 140, defaultToggle: false },
  ]
  for (const t of types) {
    const cell = (r: GridRow) => r.charges[String(t.id)]
    gridColumns.push({
      accessor: `s${t.id}`,
      title: `${t.chargeName} · Status`,
      width: 130,
      render: (r) => <Badge variant="light" color={STATUS_COLOR[cell(r).status]}>{statusText(cell(r))}</Badge>,
    })
    gridColumns.push({
      accessor: `a${t.id}`,
      title: `${t.chargeName} · Amount`,
      width: 130,
      textAlign: 'right',
      render: (r) => {
        const c = cell(r)
        if (c.amount === null) return ''
        return c.original ? <Tooltip label={c.original}><Text span fz="sm" td="underline dotted">{money(c.amount)}</Text></Tooltip> : money(c.amount)
      },
    })
    if (sees) {
      gridColumns.push({
        accessor: `p${t.id}`, title: `${t.chargeName} · Paid`, width: 130, textAlign: 'right',
        render: (r) => (cell(r).status === 'Missing' ? '' : money(cell(r).paid)),
      })
      gridColumns.push({
        accessor: `q${t.id}`,
        title: `${t.chargeName} · Payment`,
        width: 130,
        render: (r) => {
          const s = cell(r).paymentStatus
          return s ? <Badge variant="light" color={PAYMENT_COLOR[s]}>{PAYMENT_TEXT[s]}</Badge> : ''
        },
      })
    }
  }
  if (types.length > 1) {
    gridColumns.push({ accessor: 'amount', title: 'All charges · Amount', width: 140, textAlign: 'right', render: (r) => money(r.amount) })
    if (sees) {
      gridColumns.push({ accessor: 'paid', title: 'All charges · Paid', width: 140, textAlign: 'right', render: (r) => money(r.paid) })
      gridColumns.push({ accessor: 'balance', title: 'All charges · Balance', width: 140, textAlign: 'right', render: (r) => money(r.balance) })
    }
  }

  const openedCharges = opened ? (report?.charges ?? []).filter((c) => c.containerId === opened.containerId) : []
  const base = report?.baseCurrencyCode ?? 'USD'

  return (
    <div>
      <PageHeader
        title="Container Charges"
        subtitle="The containers offloaded or dispatched in a period, and for each charge type whether it is entered, its amount and what is paid. Amounts in the base currency."
        actions={
          <Button variant="default" leftSection={<IconFileExport size={16} />} onClick={() => void exportToExcel()}
            disabled={!report} loading={exporting}>
            Export to Excel
          </Button>
        }
      />

      <FilterBar>
        <FilterBar.Col span={5}>
          <MultiSelect
            label="Charge type"
            required
            description="Each type chosen adds its Status, Amount, Paid and Payment columns."
            placeholder={draft.chargeTypeIds.length === 0 ? 'Choose one or more' : undefined}
            data={options.chargeTypes.map((t) => ({ value: String(t.id), label: `${t.chargeName}${t.isActive ? '' : ' (inactive)'}` }))}
            value={draft.chargeTypeIds.map(String)}
            onChange={(next) => setDraft((d) => ({ ...d, chargeTypeIds: next.map(Number) }))}
            searchable
            clearable
            error={draft.chargeTypeIds.length === 0 && applied ? formError : undefined}
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Radio.Group
            label="Date"
            value={draft.dateBasis}
            onChange={(next) => setDraft((d) => ({ ...d, dateBasis: next === 'Dispatch' ? 'Dispatch' : 'Offload' }))}
          >
            <Group gap="md" mt={8}>
              <Radio value="Offload" label="Offload date" />
              <Radio value="Dispatch" label="Dispatched date" />
            </Group>
          </Radio.Group>
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date from"
            valueFormat="DD/MM/YYYY"
            clearable
            value={draft.dateFrom || null}
            onChange={(next) => setDraft((d) => ({ ...d, dateFrom: next ?? '', ...(next ? { dateTo: monthEnd(next) } : {}) }))}
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date to"
            valueFormat="DD/MM/YYYY"
            clearable
            value={draft.dateTo || null}
            onChange={(next) => setDraft((d) => ({ ...d, dateTo: next ?? '' }))}
            error={draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo ? 'Date From is after Date To.' : undefined}
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Charge entered"
            data={[
              { value: 'All', label: 'All containers' },
              { value: 'Missing', label: 'A charge missing' },
              { value: 'Entered', label: 'Every charge entered' },
            ]}
            value={draft.entered}
            onChange={(next) => setDraft((d) => ({ ...d, entered: (next ?? 'All') as ContainerChargeQuery['entered'] }))}
            allowDeselect={false}
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Payment"
            data={[
              { value: 'All', label: 'All' },
              { value: 'Paid', label: 'Paid' },
              { value: 'PartlyPaid', label: 'Partly paid' },
              { value: 'Unpaid', label: 'Unpaid' },
            ]}
            value={draft.payment}
            onChange={(next) => setDraft((d) => ({ ...d, payment: (next ?? 'All') as ContainerChargeQuery['payment'] }))}
            allowDeselect={false}
            disabled={!sees}
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select
            label="Supplier"
            placeholder="All suppliers"
            data={options.suppliers.map((s) => ({ value: String(s.id), label: s.partyName }))}
            value={draft.supplierId === null ? null : String(draft.supplierId)}
            onChange={(next) => setDraft((d) => ({ ...d, supplierId: next ? Number(next) : null }))}
            searchable
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <TextInput
            label="Container"
            placeholder="Ref., container no. or B/L"
            value={draft.search}
            onChange={(e) => {
              const value = e.currentTarget.value
              setDraft((d) => ({ ...d, search: value }))
            }}
          />
        </FilterBar.Col>
        <FilterBar.Col span={12}>
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" leftSection={<IconFilterOff size={16} />} onClick={reset}>Reset</Button>
            <Tooltip label={formError ?? ''} disabled={!formError}>
              <Button leftSection={<IconPlayerPlay size={16} />} onClick={run} disabled={formError !== null} loading={loading}>
                Run report
              </Button>
            </Tooltip>
          </Group>
        </FilterBar.Col>
      </FilterBar>

      {error && <Alert color="red" mb="md">{error}</Alert>}

      {!applied && !report && (
        <Text c="dimmed" ta="center" py="xl">Choose the charge types, the date and the period, then Run report.</Text>
      )}

      {loading && !report && <Group justify="center" py="xl"><Loader /></Group>}

      {report && (
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 2, sm: sees ? 5 : 3 }} spacing="sm">
            <Paper withBorder p="sm"><Text fz="xs" c="dimmed">Containers</Text><Text fz="xl" fw={500}>{formatNumber(report.totals.containers)}</Text></Paper>
            <Paper withBorder p="sm">
              <Text fz="xs" c="dimmed">With a charge missing</Text>
              <Text fz="xl" fw={500} c={report.totals.withMissing > 0 ? 'red' : undefined}>{formatNumber(report.totals.withMissing)}</Text>
            </Paper>
            <Paper withBorder p="sm"><Text fz="xs" c="dimmed">Total {base}</Text><Text fz="xl" fw={500}>{money(report.totals.amount)}</Text></Paper>
            {sees && <Paper withBorder p="sm"><Text fz="xs" c="dimmed">Paid {base}</Text><Text fz="xl" fw={500}>{money(report.totals.paid)}</Text></Paper>}
            {sees && (
              <Paper withBorder p="sm">
                <Text fz="xs" c="dimmed">Balance {base}</Text>
                <Text fz="xl" fw={500} c={(report.totals.balance ?? 0) > 0 ? 'orange' : undefined}>{money(report.totals.balance)}</Text>
              </Paper>
            )}
          </SimpleGrid>

          <Paper withBorder p="sm">
            <Group gap="lg" wrap="wrap">
              <Text fz="sm">
                <b>{report.dateBasis === 'Dispatch' ? 'Dispatched' : 'Offloaded'}:</b>{' '}
                {report.dateFrom || report.dateTo
                  ? `${report.dateFrom ? dateLabel(report.dateFrom) : '…'} to ${report.dateTo ? dateLabel(report.dateTo) : '…'}`
                  : 'any date (every container)'}
              </Text>
              {types.map((t) => {
                const tt = report.totals.perType[String(t.id)]
                return (
                  <Text fz="sm" key={t.id}>
                    <b>{t.chargeName}:</b> {tt.entered} entered{tt.draft ? `, ${tt.draft} draft` : ''}, {tt.missing} missing · {money(tt.amount)}
                    {sees && tt.paid !== null ? ` · paid ${money(tt.paid)}` : ''}
                  </Text>
                )
              })}
              {!sees && <Text fz="sm" c="dimmed">Payments not shown: they need the View Supplier Payments permission.</Text>}
              <Text fz="sm" c="dimmed">Run {formatDateTime(report.generatedAtUtc)} by {report.generatedBy}</Text>
            </Group>
          </Paper>

          {report.rows.length === 0 ? (
            <Paper withBorder p="xl"><Text ta="center" c="dimmed">No containers for the selected criteria.</Text></Paper>
          ) : (
            <Stack gap="xs">
              <TextInput
                placeholder="Search container, items, destination, location, supplier or order"
                leftSection={<IconSearch size={16} />}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                maw={460}
              />
              <Paper radius="lg" withBorder>
                <DataTable
                  storeKey="reports.containerCharges"
                  engine={engine}
                  exportFileName="container-charges"
                  columns={gridColumns}
                  idAccessor="containerId"
                  fetching={loading}
                  pinFirstColumn
                  rowClassName={(row) => (Object.values(row.charges).some((c) => c.status === 'Missing') ? 'app-grid__row--danger' : undefined)}
                  noRecordsText="No container matches the search or the column filters."
                />
              </Paper>
              <Text fz="xs" c="dimmed">
                A row in red has a charge type missing. A container with several charges of one type shows their total and
                their count; click its ref. for each charge and its payments.
              </Text>
            </Stack>
          )}
        </Stack>
      )}

      <Drawer
        opened={opened !== null}
        onClose={() => setOpened(null)}
        position="right"
        size="xl"
        title={opened ? `${opened.containerRef}${opened.containerNo ? ` · ${opened.containerNo}` : ''}` : ''}
      >
        {opened && (
          <Stack gap="sm">
            <Text fz="sm">{opened.items} · {opened.stageLabel}{opened.finalDestination ? ` · to ${opened.finalDestination}` : ''}</Text>
            {canOpenContainers && (
              <Anchor component={Link} to={`/logistics/containers/${opened.containerId}`} fz="sm">Open container</Anchor>
            )}
            {types.map((t) => {
              const list = openedCharges.filter((c) => c.chargeTypeId === t.id)
              return (
                <Stack gap={4} key={t.id}>
                  <Text fw={500} fz="sm">{t.chargeName}</Text>
                  {list.length === 0 ? (
                    <Text fz="sm" c="red">Not entered on this container.</Text>
                  ) : (
                    <Table striped fz="sm">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Date</Table.Th>
                          <Table.Th>Reference</Table.Th>
                          <Table.Th>Provider</Table.Th>
                          <Table.Th>Status</Table.Th>
                          <Table.Th ta="right">Amount</Table.Th>
                          {sees && <Table.Th ta="right">Paid</Table.Th>}
                          {sees && <Table.Th>Payments</Table.Th>}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {list.map((c) => (
                          <Table.Tr key={c.chargeId}>
                            <Table.Td>{dateLabel(c.chargeDate)}</Table.Td>
                            <Table.Td>{c.reference ?? ''}</Table.Td>
                            <Table.Td>{c.providerName ?? ''}</Table.Td>
                            <Table.Td>{c.status}</Table.Td>
                            <Table.Td ta="right">
                              {c.currencyCode ?? ''} {money(c.amount)}
                              {c.currencyCode && c.currencyCode !== base ? <Text fz="xs" c="dimmed">{base} {money(c.amountBase)}</Text> : null}
                            </Table.Td>
                            {sees && (
                              <Table.Td ta="right">
                                {money(c.paidAmount)}
                                {c.paymentStatus && <Text fz="xs" c={PAYMENT_COLOR[c.paymentStatus]}>{PAYMENT_TEXT[c.paymentStatus]}</Text>}
                              </Table.Td>
                            )}
                            {sees && <Table.Td fz="xs">{c.payments?.split('; ').map((p) => <div key={p}>{p}</div>) ?? ''}</Table.Td>}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Stack>
              )
            })}
          </Stack>
        )}
      </Drawer>
    </div>
  )
}
