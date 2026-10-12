import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Alert, Group, Loader, SegmentedControl, Select } from '@mantine/core'
import { AreaChart, BarChart, DonutChart, LineChart } from '@mantine/charts'
import { useMediaQuery } from '@mantine/hooks'
import {
  IconAlertTriangle,
  IconBuildingWarehouse,
  IconReceipt2,
  IconTruckDelivery,
  IconUsers,
} from '@tabler/icons-react'
import { dashboardApi, type DashboardSummaryDto } from '../api/dashboard'
import { branchesApi } from '../api/masterdata/branches'
import type { BranchLookupDto } from '../api/types'
import { containerStatusLabel } from '../api/logistics/containers'
import { formatDateOnly, formatNumber, todayDateOnly } from '../components/format'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../auth/useAuth'
import { PERMISSIONS } from '../navigation'
import { useApprovalsMe } from '../hooks/useApprovalsMe'
import css from './DashboardPage.module.css'

/** The periods every widget answers for, and what each one is compared with. */
const DASHBOARD_PERIODS = [
  { value: 'today', label: 'Today', previous: 'yesterday' },
  { value: 'month', label: 'This month', previous: 'the same days last month' },
  { value: 'lastMonth', label: 'Last month', previous: 'the month before' },
  { value: 'year', label: 'This year', previous: 'the same days last year' },
] as const
type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]['value']

/** Where the drafts of each document type are listed, what they are called there, and who may open them. */
const DRAFT_TYPES: Record<string, { label: string; to: string; permission: string }> = {
  SINV: { label: 'Sales invoices', to: '/sales/invoices', permission: PERMISSIONS.invoicesView },
  SRET: { label: 'Sales returns', to: '/sales/invoices', permission: PERMISSIONS.invoicesView },
  PO: { label: 'Purchase orders', to: '/purchase/orders', permission: PERMISSIONS.purchaseOrdersView },
  PINV: { label: 'Purchase invoices', to: '/purchase/invoices', permission: PERMISSIONS.purchaseInvoicesView },
  PRET: { label: 'Purchase returns', to: '/purchase/returns', permission: PERMISSIONS.purchaseReturnsView },
  // Drafts not posted yet: the goods are not in stock until their receipt is (script 72 counts them).
  GRN: { label: 'Goods receipts', to: '/purchase/goods-receipts', permission: PERMISSIONS.goodsReceiptsView },
  INV_IN: { label: 'Inventory In', to: '/inventory/stock-in', permission: PERMISSIONS.stockInView },
  INV_OUT: { label: 'Inventory Out', to: '/inventory/stock-out', permission: PERMISSIONS.stockOutView },
  BIV_OUT: { label: 'BIVAC Out', to: '/inventory/bivac-out', permission: PERMISSIONS.bivacOutView },
  RCPT: { label: 'Receipts', to: '/sales/receipts', permission: PERMISSIONS.receiptsView },
  PAY: { label: 'Supplier payments', to: '/purchase/payments', permission: PERMISSIONS.paymentsView },
}

/** The board's palette for the charts, in the order slices take them. */
const CHART = {
  violet: '#b26cf2',
  pink: '#e15ad8',
  cyan: '#33d6d0',
  blue: '#3d7ff0',
  grid: 'var(--mantine-color-gray-2)',
  text: 'var(--mantine-color-dimmed)',
  slices: ['#33d6d0', '#3d7ff0', '#b26cf2', '#e15ad8', '#ffb547', '#adb5bd'],
}
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/* ── dates ─────────────────────────────────────────────────────────────────────────────────────── */

const pad = (part: number) => String(part).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** The same day in another month, or that month's last day when it is shorter (31 March -> 28 February). */
function sameDayIn(year: number, month: number, day: number): Date {
  return new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()))
}

/**
 * THE PERIOD IS THE READER'S. "This month" is worked out here, in the reader's calendar, and sent as
 * dates, so a reader in Lubumbashi and the server in UTC never disagree about which day it is.
 * Each period is compared with the one before it of the same length: up to the same day of the month
 * (or of the year), so the first week of October is not measured against the whole of September.
 */
function periodDates(period: DashboardPeriod, todayIso: string) {
  const [y, m, d] = todayIso.split('-').map(Number)
  const today = new Date(y, m - 1, d)
  switch (period) {
    case 'today': {
      const yesterday = new Date(y, m - 1, d - 1)
      return { from: iso(today), to: iso(today), prevFrom: iso(yesterday), prevTo: iso(yesterday) }
    }
    case 'month':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(today), prevFrom: iso(new Date(y, m - 2, 1)), prevTo: iso(sameDayIn(y, m - 2, d)) }
    case 'lastMonth':
      return { from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m - 1, 0)), prevFrom: iso(new Date(y, m - 3, 1)), prevTo: iso(new Date(y, m - 2, 0)) }
    case 'year':
      return { from: iso(new Date(y, 0, 1)), to: iso(today), prevFrom: iso(new Date(y - 1, 0, 1)), prevTo: iso(sameDayIn(y - 1, m - 1, d)) }
  }
}

/** The API's dates may carry a midnight time; the page shows the calendar date. */
const showDate = (value: string | null | undefined) => formatDateOnly(value?.slice(0, 10))

/** "85.7k", "1.2M": the axes and donut centres have no room for every digit. */
function compact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${formatNumber(value / 1_000_000, 1)}M`
  if (abs >= 1_000) return `${formatNumber(value / 1_000, 1)}k`
  return formatNumber(value, 0)
}

/** The change against the previous period, as a chip; nothing to compare with says so. */
function changeChip(current: number, previous: number): { text: string; className: string } {
  if (previous === 0) return { text: 'new', className: css.chipDim }
  const change = ((current - previous) / Math.abs(previous)) * 100
  return { text: `${change >= 0 ? '+' : ''}${formatNumber(change, 1)}%`, className: change >= 0 ? css.chipGreen : css.chipRed }
}

/* ── the page ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * The Dashboard: the business in figures and charts, for the branch and period chosen at the top.
 *
 * ONE CALL feeds every widget, and the API leaves out (null) each section the reader may not open on
 * its own screen, so a widget appears only when its section came back. The filters live in the
 * address so a view can be shared. Money is in the base currency.
 */
export function DashboardPage() {
  const [params, setParams] = useSearchParams()
  const branchId = params.get('branchId')
  const period = (DASHBOARD_PERIODS.some((p) => p.value === params.get('period')) ? params.get('period') : 'month') as DashboardPeriod
  const periodInfo = DASHBOARD_PERIODS.find((p) => p.value === period)!
  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const approvals = useApprovalsMe()
  const phone = useMediaQuery('(max-width: 48em)')

  const today = todayDateOnly()
  const dates = useMemo(() => periodDates(period, today), [period, today])
  const key = `${branchId ?? ''}|${dates.from}|${dates.to}`
  const [loaded, setLoaded] = useState<{ key: string; data: DashboardSummaryDto | null; error: string | null } | null>(null)
  const loading = loaded?.key !== key

  useEffect(() => {
    branchesApi.lookup().then(setBranches).catch(() => {})
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    dashboardApi
      .summary({ branchId: branchId ? Number(branchId) : null, ...dates, today }, controller.signal)
      .then((data) => setLoaded({ key, data, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoaded({ key, data: null, error: error instanceof Error ? error.message : 'The dashboard could not be loaded.' })
      })
    return () => controller.abort()
  }, [key, branchId, dates, today])

  function setFilter(name: 'branchId' | 'period', value: string | null) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(name, value)
      else next.delete(name)
      return next
    }, { replace: true })
  }

  const data = loaded?.data ?? null
  const ccy = data?.baseCurrencyCode ?? 'USD'

  return (
    <>
      <PageHeader title="Dashboard" subtitle="The business in figures, for the branch and period you choose." />

      <div className={css.board}>
        <div className={css.toolbar}>
          <div>
            <div className={css.boardTitle}>{periodInfo.label}</div>
            <div className={css.dim} style={{ fontSize: 12 }}>
              {dates.from === dates.to ? showDate(dates.from) : `${showDate(dates.from)} – ${showDate(dates.to)}`}
              {` · compared with ${periodInfo.previous} · amounts in ${ccy}`}
            </div>
          </div>
          {/* On a phone the filters take the whole width, one under the other, and the periods get smaller
              labels: at the normal size "Today / This month / Last month / This year" is 383 px wide, more than a
              390 px screen's column, and the page scrolled sideways. Each period is as wide as its label (flex auto,
              not four equal parts that cut "This month" while "Today" has room to spare), and minWidth 0 lets a
              label shrink to an ellipsis on an even narrower screen instead of pushing the page wider. */}
          <Group gap="sm" wrap="wrap" w={phone ? '100%' : undefined}>
            <Select
              aria-label="Branch"
              placeholder="All branches"
              w={phone ? '100%' : 200}
              data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
              value={branchId}
              onChange={(next) => setFilter('branchId', next)}
              clearable
              searchable
            />
            <SegmentedControl
              value={period}
              onChange={(next) => setFilter('period', next === 'month' ? null : next)}
              data={DASHBOARD_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
              fullWidth={phone}
              size={phone ? 'xs' : 'sm'}
              w={phone ? '100%' : undefined}
              styles={phone ? { control: { flex: '1 1 auto', minWidth: 0 } } : undefined}
            />
          </Group>
        </div>

        {loaded?.error && !loading && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} mb="md">{loaded.error}</Alert>
        )}

        {loading && !data && (
          <Group justify="center" py={80}><Loader /></Group>
        )}

        {data && (
          <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 120ms' }}>
            <Board data={data} ccy={ccy} />
          </div>
        )}
      </div>

      {data && (
        <NeedsAttention data={data} ccy={ccy} approvalsPending={approvals?.canApproveInApp ? approvals.pendingCount : null} />
      )}
    </>
  )
}

/* ── the board ─────────────────────────────────────────────────────────────────────────────────── */

function Board({ data, ccy }: { data: DashboardSummaryDto; ccy: string }) {
  const { sales, receivables, payables, inventory, onTheWay } = data
  const money = (value: number | null | undefined) => `${formatNumber(value ?? 0, 2)} ${ccy}`

  /* the gradient tiles */
  const tiles: ReactNode[] = []
  if (sales) {
    const chip = changeChip(sales.salesBase, sales.prevSalesBase)
    tiles.push(
      <Link key="sales" to="/sales/invoices" className={`${css.tile} ${css.tileViolet}`}>
        <div className={css.tileLabel}>Sales</div>
        <div>
          <span className={css.tileValue}>{compact(sales.salesBase)}</span>
          <span className={css.tileUnit}>{ccy}</span>
        </div>
        <Group justify="space-between" gap={6} wrap="nowrap">
          <span className={css.tileFoot}>{`${formatNumber(sales.invoiceCount)} invoice${sales.invoiceCount === 1 ? '' : 's'}`}</span>
          <span className={css.chip} style={{ background: 'rgba(255,255,255,0.22)', color: '#fff' }}>{chip.text}</span>
        </Group>
      </Link>,
    )
    if (sales.grossProfitBase !== null) {
      const chipProfit = changeChip(sales.grossProfitBase, sales.prevGrossProfitBase ?? 0)
      const margin = sales.salesBase !== 0 ? (sales.grossProfitBase / sales.salesBase) * 100 : null
      tiles.push(
        <Link key="profit" to="/sales/profit" className={`${css.tile} ${css.tileTeal}`}>
          <div className={css.tileLabel}>Gross profit</div>
          <div>
            <span className={css.tileValue}>{compact(sales.grossProfitBase)}</span>
            <span className={css.tileUnit}>{ccy}</span>
          </div>
          <Group justify="space-between" gap={6} wrap="nowrap">
            <span className={css.tileFoot}>{margin === null ? 'No sales' : `Margin ${formatNumber(margin, 1)}%`}</span>
            <span className={css.chip} style={{ background: 'rgba(255,255,255,0.22)', color: '#fff' }}>{chipProfit.text}</span>
          </Group>
        </Link>,
      )
    }
  }

  /* the small pills */
  const pills: ReactNode[] = []
  if (receivables) {
    pills.push(
      <Pill key="receivables" to="/sales/receipts/statement" icon={<IconUsers size={17} />} colour={CHART.pink}
        label="Customers owe" value={money(receivables.outstandingBase)}
        chip={receivables.overdueCount > 0 ? { text: `${receivables.overdueCount} overdue`, className: css.chipRed } : { text: 'on time', className: css.chipGreen }} />,
    )
  }
  if (payables) {
    const total = (payables.invoicesBase ?? 0) + (payables.chargesBase ?? 0)
    const count = (payables.invoiceCount ?? 0) + (payables.chargeCount ?? 0)
    pills.push(
      <Pill key="payables" to="/purchase/payments" icon={<IconReceipt2 size={17} />} colour={CHART.violet}
        label="We owe" value={money(total)} chip={{ text: `${count} open`, className: css.chipDim }} />,
    )
  }
  if (inventory) {
    pills.push(
      <Pill key="inventory" to="/inventory/valuation" icon={<IconBuildingWarehouse size={17} />} colour={CHART.cyan}
        label="Inventory value" value={money(inventory.valueBase)} chip={{ text: `${inventory.itemsInStock} items`, className: css.chipDim }} />,
    )
  }
  if (onTheWay) {
    // Still to receive, as Shortages count it: the orders, the invoices without an order, the containers on their way.
    const pieces = (onTheWay.onOrderPieces ?? 0) + (onTheWay.invoicedNotReceivedPieces ?? 0) + (onTheWay.inTransitPieces ?? 0)
    const to = onTheWay.onOrderPieces !== null ? '/purchase/orders'
      : onTheWay.inTransitPieces !== null ? '/logistics/containers' : '/purchase/invoices'
    pills.push(
      <Pill key="ontheway" to={to} icon={<IconTruckDelivery size={17} />}
        colour={CHART.blue} label="On the way" value={`${formatNumber(pieces)} pcs`}
        chip={{ text: `${formatNumber(onTheWay.containersInTransit ?? 0)} in transit`, className: css.chipDim }} />,
    )
  }

  /* the charts */
  const trend = (data.trend ?? []).map((m) => ({
    month: MONTHS[Number(m.monthStart.slice(5, 7)) - 1],
    Sales: m.salesBase ?? undefined,
    Purchases: m.purchasesBase ?? undefined,
    'Gross profit': m.grossProfitBase ?? undefined,
  }))
  const trendSeries = [
    data.trend?.some((m) => m.salesBase !== null) && { name: 'Sales', color: CHART.violet },
    data.trend?.some((m) => m.purchasesBase !== null) && { name: 'Purchases', color: CHART.cyan },
  ].filter(Boolean) as { name: string; color: string }[]
  const profitTrend = data.trend?.some((m) => m.grossProfitBase !== null) ?? false

  const chartProps = { gridColor: CHART.grid, textColor: CHART.text, valueFormatter: compact, tickLine: 'none' as const }

  const left: ReactNode[] = []
  if (tiles.length > 0 || pills.length > 0) {
    left.push(
      <div key="top" className={css.row}>
        {tiles}
        {pills.length > 0 && <div className={css.pills}>{pills}</div>}
      </div>,
    )
  }
  if (trendSeries.length > 0) {
    left.push(
      <div key="trend" className={css.card}>
        <div className={css.cardTitle}>
          <span>{trendSeries.map((s) => s.name).join(' vs ')}</span>
          <span className={css.dim} style={{ fontSize: 12, fontWeight: 400 }}>last 12 months</span>
        </div>
        <LineChart h={260} data={trend} dataKey="month" series={trendSeries} curveType="natural" withLegend
          legendProps={{ verticalAlign: 'top', height: 34 }} strokeWidth={2.5} withDots={false} gridAxis="y" {...chartProps} />
      </div>,
    )
  }
  const donuts: ReactNode[] = []
  if (data.salesByFamily) {
    donuts.push(<Donut key="family" title="Sales by item family" slices={data.salesByFamily} ccy={ccy} empty="No sales in the period." />)
  }
  if (data.stockByWarehouse) {
    donuts.push(<Donut key="warehouse" title="Stock value by warehouse" slices={data.stockByWarehouse} ccy={ccy} empty="No stock on hand." />)
  }
  if (donuts.length > 0) left.push(<div key="donuts" className={css.row}>{donuts}</div>)

  const right: ReactNode[] = []
  if (profitTrend) {
    right.push(
      <div key="profit" className={css.card}>
        <div className={css.cardTitle}>Gross profit by month</div>
        <AreaChart h={200} data={trend} dataKey="month" series={[{ name: 'Gross profit', color: CHART.blue }]} curveType="natural"
          withGradient fillOpacity={0.5} withDots={false} gridAxis="none" withYAxis={false} strokeWidth={2.5} {...chartProps} />
      </div>,
    )
  }
  if (data.salesByWeekday) {
    const weekdays = data.salesByWeekday.map((d) => ({ day: WEEKDAYS[d.dayNo - 1], Invoices: d.invoiceCount }))
    right.push(
      <div key="weekday" className={css.card}>
        <div className={css.cardTitle}>
          <span>Invoices by week day</span>
          <span className={css.dim} style={{ fontSize: 12, fontWeight: 400 }}>in the period</span>
        </div>
        <BarChart h={260} data={weekdays} dataKey="day" series={[{ name: 'Invoices', color: CHART.cyan }]} maxBarWidth={26}
          barProps={{ radius: [6, 6, 0, 0] }} gridAxis="y" {...chartProps} valueFormatter={(v) => formatNumber(v)} />
      </div>,
    )
  }

  if (left.length === 0 && right.length === 0) {
    return <div className={css.empty}>Nothing on the dashboard for you yet: ask for access to the sales, purchase or inventory screens.</div>
  }
  return (
    <div className={right.length > 0 && left.length > 0 ? css.layout : undefined}>
      {left.length > 0 && <div className={css.column}>{left}</div>}
      {right.length > 0 && <div className={css.column}>{right}</div>}
    </div>
  )
}

function Pill({ to, icon, colour, label, value, chip }: {
  to: string
  icon: ReactNode
  colour: string
  label: string
  value: string
  chip: { text: string; className: string }
}) {
  return (
    <Link to={to} className={css.pill}>
      <span className={css.pillIcon} style={{ color: colour, background: `${colour}26` }}>{icon}</span>
      <span className={css.pillText}>
        <div className={css.pillLabel}>{label}</div>
        <div className={css.pillValue}>{value}</div>
      </span>
      <span className={`${css.chip} ${chip.className}`}>{chip.text}</span>
    </Link>
  )
}

function Donut({ title, slices, ccy, empty }: { title: string; slices: { label: string; valueBase: number }[]; ccy: string; empty: string }) {
  const total = slices.reduce((sum, s) => sum + s.valueBase, 0)
  const data = slices.map((s, i) => ({ name: s.label, value: s.valueBase, color: CHART.slices[i % CHART.slices.length] }))
  return (
    <div className={css.card}>
      <div className={css.cardTitle}>{title}</div>
      {slices.length === 0 ? (
        <div className={css.empty}>{empty}</div>
      ) : (
        <div className={css.donut}>
          <DonutChart data={data} size={150} thickness={22} strokeWidth={0} paddingAngle={2}
            chartLabel={`${compact(total)} ${ccy}`} tooltipDataSource="segment" valueFormatter={(v) => `${formatNumber(v, 2)} ${ccy}`}
            styles={{ label: { fontSize: 13, fontWeight: 700 } }} />
          <div className={css.legend}>
            {data.map((s) => (
              <div key={s.name} className={css.legendRow}>
                <span className={css.legendDot} style={{ color: s.color }} />
                <span className={css.legendName}>{s.name}</span>
                <span className={css.legendValue}>{total > 0 ? `${formatNumber((s.value / total) * 100, 0)}%` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── needs attention ───────────────────────────────────────────────────────────────────────────── */

const CONTAINER_REASONS = {
  ArrivingSoon: (c: { eta: string | null }) => ({ text: `Arriving ${showDate(c.eta)}`, colour: '#3d7ff0' }),
  AtPort: () => ({ text: 'At port', colour: '#ffb547' }),
  NearLastFreeDay: (c: { lastFreeDay: string | null }) => ({ text: `Last free day ${showDate(c.lastFreeDay)}`, colour: '#ffb547' }),
  PastLastFreeDay: (c: { lastFreeDay: string | null }) => ({ text: `Free time over since ${showDate(c.lastFreeDay)}`, colour: '#ff6b8a' }),
} as const

/** A "Needs attention" card: a title with its count, and either its content or a quiet "all clear". */
function AttentionCard({ title, count, clear, children }: { title: string; count: number; clear: string; children?: ReactNode }) {
  return (
    <div className={css.card}>
      <div className={css.cardTitle}>
        <span>{title}</span>
        <span className={`${css.count} ${count > 0 ? css.countOn : css.countOff}`}>{formatNumber(count)}</span>
      </div>
      {count > 0 ? children : <div className={css.dim} style={{ fontSize: 13 }}>{clear}</div>}
    </div>
  )
}

/** One line of a card: a label linked to its screen with an optional line under it, and a figure. */
function Line({ to, label, sub, value, colour }: { to: string; label: string; sub?: string; value: ReactNode; colour?: string }) {
  return (
    <div className={css.line}>
      <div style={{ minWidth: 0 }}>
        <Link to={to} className={css.link}>{label}</Link>
        {sub && <div className={css.sub}>{sub}</div>}
      </div>
      <span className={css.num} style={{ color: colour }}>{value}</span>
    </div>
  )
}

function NeedsAttention({ data, ccy, approvalsPending }: { data: DashboardSummaryDto; ccy: string; approvalsPending: number | null }) {
  const { hasPermission } = useAuth()
  const money = (value: number | null | undefined) => `${formatNumber(value ?? 0, 2)} ${ccy}`
  const cards: ReactNode[] = []

  if (approvalsPending !== null) {
    cards.push(
      <AttentionCard key="approvals" title="Waiting for your approval" count={approvalsPending} clear="No purchase order is waiting for you.">
        <Line to="/purchase/approvals" label="Open Approvals" value={`${formatNumber(approvalsPending)} order${approvalsPending === 1 ? '' : 's'}`} />
      </AttentionCard>,
    )
  }

  // The card shows for a reader who may open at least one list of drafts; the API sent only those.
  if (Object.values(DRAFT_TYPES).some((t) => hasPermission(t.permission))) {
    const total = data.drafts.reduce((sum, d) => sum + d.draftCount, 0)
    cards.push(
      <AttentionCard key="drafts" title="Drafts not posted" count={total} clear="Every document you can see is posted.">
        {data.drafts.map((d) => {
          const type = DRAFT_TYPES[d.typeCode] ?? { label: d.typeCode, to: '/' }
          return <Line key={d.typeCode} to={type.to} label={type.label} value={formatNumber(d.draftCount)} />
        })}
      </AttentionCard>,
    )
  }

  if (data.stockAlerts) {
    const a = data.stockAlerts
    const count = a.belowMinimum + a.negativeStock + (a.outOfStockSales ?? 0)
    cards.push(
      <AttentionCard key="stock" title="Stock alerts" count={count} clear="No item below its minimum, no stock below zero.">
        {a.belowMinimum > 0 && <Line to="/inventory/shortages" label="Items below their minimum" value={formatNumber(a.belowMinimum)} colour="#ffb547" />}
        {(data.belowMinimum ?? []).map((i) => (
          <Line key={i.itemId} to={`/inventory/items/${i.itemId}`} label={i.itemCode} sub={i.itemName}
            value={`${formatNumber(i.onHand)} / ${formatNumber(i.minQuantity)}`} colour="#ffb547" />
        ))}
        {a.negativeStock > 0 && <Line to="/inventory/valuation" label="Item and warehouse below zero" value={formatNumber(a.negativeStock)} colour="#ff6b8a" />}
        {(a.outOfStockSales ?? 0) > 0 && <Line to="/sales/out-of-stock-audit" label="Out-of-stock sales in the period" value={formatNumber(a.outOfStockSales)} colour="#ffb547" />}
      </AttentionCard>,
    )
  }

  if (data.containers) {
    const c = data.containers
    cards.push(
      <AttentionCard key="containers" title="Containers" count={(data.containerList ?? []).length}
        clear="No container arriving within 14 days, at port, or near its last free day.">
        <div className={css.sub} style={{ marginBottom: 4 }}>
          {`${c.arrivingSoon} arriving within 14 days · ${c.atPort} at port · ${c.nearLastFreeDay} near or past the last free day`}
        </div>
        {(data.containerList ?? []).map((row) => {
          const reason = CONTAINER_REASONS[row.reason](row)
          return (
            <Line key={row.containerId} to={`/logistics/containers/${row.containerId}`} label={row.containerRef}
              sub={[row.containerNo, containerStatusLabel(row.statusCode)].filter(Boolean).join(' · ')}
              value={<span className={css.badge} style={{ color: reason.colour, background: `${reason.colour}22` }}>{reason.text}</span>} />
          )
        })}
      </AttentionCard>,
    )
  }

  if (data.overdueInvoices && data.receivables) {
    cards.push(
      <AttentionCard key="overdue" title="Overdue customer invoices" count={data.receivables.overdueCount} clear="No customer invoice is past its due date.">
        {data.overdueInvoices.map((i) => (
          <Line key={i.documentId} to={`/sales/invoices/${i.documentId}`} label={i.documentNumber ?? `#${i.documentId}`}
            sub={`${i.clientName} · due ${showDate(i.dueDate)}, ${i.daysOverdue} day${i.daysOverdue === 1 ? '' : 's'} ago`}
            value={money(i.outstandingBase)} colour="#ff6b8a" />
        ))}
      </AttentionCard>,
    )
  }

  if (data.cheques) {
    const q = data.cheques
    cards.push(
      <AttentionCard key="cheques" title="Cheques pending clearance" count={q.pendingCount} clear="Every cheque given to a supplier is cleared.">
        <div className={css.sub} style={{ marginBottom: 4, color: q.dueCount > 0 ? '#ff6b8a' : undefined }}>
          {`${money(q.pendingBase)} in total${q.dueCount > 0 ? `, ${q.dueCount} already due` : ''}`}
        </div>
        {(data.chequeList ?? []).map((c) => (
          <Line key={`${c.paymentId}-${c.chequeNo}`} to={`/purchase/payments/${c.paymentId}`} label={c.paymentNumber ?? `#${c.paymentId}`}
            sub={`${c.payeeName} · cheque ${c.chequeNo ?? '-'} · due ${showDate(c.chequeDueDate)}`} value={money(c.amountBase)} />
        ))}
      </AttentionCard>,
    )
  }

  if (cards.length === 0) return null
  return (
    <div className={css.board} style={{ marginTop: 20 }}>
      <div className={css.boardTitle} style={{ marginBottom: 14 }}>Needs attention</div>
      <div className={css.attention}>{cards}</div>
    </div>
  )
}
