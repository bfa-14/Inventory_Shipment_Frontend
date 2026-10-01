import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Alert, Button, Group, Loader } from '@mantine/core'
import { IconArrowLeft, IconPrinter } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { receiptsApi, type CustomerStatementDto } from '../../api/sales/receipts'
import { dateLabel, stamp } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { STATEMENT_ROUTE } from '../../components/sales/receipt/receiptModel'

/**
 * The statement on paper. Its own route outside the shell (like the shortage plan), so the screen is
 * what the printer gets and `@media print` only has to drop the two buttons.
 */
export function CustomerStatementPrintPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [statement, setStatement] = useState<CustomerStatementDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const printed = useRef(false)

  const clientId = Number(params.get('clientId'))
  const dateFrom = params.get('dateFrom')
  const dateTo = params.get('dateTo')

  useEffect(() => {
    let cancelled = false
    receiptsApi
      .statement(clientId, dateFrom, dateTo)
      .then((doc) => {
        if (!cancelled) setStatement(doc)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'The statement could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [clientId, dateFrom, dateTo])

  useEffect(() => {
    if (!statement || printed.current) return
    printed.current = true
    const timer = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(timer)
  }, [statement])

  const back = () => void navigate(STATEMENT_ROUTE)

  if (error) {
    return (
      <div className="print-page">
        <Alert color="red" mb="md">{error}</Alert>
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>Back</Button>
      </div>
    )
  }
  if (!statement) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  const base = statement.baseCurrencyCode ?? 'USD'
  const money = (value: number) => (value === 0 ? '' : formatNumber(value, 2))
  const period = dateFrom || dateTo ? `${dateFrom ? dateLabel(dateFrom) : 'the beginning'} to ${dateTo ? dateLabel(dateTo) : 'today'}` : 'All dates'

  return (
    <div className="print-page">
      <Group justify="space-between" className="no-print" mb="md">
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>Back</Button>
        <Button leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>Print</Button>
      </Group>

      <h1>Customer Statement</h1>

      <dl className="print-page__header">
        <div><dt>Customer</dt><dd>{statement.clientCode} - {statement.clientName}</dd></div>
        <div><dt>Period</dt><dd>{period}</dd></div>
        <div><dt>Currency</dt><dd>{base} (documents in other currencies are converted at their own rate)</dd></div>
        <div><dt>Printed</dt><dd>{stamp(new Date().toISOString())}</dd></div>
      </dl>

      <table className="print-page__table">
        <thead>
          <tr>
            <th>#</th>
            <th className="left">Date</th>
            <th className="left">Type</th>
            <th className="left">Document</th>
            <th>Document amount</th>
            <th>Debit ({base})</th>
            <th>Credit ({base})</th>
            <th>Balance ({base})</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td />
            <td className="left" colSpan={6}><b>Balance brought forward</b></td>
            <td><b>{formatNumber(statement.openingBalance, 2)}</b></td>
          </tr>
          {statement.entries.map((entry, index) => (
            <tr key={`${index}-${entry.entryType}-${entry.documentId}`}>
              <td>{index + 1}</td>
              <td className="left">{dateLabel(entry.entryDate)}</td>
              <td className="left">{entry.entryType}</td>
              <td className="left">{entry.documentNumber ?? ''}</td>
              <td>{formatNumber(entry.docAmount, entry.decimalPlaces)} {entry.currencyCode}</td>
              <td>{money(entry.debit)}</td>
              <td>{money(entry.credit)}</td>
              <td>{formatNumber(entry.balance, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="print-page__totals">
        <div><dt>Balance brought forward</dt><dd>{formatNumber(statement.openingBalance, 2)} {base}</dd></div>
        <div><dt>Total debit</dt><dd>{formatNumber(statement.totalDebit, 2)} {base}</dd></div>
        <div><dt>Total credit</dt><dd>{formatNumber(statement.totalCredit, 2)} {base}</dd></div>
        <div><dt>Balance owed</dt><dd><b>{formatNumber(statement.closingBalance, 2)} {base}</b></dd></div>
      </dl>
    </div>
  )
}
