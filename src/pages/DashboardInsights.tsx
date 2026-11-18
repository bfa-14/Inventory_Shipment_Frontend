import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { DashboardSummaryDto } from '../api/dashboard'
import { formatNumber } from '../components/format'
import { useAuth } from '../auth/useAuth'
import { PERMISSIONS } from '../navigation'
import { routes } from '../routes'
import { CHART, showDate } from './dashboardShared'
import css from './DashboardPage.module.css'

type Insights<K extends keyof DashboardSummaryDto> = NonNullable<DashboardSummaryDto[K]>

const plural = (count: number, one: string, many = `${one}s`) => `${formatNumber(count)} ${count === 1 ? one : many}`

/**
 * (116) THE DASHBOARD'S INSIGHTS: what sells and who buys, each branch's sales, the cash and bank accounts, the stock
 * that does not sell, the received containers' charges and the suppliers' lead times, from
 * reporting.usp_Dashboard_Insights. Each card shows only when its section came back: the API leaves out what the reader
 * may not open on its own screen (DashboardService.TrimInsights), so the page decides nothing about it. The transfers
 * on the way are a card of "Needs attention" (DashboardPage).
 */
export function DashboardInsights({ data, ccy, branchId }: { data: DashboardSummaryDto; ccy: string; branchId: string | null }) {
  const cards: ReactNode[] = []

  if (data.topItems) cards.push(<TopItemsCard key="items" items={data.topItems} ccy={ccy} />)
  if (data.topCustomers) cards.push(<TopCustomersCard key="customers" customers={data.topCustomers} ccy={ccy} />)
  // The branches are compared only while no branch is chosen: the card always holds every branch.
  if (data.salesByBranch && branchId === null) cards.push(<BranchSalesCard key="branches" branches={data.salesByBranch} ccy={ccy} />)
  if (data.cashAccounts) cards.push(<CashCard key="cash" accounts={data.cashAccounts} ccy={ccy} />)
  if (data.slowStock) cards.push(<SlowStockCard key="slow" slow={data.slowStock} ccy={ccy} />)
  if (data.chargesMissing) cards.push(<ChargesCard key="charges" charges={data.chargesMissing} />)
  if (data.leadTimes) cards.push(<LeadTimesCard key="lead" lead={data.leadTimes} />)

  if (cards.length === 0) return null
  return (
    <div className={css.board} style={{ marginTop: 20 }}>
      <div className={css.boardTitle} style={{ marginBottom: 14 }}>Sales, cash and stock</div>
      <div className={css.cards}>{cards}</div>
    </div>
  )
}

/* ── shared pieces ─────────────────────────────────────────────────────────────────────────────── */

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className={css.card}>
      <div className={css.cardTitle}>
        <span>{title}</span>
        {note && <span className={css.dim} style={{ fontSize: 12, fontWeight: 400 }}>{note}</span>}
      </div>
      {children}
    </div>
  )
}

/** A ranked line: its place, a label (a link when it has somewhere to go), a dimmed line, a figure, and its share as a bar. */
function RankLine({ rank, to, label, sub, value, share, colour }: {
  rank?: number
  to?: string
  label: string
  sub?: string
  value: ReactNode
  /** 0 to 1: the line's figure against the largest of the card. */
  share?: number
  colour?: string
}) {
  return (
    <div className={css.rankLine}>
      <div className={css.line} style={{ borderBottom: 'none', padding: '6px 0 2px' }}>
        <div style={{ minWidth: 0, display: 'flex', gap: 8 }}>
          {rank !== undefined && <span className={css.rank}>{rank}</span>}
          <div style={{ minWidth: 0 }}>
            {to ? <Link to={to} className={css.link}>{label}</Link> : <span>{label}</span>}
            {sub && <div className={css.sub}>{sub}</div>}
          </div>
        </div>
        <span className={css.num}>{value}</span>
      </div>
      {share !== undefined && (
        <div className={css.bar} aria-hidden>
          <span style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, background: colour ?? CHART.blue }} />
        </div>
      )}
    </div>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <div className={css.empty}>{children}</div>

/* ── top selling items ─────────────────────────────────────────────────────────────────────────── */

function TopItemsCard({ items, ccy }: { items: Insights<'topItems'>; ccy: string }) {
  const { hasPermission } = useAuth()
  const canOpen = hasPermission(PERMISSIONS.itemsView)
  const top = items[0]?.salesBase ?? 0
  return (
    <Card title="Top selling items" note="in the period">
      {items.length === 0 && <Empty>No sales in the period.</Empty>}
      {items.map((item, index) => (
        <RankLine key={item.itemId} rank={index + 1}
          to={canOpen ? `/inventory/items/${item.itemId}` : undefined}
          label={`${item.itemCode} - ${item.itemName}`}
          sub={[`${formatNumber(item.pieces)} pcs`,
            item.grossProfitBase !== null ? `profit ${formatNumber(item.grossProfitBase, 2)} ${ccy}` : null].filter(Boolean).join(' · ')}
          value={`${formatNumber(item.salesBase, 2)} ${ccy}`}
          share={top > 0 ? item.salesBase / top : 0} colour={CHART.violet} />
      ))}
    </Card>
  )
}

/* ── top customers ─────────────────────────────────────────────────────────────────────────────── */

function TopCustomersCard({ customers, ccy }: { customers: Insights<'topCustomers'>; ccy: string }) {
  const { hasPermission } = useAuth()
  const statement = hasPermission(PERMISSIONS.statementView)
  const top = customers[0]?.salesBase ?? 0
  return (
    <Card title="Top customers" note="in the period">
      {customers.length === 0 && <Empty>No sales in the period.</Empty>}
      {customers.map((c, index) => (
        <RankLine key={c.clientId} rank={index + 1}
          to={statement ? routes.customerStatement(c.clientId) : undefined}
          label={c.clientName}
          sub={[plural(c.invoiceCount, 'invoice'),
            c.outstandingBase > 0 ? `owes ${formatNumber(c.outstandingBase, 2)} ${ccy} today` : 'owes nothing'].join(' · ')}
          value={`${formatNumber(c.salesBase, 2)} ${ccy}`}
          share={top > 0 ? c.salesBase / top : 0} colour={CHART.cyan} />
      ))}
    </Card>
  )
}

/* ── sales by branch ───────────────────────────────────────────────────────────────────────────── */

function BranchSalesCard({ branches, ccy }: { branches: Insights<'salesByBranch'>; ccy: string }) {
  const total = branches.reduce((sum, b) => sum + b.salesBase, 0)
  const top = Math.max(0, ...branches.map((b) => b.salesBase))
  return (
    <Card title="Sales by branch" note="in the period">
      {branches.length === 0 && <Empty>No sales in the period.</Empty>}
      {branches.map((b) => (
        <RankLine key={b.branchId}
          to={routes.salesInvoicesLink({ branchId: String(b.branchId) })}
          label={b.branchName}
          sub={[plural(b.invoiceCount, 'invoice'),
            total > 0 ? `${formatNumber((b.salesBase / total) * 100, 1)}% of the sales` : null,
            b.grossProfitBase !== null ? `profit ${formatNumber(b.grossProfitBase, 2)} ${ccy}` : null].filter(Boolean).join(' · ')}
          value={`${formatNumber(b.salesBase, 2)} ${ccy}`}
          share={top > 0 ? b.salesBase / top : 0} colour={CHART.blue} />
      ))}
    </Card>
  )
}

/* ── cash and bank ─────────────────────────────────────────────────────────────────────────────── */

function CashCard({ accounts, ccy }: { accounts: Insights<'cashAccounts'>; ccy: string }) {
  // Each half for a reader who may see it (the API sent it): receipts in, supplier payments out.
  const showIn = accounts.some((a) => a.inBase !== null)
  const showOut = accounts.some((a) => a.outBase !== null)
  const totalIn = accounts.reduce((sum, a) => sum + (a.inBase ?? 0), 0)
  const totalOut = accounts.reduce((sum, a) => sum + (a.outBase ?? 0), 0)
  const money = (value: number) => formatNumber(value, 2)
  return (
    <Card title="Cash and bank" note={`in the period · ${ccy}`}>
      <div className={css.inOut}>
        {showIn && (
          <div>
            <div className={css.sub}>Received</div>
            <div className={css.bigFigure} style={{ color: CHART.green, marginBottom: 0 }}>{`+${money(totalIn)}`}</div>
          </div>
        )}
        {showOut && (
          <div>
            <div className={css.sub}>Paid out</div>
            <div className={css.bigFigure} style={{ color: CHART.red, marginBottom: 0 }}>{`−${money(totalOut)}`}</div>
          </div>
        )}
        {showIn && showOut && (
          <div>
            <div className={css.sub}>Net</div>
            <div className={css.bigFigure} style={{ marginBottom: 0 }}>{money(totalIn - totalOut)}</div>
          </div>
        )}
      </div>
      {accounts.length === 0 && <Empty>No cash or bank account yet.</Empty>}
      {accounts.map((a) => (
        <div key={a.accountId ?? 'none'} className={css.line}>
          <div style={{ minWidth: 0 }}>
            <span>{a.accountName}</span>
            <div className={css.sub}>
              {[a.accountType, a.currencyCode,
                showIn ? `${plural(a.inCount ?? 0, 'receipt line')} in` : null,
                showOut ? `${plural(a.outCount ?? 0, 'payment line')} out` : null].filter(Boolean).join(' · ')}
            </div>
          </div>
          <span className={css.num} style={{ textAlign: 'right' }}>
            {showIn && <div style={{ color: (a.inBase ?? 0) > 0 ? CHART.green : undefined }}>{`+${money(a.inBase ?? 0)}`}</div>}
            {showOut && <div style={{ color: (a.outBase ?? 0) > 0 ? CHART.red : undefined }}>{`−${money(a.outBase ?? 0)}`}</div>}
          </span>
        </div>
      ))}
      <div className={css.sub} style={{ marginTop: 8, whiteSpace: 'normal' }}>
        Posted customer receipts and supplier payments, by the account of each line. Not an account balance.
      </div>
    </Card>
  )
}

/* ── slow-moving stock ─────────────────────────────────────────────────────────────────────────── */

function SlowStockCard({ slow, ccy }: { slow: Insights<'slowStock'>; ccy: string }) {
  const { hasPermission } = useAuth()
  const canOpen = hasPermission(PERMISSIONS.itemsView)
  // Decided by what the API sent (View item costs): values, or pieces alone.
  const values = slow.valueBase !== null
  const top = Math.max(0, ...slow.list.map((i) => (values ? i.valueBase ?? 0 : i.onHand)))
  return (
    <Card title="Slow-moving stock" note={`no sale in ${slow.slowDays} days`}>
      <div className={css.bigFigure}>
        {values ? `${formatNumber(slow.valueBase ?? 0, 2)} ${ccy}` : `${formatNumber(slow.pieces)} pcs`}
      </div>
      <div className={css.sub} style={{ marginBottom: 6, whiteSpace: 'normal' }}>
        {`${plural(slow.items, 'item')}${values ? ` · ${formatNumber(slow.pieces)} pcs` : ''} in stock for ${slow.slowDays} days or more, without a sale since.`}
      </div>
      {slow.list.length === 0 && <Empty>Every item in stock sold in the last {slow.slowDays} days.</Empty>}
      {slow.list.map((item) => (
        <RankLine key={item.itemId}
          to={canOpen ? `/inventory/items/${item.itemId}` : undefined}
          label={`${item.itemCode} - ${item.itemName}`}
          sub={[values ? `${formatNumber(item.onHand)} pcs` : null,
            item.lastSaleDate ? `last sold ${showDate(item.lastSaleDate)}` : 'never sold'].filter(Boolean).join(' · ')}
          value={values ? `${formatNumber(item.valueBase ?? 0, 2)} ${ccy}` : `${formatNumber(item.onHand)} pcs`}
          share={top > 0 ? (values ? item.valueBase ?? 0 : item.onHand) / top : 0} colour={CHART.orange} />
      ))}
    </Card>
  )
}

/* ── the received containers' charges ──────────────────────────────────────────────────────────── */

function ChargesCard({ charges }: { charges: Insights<'chargesMissing'> }) {
  const { hasPermission } = useAuth()
  const report = hasPermission(PERMISSIONS.containerChargesReportView) ? '/reports/container-charges' : undefined
  const received = charges.receivedContainers
  return (
    <Card title="Charges of received containers" note="received in the period">
      <div className={css.bigFigure} style={{ color: charges.withoutCharge > 0 ? CHART.red : undefined }}>
        {`${formatNumber(charges.withoutCharge)} of ${formatNumber(received)}`}
      </div>
      <div className={css.sub} style={{ marginBottom: 6, whiteSpace: 'normal' }}>
        {received === 0
          ? 'No container was received in the period.'
          : charges.withoutCharge === 0
            ? 'Every container received in the period has a posted charge.'
            : `${plural(charges.withoutCharge, 'container')} received without a posted charge${charges.draftOnly > 0 ? ` (${formatNumber(charges.draftOnly)} with draft charges only)` : ''}.`}
      </div>
      {charges.byType.length > 0 && <div className={css.groupTitle}>By charge type</div>}
      {charges.byType.map((t) => (
        <RankLine key={t.chargeTypeId}
          to={report}
          label={t.chargeName}
          sub={[`${formatNumber(t.enteredContainers)} posted`, t.draftContainers > 0 ? `${formatNumber(t.draftContainers)} in draft` : null]
            .filter(Boolean).join(' · ')}
          value={t.missingContainers > 0
            ? <span style={{ color: CHART.orange }}>{`${formatNumber(t.missingContainers)} without`}</span>
            : <span style={{ color: CHART.green }}>all</span>}
          share={received > 0 ? t.enteredContainers / received : 0} colour={CHART.green} />
      ))}
      {charges.list.length > 0 && <div className={css.groupTitle}>Without a posted charge</div>}
      {charges.list.map((c) => (
        <div key={c.containerId} className={css.line}>
          <div style={{ minWidth: 0 }}>
            <Link to={routes.container(c.containerId)} className={css.link}>{c.containerRef}</Link>
            <div className={css.sub}>
              {[c.containerNo, `received ${showDate(c.offloadedDate)}`].filter(Boolean).join(' · ')}
            </div>
          </div>
          <span className={css.badge} style={c.draftCharges > 0
            ? { color: CHART.orange, background: `${CHART.orange}22` }
            : { color: CHART.red, background: `${CHART.red}22` }}>
            {c.draftCharges > 0 ? plural(c.draftCharges, 'draft') : 'no charge'}
          </span>
        </div>
      ))}
    </Card>
  )
}

/* ── lead times ────────────────────────────────────────────────────────────────────────────────── */

function LeadTimesCard({ lead }: { lead: Insights<'leadTimes'> }) {
  const months = (days: number) => `${formatNumber(days / 30, 1)} months`
  const top = Math.max(0, ...lead.suppliers.map((s) => s.days))
  return (
    <Card title="Average lead time" note="last 12 months">
      <div className={css.bigFigure}>
        {lead.days === null ? '—' : `${formatNumber(lead.days, 0)} days`}
        {lead.days !== null && <span className={css.dim} style={{ fontSize: 13, fontWeight: 500, marginLeft: 8 }}>{`about ${months(lead.days)}`}</span>}
      </div>
      <div className={css.sub} style={{ marginBottom: 6, whiteSpace: 'normal' }}>
        {lead.days === null
          ? 'No goods were received from a purchase order in the last 12 months.'
          : `From the order date to the date received, over ${plural(lead.receipts, 'goods receipt')} and ${formatNumber(lead.pieces)} pcs.`}
      </div>
      {lead.suppliers.map((s) => (
        <RankLine key={s.supplierId}
          label={s.supplierName}
          sub={`${plural(s.receipts, 'goods receipt')} · ${formatNumber(s.pieces)} pcs`}
          value={`${formatNumber(s.days, 0)} days`}
          share={top > 0 ? s.days / top : 0} colour={CHART.pink} />
      ))}
    </Card>
  )
}
