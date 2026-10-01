import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Button, Group, Loader } from '@mantine/core'
import { IconArrowLeft, IconPrinter } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { receiptsApi, type ReceiptDto } from '../../api/sales/receipts'
import { dateLabel, stamp } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'

const ROUTE = '/sales/receipts'

/**
 * The receipt on paper: header, payment lines, the invoices it paid, signatures.
 *
 * It reads the SAVED receipt — paper must not show anything fresher than the record it copies — and
 * says plainly when the receipt is a draft or has been reversed, so a copy of either cannot be
 * mistaken for proof of payment.
 */
export function ReceiptPrintPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [receipt, setReceipt] = useState<ReceiptDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const printed = useRef(false)

  useEffect(() => {
    let cancelled = false
    receiptsApi
      .get(Number(id))
      .then((doc) => {
        if (!cancelled) setReceipt(doc)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'The receipt could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!receipt || printed.current) return
    printed.current = true
    const timer = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(timer)
  }, [receipt])

  const back = () => void navigate(receipt ? `${ROUTE}/${receipt.id}` : ROUTE)

  if (error) {
    return (
      <div className="print-page">
        <Alert color="red" mb="md">{error}</Alert>
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>Back</Button>
      </div>
    )
  }
  if (!receipt) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  const base = receipt.baseCurrencyCode ?? 'USD'
  const live = receipt.allocations.filter((a) => a.isLive)
  const header: [string, string][] = [
    ['Receipt No.', receipt.receiptNumber ?? 'Draft - not yet numbered'],
    ['Status', receipt.status],
    ['Date', dateLabel(receipt.receiptDate)],
    ['Customer', `${receipt.clientCode} - ${receipt.clientName}`],
    ['Branch', `${receipt.branchCode} - ${receipt.branchName}`],
    ['Payment type', receipt.paymentTypeName],
    ['Amount', `${formatNumber(receipt.amount, receipt.decimalPlaces)} ${receipt.currencyCode}`],
    ['Exchange rate', receipt.isBaseCurrency ? `${base} (base currency)` : `${formatNumber(receipt.exchangeRate, 4)} ${receipt.currencyCode} per 1 ${base}`],
    [`Amount in ${base}`, formatNumber(receipt.amountBase, 2)],
  ]
  if (receipt.clientAddress) header.push(['Address', receipt.clientAddress])
  if (receipt.notes) header.push(['Notes', receipt.notes])
  if (receipt.postedAtUtc) header.push(['Posted', `${receipt.postedByName ?? '—'}, ${stamp(receipt.postedAtUtc)}`])
  if (receipt.status === 'Reversed') header.push(['Reversed', `${receipt.reversedByName ?? '—'}, ${stamp(receipt.reversedAtUtc)}. Reason: ${receipt.reverseReason ?? '—'}`])

  return (
    <div className="print-page">
      <Group justify="space-between" className="no-print" mb="md">
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>Back</Button>
        <Button leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>Print</Button>
      </Group>

      <h1>Receipt {receipt.receiptNumber ?? '(draft)'}{receipt.status !== 'Posted' ? ` — ${receipt.status.toUpperCase()}` : ''}</h1>

      <dl className="print-page__header">
        {header.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <h3>Payment</h3>
      <table className="print-page__table">
        <thead>
          <tr>
            <th>#</th>
            <th className="left">Method</th>
            <th>Amount</th>
            <th>Rate</th>
            <th>Amount ({base})</th>
            <th className="left">Account</th>
            <th className="left">Reference</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.lineNo}</td>
              <td className="left">{line.methodName}</td>
              <td>{formatNumber(line.amount, line.decimalPlaces)} {line.currencyCode}</td>
              <td>{formatNumber(line.exchangeRate, 4)}</td>
              <td>{formatNumber(line.amountBase, 2)}</td>
              <td className="left">{line.accountCode} - {line.accountName}</td>
              <td className="left">{line.reference ?? ''}</td>
            </tr>
          ))}
          {receipt.lines.length === 0 && (
            <tr><td colSpan={7} className="left">No payment lines.</td></tr>
          )}
        </tbody>
      </table>

      {live.length > 0 && (
        <>
          <h3>Applied to invoices</h3>
          <table className="print-page__table">
            <thead>
              <tr>
                <th className="left">Invoice</th>
                <th className="left">Invoice date</th>
                <th>Invoice total</th>
                <th>Applied</th>
                <th>Value ({base})</th>
              </tr>
            </thead>
            <tbody>
              {live.map((a) => (
                <tr key={a.id}>
                  <td className="left">{a.invoiceNumber}</td>
                  <td className="left">{dateLabel(a.invoiceDate)}</td>
                  <td>{formatNumber(a.invoiceTotal, a.invoiceDecimalPlaces)} {a.invoiceCurrencyCode}</td>
                  <td>{formatNumber(a.amountInvoiceCurrency, a.invoiceDecimalPlaces)} {a.invoiceCurrencyCode}</td>
                  <td>{formatNumber(a.amountBase, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <dl className="print-page__totals">
        <div><dt>Received ({base})</dt><dd>{formatNumber(receipt.amountBase, 2)}</dd></div>
        <div><dt>Applied to invoices ({base})</dt><dd>{formatNumber(receipt.allocatedBase, 2)}</dd></div>
        {receipt.status === 'Posted' && receipt.paymentType === 1 && (
          <div><dt>Not yet applied ({base})</dt><dd>{formatNumber(receipt.unappliedBase, 2)}</dd></div>
        )}
      </dl>

      <Group justify="space-between" mt={60} gap="xl" grow>
        <div style={{ borderTop: '1px solid #000', paddingTop: 4, fontSize: 11 }}>Received by</div>
        <div style={{ borderTop: '1px solid #000', paddingTop: 4, fontSize: 11 }}>Customer signature</div>
      </Group>
    </div>
  )
}
