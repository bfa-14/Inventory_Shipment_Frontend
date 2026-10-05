import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Button, Group, Loader } from '@mantine/core'
import { IconArrowLeft, IconPrinter } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { paymentsApi, type PaymentDto } from '../../api/purchase/payments'
import { dateLabel, stamp } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { PAYMENTS_ROUTE } from '../../components/purchase/payment/paymentModel'

/**
 * The payment voucher on paper: header, payment details, the documents it paid, signatures.
 *
 * It reads the SAVED payment - paper must not show anything fresher than the record it copies - and says
 * plainly when the payment is a draft or has been reversed, so neither can pass for proof of payment.
 */
export function PaymentPrintPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [payment, setPayment] = useState<PaymentDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const printed = useRef(false)

  useEffect(() => {
    let cancelled = false
    paymentsApi
      .get(Number(id))
      .then((doc) => {
        if (!cancelled) setPayment(doc)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'The payment could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!payment || printed.current) return
    printed.current = true
    const timer = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(timer)
  }, [payment])

  const back = () => void navigate(payment ? `${PAYMENTS_ROUTE}/${payment.id}` : PAYMENTS_ROUTE)

  if (error) {
    return (
      <div className="print-page">
        <Alert color="red" mb="md">{error}</Alert>
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>Back</Button>
      </div>
    )
  }
  if (!payment) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  const base = payment.baseCurrencyCode ?? 'USD'
  const cur = payment.currencyCode
  const live = payment.allocations.filter((a) => a.isLive)
  const header: [string, string][] = [
    ['Payment No.', payment.paymentNumber ?? 'Draft - not yet numbered'],
    ['Status', payment.status],
    ['Date', dateLabel(payment.paymentDate)],
    ['Payee / Supplier', `${payment.payeeCode} - ${payment.payeeName}`],
    ['Branch', `${payment.branchCode} - ${payment.branchName}`],
    ['Payment type', payment.paymentTypeName],
    ['Amount', `${formatNumber(payment.amount, payment.decimalPlaces)} ${cur}`],
    ['Exchange rate', payment.isBaseCurrency ? `${base} (base currency)` : `${formatNumber(payment.exchangeRate, 4)} ${cur} per 1 ${base}`],
    [`Amount in ${base}`, formatNumber(payment.amountBase, 2)],
  ]
  if (payment.reference) header.push(['Reference', payment.reference])
  if (payment.payeeAddress) header.push(['Address', payment.payeeAddress])
  if (payment.notes) header.push(['Notes', payment.notes])
  if (payment.postedAtUtc) header.push(['Posted', `${payment.postedByName ?? '—'}, ${stamp(payment.postedAtUtc)}`])
  if (payment.status === 'Reversed') header.push(['Reversed', `${payment.reversedByName ?? '—'}, ${stamp(payment.reversedAtUtc)}. Reason: ${payment.reverseReason ?? '—'}`])

  return (
    <div className="print-page">
      <Group justify="space-between" className="no-print" mb="md">
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>Back</Button>
        <Button leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>Print</Button>
      </Group>

      <h1>Payment Voucher {payment.paymentNumber ?? '(draft)'}{payment.status !== 'Posted' ? ` — ${payment.status.toUpperCase()}` : ''}</h1>

      <dl className="print-page__header">
        {header.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <h3>Payment details</h3>
      <table className="print-page__table">
        <thead>
          <tr>
            <th>#</th>
            <th className="left">Method</th>
            <th>Amount</th>
            <th>Rate to {cur}</th>
            <th>Amount in {cur}</th>
            <th className="left">Account</th>
            <th className="left">Reference / cheque</th>
          </tr>
        </thead>
        <tbody>
          {payment.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.lineNo}</td>
              <td className="left">{line.methodName}</td>
              <td>{formatNumber(line.amount, line.decimalPlaces)} {line.currencyCode}</td>
              <td>{formatNumber(line.rateToPayment, line.rateToPayment === 1 ? 0 : 6)}</td>
              <td>{formatNumber(line.amountPaymentCurrency, 2)}</td>
              <td className="left">{line.accountCode} - {line.accountName}</td>
              <td className="left">
                {line.reference ?? ''}
                {line.isCheque ? ` Cheque ${line.chequeNo ?? ''} of ${dateLabel(line.chequeDate)}${line.chequeDueDate ? `, due ${dateLabel(line.chequeDueDate)}` : ''} (${line.clearanceStatusName ?? 'Pending'})` : ''}
              </td>
            </tr>
          ))}
          {payment.lines.length === 0 && (
            <tr><td colSpan={7} className="left">No payment lines.</td></tr>
          )}
          <tr>
            <th colSpan={4} className="left">Total</th>
            <th>{formatNumber(payment.linesTotal, 2)}</th>
            <th colSpan={2} />
          </tr>
        </tbody>
      </table>

      {live.length > 0 && (
        <>
          <h3>Paid documents</h3>
          <table className="print-page__table">
            <thead>
              <tr>
                <th className="left">Document</th>
                <th className="left">Date</th>
                <th className="left">Container</th>
                <th>Document total</th>
                <th>Paid</th>
                <th>In {cur}</th>
              </tr>
            </thead>
            <tbody>
              {live.map((a) => (
                <tr key={a.id}>
                  <td className="left">{a.documentNumber}{a.chargeTypeName ? ` (${a.chargeTypeName})` : ''}</td>
                  <td className="left">{dateLabel(a.documentDate)}</td>
                  <td className="left">{a.containerRef ?? ''}</td>
                  <td>{formatNumber(a.documentTotal, a.documentDecimalPlaces)} {a.documentCurrencyCode}</td>
                  <td>{formatNumber(a.amountDocCurrency, a.documentDecimalPlaces)} {a.documentCurrencyCode}</td>
                  <td>{formatNumber(a.amountPaymentCurrency, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <dl className="print-page__totals">
        <div><dt>Paid ({cur})</dt><dd>{formatNumber(payment.amount, payment.decimalPlaces)}</dd></div>
        <div><dt>Allocated to documents ({cur})</dt><dd>{formatNumber(payment.allocatedTotal, 2)}</dd></div>
        {payment.status === 'Posted' && payment.paymentType === 1 && (
          <div><dt>Unapplied advance ({cur})</dt><dd>{formatNumber(payment.unappliedAmount, 2)}</dd></div>
        )}
      </dl>

      <Group justify="space-between" mt={60} gap="xl" grow>
        <div style={{ borderTop: '1px solid #000', paddingTop: 4, fontSize: 11 }}>Prepared by</div>
        <div style={{ borderTop: '1px solid #000', paddingTop: 4, fontSize: 11 }}>Approved by</div>
        <div style={{ borderTop: '1px solid #000', paddingTop: 4, fontSize: 11 }}>Received by (payee)</div>
      </Group>
    </div>
  )
}
