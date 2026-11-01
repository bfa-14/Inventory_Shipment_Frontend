import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Alert, Button, Group, Loader } from '@mantine/core'
import { IconArrowLeft, IconPrinter } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemBalanceApi, queryFromParams, toParams, type ItemBalanceReportResult } from '../../api/reports/itemBalance'
import { dateLabel, stamp } from '../../components/documents/documentKind'
import { TestingMarker } from '../../environment/TestingMarker'
import { balanceColumns, cellText, headerGroups, rateText } from './itemBalanceColumns'

/**
 * The Item Balance Report on paper - and the PDF: the print dialog's "Save as PDF". Its own route outside the shell, like
 * the other print pages, so the screen is what the printer gets (A4 landscape, the shared print sheet).
 *
 * The same query as the screen (from the address), the same columns (itemBalanceColumns.ts), every row, the totals and
 * the footer; the header says the warehouses, the dates, the currency and its rate dates, when and by whom it was run.
 */
export function ItemBalanceReportPrintPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const query = useMemo(() => queryFromParams(params), [params])
  const [report, setReport] = useState<ItemBalanceReportResult | null>(null)
  const [error, setError] = useState<string | null>(query ? null : 'Run the report first.')
  const printed = useRef(false)

  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    itemBalanceApi
      .report(query, controller.signal, true)
      .then(setReport)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof ApiError ? err.message : 'The report could not be loaded.')
      })
    return () => controller.abort()
  }, [query])

  useEffect(() => {
    if (!report || printed.current) return
    printed.current = true
    const timer = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(timer)
  }, [report])

  const back = () => void navigate(query ? `/reports/item-balance?${toParams(query).toString()}` : '/reports/item-balance')

  if (error) {
    return (
      <div className="print-page">
        <TestingMarker />
        <Alert color="red" mb="md">{error}</Alert>
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>Back</Button>
      </div>
    )
  }
  if (!report || !query) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  const columns = balanceColumns(report, query.hideEmptyColumns)
  const groups = headerGroups(columns)
  const decimals = report.currency?.decimalPlaces ?? 2

  return (
    <div className="print-page">
      <TestingMarker />
      <Group justify="space-between" className="no-print" mb="md">
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>Back</Button>
        <Button leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>Print / Save as PDF</Button>
      </Group>

      <h1>Item Balance Report by Warehouse</h1>

      <dl className="print-page__header">
        <div><dt>Warehouses</dt><dd>{report.warehousesLabel}</dd></div>
        <div><dt>Period</dt><dd>{dateLabel(report.dateFrom)} to {dateLabel(report.dateTo)}</dd></div>
        {report.itemsLabel && <div><dt>Items</dt><dd>{report.itemsLabel}</dd></div>}
        {report.seesAmounts && report.currency ? (
          <div>
            <dt>Currency</dt>
            <dd>
              {report.currency.currencyCode}
              {report.currency.isBaseCurrency
                ? ' (base currency)'
                : ` · ${report.rateTypeName} rate · opening ${rateText(report, 'opening')} · movements at each day's rate · closing ${rateText(report, 'closing')}`}
            </dd>
          </div>
        ) : (
          <div><dt>Amounts</dt><dd>not shown (View item costs)</dd></div>
        )}
        <div><dt>Run</dt><dd>{stamp(report.generatedAtUtc)} by {report.generatedBy}</dd></div>
      </dl>

      {report.rows.length === 0 ? (
        <p>No data for the selected criteria.</p>
      ) : (
        <table className="print-page__table">
          <thead>
            <tr>
              {groups.map((g, i) => <th key={`${g.label}-${i}`} colSpan={g.span}>{g.label}</th>)}
              <th />
            </tr>
            <tr>
              {columns.map((c) => <th key={c.key} className={c.kind === 'text' ? 'left' : undefined}>{c.header}</th>)}
              <th className="left">Check</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={`${row.itemId}-${row.warehouseId}`} style={row.isNegative || !row.integrityOk ? { color: '#c92a2a' } : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.kind === 'text' ? 'left' : undefined}>{cellText(c, c.value(row), decimals)}</td>
                ))}
                <td className="left">{!row.integrityOk ? 'Does not add up' : row.isNegative ? 'Negative' : ''}</td>
              </tr>
            ))}
            <tr>
              {columns.map((c, i) => {
                const value = i === 0 ? null : c.total ? c.total(report.totals) : null
                return (
                  <td key={c.key} className={c.kind === 'text' ? 'left' : undefined}>
                    <b>{i === 0 ? `Total (${report.rows.length} rows)` : value === null ? '' : cellText(c, value, decimals, false)}</b>
                  </td>
                )
              })}
              <td />
            </tr>
          </tbody>
        </table>
      )}

      <p>
        {report.integrityFailures === 0
          ? 'Integrity check: every row’s opening and movements give the ledger’s quantity on Date To.'
          : `Integrity check: ${report.integrityFailures} row(s) do not add up (marked).`}
        {report.negativeRows > 0 ? ` ${report.negativeRows} row(s) with negative stock, included in the totals.` : ''}
      </p>
      {report.roundingNotes.map((note) => <p key={note}>{note}</p>)}
    </div>
  )
}
