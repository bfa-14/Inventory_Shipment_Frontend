import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Button, Group, Loader } from '@mantine/core'
import { IconArrowLeft, IconPrinter } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { shortagesApi, type ShortageDocumentDto } from '../../api/inventory/shortages'
import { dateLabel, stamp, unitLabel } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { SHORTAGES_ROUTE } from '../../components/shortages/shortageMath'

/**
 * The plan on paper: header block, lines, totals — and nothing else.
 *
 * ITS OWN ROUTE, OUTSIDE THE SHELL, so there is no navigation to hide: what is on the screen is
 * what comes out of the printer, and `@media print` only has to drop the two buttons. It reads the
 * SAVED document, which for a posted plan is the snapshot — paper must not show fresher numbers
 * than the record it is a copy of. The print dialog opens once the plan has loaded; the toolbar
 * stays for a second copy or the way back.
 */
export function ShortagePrintPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [document, setDocument] = useState<ShortageDocumentDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const printed = useRef(false)

  useEffect(() => {
    let cancelled = false
    shortagesApi
      .get(Number(id))
      .then((doc) => {
        if (!cancelled) setDocument(doc)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'The shortage plan could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!document || printed.current) return
    printed.current = true
    // After the paint that draws the table: a dialog opened earlier prints a blank page.
    const timer = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(timer)
  }, [document])

  const back = () => void navigate(document ? `${SHORTAGES_ROUTE}/${document.id}` : SHORTAGES_ROUTE)

  if (error) {
    return (
      <div className="print-page">
        <Alert color="red" mb="md">{error}</Alert>
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>Back</Button>
      </div>
    )
  }

  if (!document) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  const leadTime = formatNumber(document.leadTimeMonths, Number.isInteger(document.leadTimeMonths) ? 0 : 2)
  const header: [string, string][] = [
    ['Shortage No.', document.documentNumber],
    ['Description', document.description],
    ['Status', document.status],
    ['Date', dateLabel(document.documentDate)],
    ['Warehouse', `${document.warehouseCode} - ${document.warehouseName}`],
    ['Branch', `${document.branchCode} - ${document.branchName}`],
    ['Supplier', `${document.supplierCode} - ${document.supplierName}`],
    ['Lead Time (Month)', leadTime],
    ['Months of history', formatNumber(document.monthsOfHistory)],
    ['Created', `${document.createdByName ?? '—'}, ${stamp(document.createdAtUtc)}`],
    ['Last calculated', stamp(document.calculatedAtUtc)],
  ]
  if (document.status === 'Posted') header.push(['Posted', `${document.postedByName ?? '—'}, ${stamp(document.postedAtUtc)} - historical snapshot`])
  if (document.notes) header.push(['Notes', document.notes])

  return (
    <div className="print-page" data-shortage-print>
      <Group justify="space-between" className="no-print" mb="md">
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>Back</Button>
        <Button leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>Print</Button>
      </Group>

      <h1>Shortage Plan {document.documentNumber}</h1>

      <dl className="print-page__header">
        {header.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <table className="print-page__table">
        <thead>
          <tr>
            <th>#</th>
            <th className="left">Item</th>
            <th>Current Inventory</th>
            <th>Transit Qty</th>
            <th>Outstanding Order Qty</th>
            <th>Stock + Transit</th>
            <th>Total Expected Stock</th>
            <th>Expected Monthly Sales</th>
            <th>Lead Time (Month)</th>
            <th>Expected Requirement</th>
            <th>Shortage Qty</th>
            <th>Coverage</th>
            <th>Required Qty</th>
            <th>PC per Container</th>
            <th>Container Requirement</th>
            <th className="left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {document.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.lineNo}</td>
              <td className="left">
                <b>{line.itemCode}</b>
                <br />
                {line.itemName}
              </td>
              <td>{formatNumber(line.currentInventoryBase)}</td>
              <td>{formatNumber(line.transitBase)}</td>
              <td>{formatNumber(line.outstandingOrderBase)}</td>
              <td>{formatNumber(line.stockPlusTransitBase)}</td>
              <td>{formatNumber(line.totalExpectedStockBase)}</td>
              <td>
                {formatNumber(line.effectiveMonthlySales, 2)}
                {line.expectedMonthlySalesManual !== null ? ' (manual)' : ''}
              </td>
              <td>{leadTime}</td>
              <td>{formatNumber(line.expectedRequirementBase, 2)}</td>
              <td>{formatNumber(line.shortageBase)}</td>
              <td>{formatNumber(line.coverageMonths, 2)}</td>
              <td>
                {formatNumber(line.requiredQty)} {unitLabel(line.purchaseUnitName, line.purchasePackingFormula)}
              </td>
              <td>{formatNumber(line.pcPerContainer)}</td>
              <td>{formatNumber(line.containerRequirement, 2)}</td>
              <td className="left">{line.notes ?? ''}</td>
            </tr>
          ))}
          {document.lines.length === 0 && (
            <tr>
              <td colSpan={16} className="left">This plan has no lines.</td>
            </tr>
          )}
        </tbody>
      </table>

      <dl className="print-page__totals">
        <div><dt>Items</dt><dd>{formatNumber(document.totalLines)}</dd></div>
        <div><dt>Total Shortage (base units)</dt><dd>{formatNumber(document.totalShortageBase)}</dd></div>
        <div><dt>Total Required (base units)</dt><dd>{formatNumber(document.totalRequiredBase)}</dd></div>
        <div><dt>Containers</dt><dd>{formatNumber(document.totalContainers, 2)}</dd></div>
        <div><dt>Containers rounded</dt><dd>{formatNumber(document.containersRounded)}</dd></div>
        <div><dt>Utilization</dt><dd>{document.containerUtilizationPct === null ? '—' : `${formatNumber(document.containerUtilizationPct, 2)} %`}</dd></div>
      </dl>
    </div>
  )
}
