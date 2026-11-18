import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router'
import { Tooltip } from '@mantine/core'
import { BarChart } from '@mantine/charts'
import type { DashboardStageDto, DashboardSummaryDto } from '../api/dashboard'
import { formatNumber } from '../components/format'
import { useAuth } from '../auth/useAuth'
import { PERMISSIONS } from '../navigation'
import { routes } from '../routes'
import { CHART, MONTHS, compact, showDate } from './dashboardShared'
import css from './DashboardPage.module.css'

/** The colour of a stage's tile, by what the stage is (script 111): pending, a leg on the way, an arrival, the offload. */
function stageColour(stage: DashboardStageDto): string {
  if (stage.filterId === -1) return CHART.orange
  switch (stage.stageKind) {
    case 0: return 'var(--mantine-color-gray-5)'
    case 1: return CHART.blue
    case 2: return CHART.violet
    case 3: return CHART.green
    default: return CHART.cyan
  }
}

/**
 * (115) THE DASHBOARD'S CARDS: where the containers are, what we owe, what customers owe and the purchases of each
 * month, from reporting.usp_Dashboard_Cards. Each card shows only when its section came back: the API leaves out what
 * the reader may not open on its own screen (DashboardService.TrimCards), so the page decides nothing about it. Each
 * line opens its list, already filtered when the list can be (routes.purchaseInvoicesLink and the others).
 */
export function DashboardCards({ data, ccy, branchId }: { data: DashboardSummaryDto; ccy: string; branchId: string | null }) {
  const cards: ReactNode[] = []

  if (data.containerStages) cards.push(<StagesCard key="stages" stages={data.containerStages} />)
  if (data.payablesDetail) cards.push(<PayablesCard key="payables" data={data} ccy={ccy} branchId={branchId} />)
  if (data.receivablesAging) cards.push(<ReceivablesCard key="receivables" data={data} ccy={ccy} branchId={branchId} />)
  if (data.purchasesByMonth) cards.push(<PurchasesCard key="purchases" months={data.purchasesByMonth} ccy={ccy} />)

  if (cards.length === 0) return null
  return (
    <div className={css.board} style={{ marginTop: 20 }}>
      <div className={css.boardTitle} style={{ marginBottom: 14 }}>Containers, payables and receivables</div>
      <div className={css.cards}>{cards}</div>
    </div>
  )
}

/* ── containers by stage ───────────────────────────────────────────────────────────────────────── */

function StagesCard({ stages }: { stages: DashboardStageDto[] }) {
  const onTheWay = stages.reduce((sum, s) => sum + s.openContainers + s.toReceiveContainers, 0)
  const pieces = stages.reduce((sum, s) => sum + s.openPieces + s.toReceivePieces, 0)
  return (
    <div className={`${css.card} ${css.wide}`}>
      <div className={css.cardTitle}>
        <span>Containers by stage</span>
        <span className={css.dim} style={{ fontSize: 12, fontWeight: 400 }}>
          {`${formatNumber(onTheWay)} not received · ${formatNumber(pieces)} pcs`}
        </span>
      </div>
      <div className={css.stages}>
        {stages.map((s) => <StageTile key={`${s.filterId ?? 'none'}-${s.stageName}`} stage={s} />)}
      </div>
    </div>
  )
}

function StageTile({ stage }: { stage: DashboardStageDto }) {
  /* The Offload stage counts what waits for its goods receipt, and what was received in the period below it; every
     other stage the containers standing there. */
  const offload = stage.stageKind === 3
  const count = offload ? stage.toReceiveContainers : stage.openContainers
  const pcs = offload ? stage.toReceivePieces : stage.openPieces
  const lines = [
    offload ? `${formatNumber(count)} to receive · ${formatNumber(pcs)} pcs` : `${formatNumber(pcs)} pcs`,
    offload ? `${formatNumber(stage.receivedContainers)} received in the period` : null,
  ].filter(Boolean) as string[]
  const tile = (
    <>
      <div className={css.stageName}>{stage.stageName}</div>
      <div className={css.stageValue}>{formatNumber(count)}</div>
      {lines.map((line) => <div key={line} className={css.sub}>{line}</div>)}
    </>
  )
  const className = `${css.stage} ${count === 0 && !(offload && stage.receivedContainers > 0) ? css.stageEmpty : ''}`
  const style = { '--stage-colour': stageColour(stage) } as CSSProperties
  const tooltip = stage.filterId === -1
    ? 'Containers on a route the shipment stages do not describe: an administrator decides on them in Shipment Stages.'
    : null
  // No Stage filter names the containers received without an Offload stage (filterId null): the tile is not a link.
  const content = stage.filterId === null
    ? <div className={className} style={style}>{tile}</div>
    : <Link to={routes.containersLink({ stageId: stage.filterId })} className={className} style={style}>{tile}</Link>
  return tooltip ? <Tooltip label={tooltip} withArrow multiline w={260}>{content}</Tooltip> : content
}

/* ── what we owe ───────────────────────────────────────────────────────────────────────────────── */

/** One line of a money card: a label (a link when it has somewhere to go), a dimmed line under it, a figure. */
function MoneyLine({ to, label, sub, value, colour }: { to?: string; label: string; sub?: string; value: string; colour?: string }) {
  return (
    <div className={css.line}>
      <div style={{ minWidth: 0 }}>
        {to ? <Link to={to} className={css.link}>{label}</Link> : <span>{label}</span>}
        {sub && <div className={css.sub}>{sub}</div>}
      </div>
      <span className={css.num} style={{ color: colour }}>{value}</span>
    </div>
  )
}

const plural = (count: number, one: string, many = `${one}s`) => `${formatNumber(count)} ${count === 1 ? one : many}`

function PayablesCard({ data, ccy, branchId }: { data: DashboardSummaryDto; ccy: string; branchId: string | null }) {
  const { hasPermission } = useAuth()
  const p = data.payablesDetail!
  const money = (value: number | null | undefined) => `${formatNumber(value ?? 0, 2)} ${ccy}`
  const invoices = p.unpaidInvoicesBase !== null
  const charges = p.unpaidChargesBase !== null
  const total = (p.unpaidInvoicesBase ?? 0) + (p.partialInvoicesBase ?? 0) + (p.unpaidChargesBase ?? 0) + (p.partialChargesBase ?? 0)

  // Each line opens its list filtered; without the list's own permission, Supplier Payments (which the reader holds).
  const invoicesTo = (paymentStatus: string) => hasPermission(PERMISSIONS.purchaseInvoicesView)
    ? routes.purchaseInvoicesLink({ paymentStatus, branchId })
    : '/purchase/payments'
  const chargesTo = hasPermission(PERMISSIONS.containerChargesView) ? '/logistics/container-charges' : '/purchase/payments'

  return (
    <div className={css.card}>
      <div className={css.cardTitle}>
        <span>We owe</span>
        <span className={css.dim} style={{ fontSize: 12, fontWeight: 400 }}>today</span>
      </div>
      <div className={css.bigFigure}>{money(total)}</div>
      {invoices && (
        <>
          <div className={css.groupTitle}>Supplier invoices</div>
          <MoneyLine to={invoicesTo('Unpaid')} label="Unpaid" sub={plural(p.unpaidInvoiceCount ?? 0, 'invoice')} value={money(p.unpaidInvoicesBase)} />
          {(p.partialInvoiceCount ?? 0) > 0 && (
            <MoneyLine to={invoicesTo('Partial')} label="Partly paid" sub={`${plural(p.partialInvoiceCount ?? 0, 'invoice')} · what is left`}
              value={money(p.partialInvoicesBase)} />
          )}
        </>
      )}
      {charges && (
        <>
          <div className={css.groupTitle}>Container charges on account</div>
          <MoneyLine to={chargesTo} label="Unpaid" sub={plural(p.unpaidChargeCount ?? 0, 'charge')} value={money(p.unpaidChargesBase)} />
          {(p.partialChargeCount ?? 0) > 0 && (
            <MoneyLine to={chargesTo} label="Partly paid" sub={`${plural(p.partialChargeCount ?? 0, 'charge')} · what is left`}
              value={money(p.partialChargesBase)} />
          )}
        </>
      )}
      {(data.creditors ?? []).length > 0 && (
        <>
          <div className={css.groupTitle}>Owed the most</div>
          {data.creditors!.map((c) => (
            <MoneyLine key={c.partyId ?? 'none'} label={c.partyName}
              sub={[c.invoiceCount > 0 ? plural(c.invoiceCount, 'invoice') : null, c.chargeCount > 0 ? plural(c.chargeCount, 'charge') : null]
                .filter(Boolean).join(' · ')}
              value={money(c.invoicesBase + c.chargesBase)} />
          ))}
        </>
      )}
    </div>
  )
}

/* ── what customers owe ────────────────────────────────────────────────────────────────────────── */

function ReceivablesCard({ data, ccy, branchId }: { data: DashboardSummaryDto; ccy: string; branchId: string | null }) {
  const { hasPermission } = useAuth()
  const a = data.receivablesAging!
  const money = (value: number) => `${formatNumber(value, 2)} ${ccy}`
  const buckets = [
    { label: 'Not due yet', count: a.notDueCount, base: a.notDueBase, colour: CHART.green },
    { label: '1–30 days late', count: a.days1To30Count, base: a.days1To30Base, colour: CHART.orange },
    { label: '31–60 days late', count: a.days31To60Count, base: a.days31To60Base, colour: '#ff9466' },
    { label: '61–90 days late', count: a.days61To90Count, base: a.days61To90Base, colour: CHART.pink },
    { label: 'Over 90 days late', count: a.over90Count, base: a.over90Base, colour: CHART.red },
  ]
  const total = buckets.reduce((sum, b) => sum + b.base, 0)
  const statement = hasPermission(PERMISSIONS.statementView)
  const invoices = hasPermission(PERMISSIONS.invoicesView)
  // The overdue invoices are the sales invoice list's Unpaid and Partly paid (it has no "late" filter).
  const listTo = invoices ? routes.salesInvoicesLink({ branchId }) : undefined

  return (
    <div className={css.card}>
      <div className={css.cardTitle}>
        <span>Customers owe</span>
        <span className={css.dim} style={{ fontSize: 12, fontWeight: 400 }}>{`today · ${plural(a.debtorCount, 'customer')}`}</span>
      </div>
      <div className={css.bigFigure}>{money(total)}</div>
      {total > 0 && (
        <div className={css.agingBar} aria-hidden>
          {buckets.filter((b) => b.base > 0).map((b) => (
            <span key={b.label} style={{ width: `${(b.base / total) * 100}%`, background: b.colour }} />
          ))}
        </div>
      )}
      {buckets.map((b) => (
        <div key={b.label} className={css.line}>
          <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <span className={css.dot} style={{ background: b.colour }} />
            {listTo ? <Link to={listTo} className={css.link}>{b.label}</Link> : b.label}
            <span className={css.sub} style={{ marginLeft: 6 }}>{plural(b.count, 'invoice')}</span>
          </span>
          <span className={css.num}>{money(b.base)}</span>
        </div>
      ))}
      {(data.debtors ?? []).length > 0 && (
        <>
          <div className={css.groupTitle}>Owing the most</div>
          {data.debtors!.map((d) => (
            <MoneyLine key={d.clientId}
              to={statement ? routes.customerStatement(d.clientId) : listTo}
              label={d.clientName}
              sub={d.overdueBase > 0
                ? `${money(d.overdueBase)} late · since ${showDate(d.oldestDueDate)}`
                : `${plural(d.invoiceCount, 'invoice')} · none late`}
              value={money(d.outstandingBase)}
              colour={d.overdueBase > 0 ? CHART.red : undefined} />
          ))}
        </>
      )}
    </div>
  )
}

/* ── purchases by month ────────────────────────────────────────────────────────────────────────── */

function PurchasesCard({ months, ccy }: { months: NonNullable<DashboardSummaryDto['purchasesByMonth']>; ccy: string }) {
  const rows = months.map((m) => ({
    month: MONTHS[Number(m.monthStart.slice(5, 7)) - 1],
    Invoiced: m.invoicedBase ?? undefined,
    Received: m.receivedBase ?? undefined,
    'Container charges': m.chargesBase ?? undefined,
    'Received (pcs)': m.receivedPieces ?? undefined,
  }))
  // Each series for a reader who may see it (the API sent it); goods received in pieces only when their value is not
  // sent (View item costs): pieces and money on one axis would read as one.
  const money = [
    months.some((m) => m.invoicedBase !== null) && { name: 'Invoiced', color: CHART.violet },
    months.some((m) => m.receivedBase !== null) && { name: 'Received', color: CHART.cyan },
    months.some((m) => m.chargesBase !== null) && { name: 'Container charges', color: CHART.orange },
  ].filter(Boolean) as { name: string; color: string }[]
  const pieces = money.length === 0 && months.some((m) => m.receivedPieces !== null)
  const series = pieces ? [{ name: 'Received (pcs)', color: CHART.cyan }] : money
  if (series.length === 0) return null

  const total = (name: 'invoicedBase' | 'receivedBase' | 'chargesBase') => months.reduce((sum, m) => sum + (m[name] ?? 0), 0)
  const foot = pieces
    ? `${formatNumber(months.reduce((sum, m) => sum + (m.receivedPieces ?? 0), 0))} pcs received in 12 months`
    : money.map((s) => {
      const key = s.name === 'Invoiced' ? 'invoicedBase' : s.name === 'Received' ? 'receivedBase' : 'chargesBase'
      return `${s.name} ${compact(total(key))} ${ccy}`
    })
      // Goods received without their value (View item costs): their pieces, so they are not lost from sight.
      .concat(months.some((m) => m.receivedBase === null && m.receivedPieces !== null)
        ? [`Received ${formatNumber(months.reduce((sum, m) => sum + (m.receivedPieces ?? 0), 0))} pcs`]
        : [])
      .join(' · ')

  return (
    <div className={`${css.card} ${css.wide}`}>
      <div className={css.cardTitle}>
        <span>Purchases by month</span>
        <span className={css.dim} style={{ fontSize: 12, fontWeight: 400 }}>last 12 months</span>
      </div>
      <BarChart h={260} data={rows} dataKey="month" series={series} withLegend legendProps={{ verticalAlign: 'top', height: 34 }}
        maxBarWidth={18} barProps={{ radius: [4, 4, 0, 0] }} gridAxis="y" gridColor={CHART.grid}
        tickLine="none" valueFormatter={pieces ? (v) => `${formatNumber(v)} pcs` : compact} />
      <div className={css.sub} style={{ marginTop: 6, whiteSpace: 'normal' }}>
        {`${foot}. Invoiced: supplier invoices less returns; received: posted goods receipts at their cost; container charges: posted.`}
      </div>
    </div>
  )
}
