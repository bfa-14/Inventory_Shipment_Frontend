import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Button, Group, Image, Loader, Text } from '@mantine/core'
import { IconArrowLeft, IconPrinter } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { goodsReceiptsApi, varianceReasonLabel, type GoodsReceiptDto } from '../../api/purchase/goodsReceipts'
import { katangaLogo } from '../../assets'
import { dateLabel, stamp, unitLabel } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { supplierText } from '../../components/purchase/goodsReceipts/goodsReceiptModel'
import { TestingMarker } from '../../environment/TestingMarker'
import { routes } from '../../routes'

/**
 * The goods receipt on paper, for signing at the gate: the receipt's header and its lines - item, expected, received,
 * difference, reason - and two signatures. NO COSTS: the paper goes to the driver and the warehouse.
 *
 * A DRAFT PRINTS AS THE COUNT SHEET: "DRAFT - not posted", the expected pieces, and empty boxes for the pieces counted
 * and the reason, to be filled in by hand and typed into the receipt before it is posted. It reads the SAVED receipt.
 */
export function GoodsReceiptPrintPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [receipt, setReceipt] = useState<GoodsReceiptDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const printed = useRef(false)

  useEffect(() => {
    let cancelled = false
    goodsReceiptsApi
      .get(Number(id))
      .then((doc) => {
        if (!cancelled) setReceipt(doc)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'The goods receipt could not be loaded.')
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

  const back = () => void navigate(receipt ? routes.goodsReceipt(receipt.id) : routes.goodsReceipts)

  if (error) {
    return (
      <div className="print-page">
        <TestingMarker />
        <Alert color="red" mb="md">
          {error}
        </Alert>
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>
          Back
        </Button>
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

  const draft = receipt.status === 1
  const cancelled = receipt.status === 3
  const header: [string, string][] = [
    ['Goods Receipt No.', receipt.documentNumber ?? 'DRAFT - not posted'],
    ['Date received', dateLabel(receipt.documentDate)],
    ['Warehouse', receipt.warehouseCode ? `${receipt.warehouseCode} - ${receipt.warehouseName ?? ''}` : '—'],
    ['Supplier', supplierText(receipt)],
    ['Branch', `${receipt.branchCode ? `${receipt.branchCode} - ` : ''}${receipt.branchName}`],
  ]
  if (receipt.containerId) {
    header.push(['Container', [receipt.containerRef, receipt.containerNo].filter(Boolean).join(' / ') || '—'])
    header.push(['Seal no.', receipt.sealNo ?? '—'])
    header.push(['Truck no.', receipt.truckNo ?? '—'])
    header.push(['Waybill no.', receipt.waybillNo ?? '—'])
  }
  const orders = [...new Set([receipt.purchaseOrderNumber, ...receipt.lines.map((l) => l.orderNumber)].filter((n): n is string => !!n))]
  const invoices = [...new Set([receipt.purchaseInvoiceNumber, ...receipt.lines.map((l) => l.invoiceNumber)].filter((n): n is string => !!n))]
  if (orders.length > 0) header.push([orders.length > 1 ? 'Orders' : 'Order', orders.join(', ')])
  if (invoices.length > 0) header.push([invoices.length > 1 ? 'Invoices' : 'Invoice', invoices.join(', ')])
  if (receipt.supplierReference) header.push(['Delivery note no.', receipt.supplierReference])
  if (receipt.movementNo) header.push(['Movement', receipt.movementNo])
  if (receipt.notes) header.push(['Notes', receipt.notes])
  if (receipt.postedAtUtc) header.push(['Posted', `${receipt.postedByName ?? '—'}, ${stamp(receipt.postedAtUtc)}`])
  if (cancelled) header.push(['Cancelled', `${receipt.cancelledByName ?? '—'}, ${stamp(receipt.cancelledAtUtc)}. Reason: ${receipt.cancelReason ?? '—'}`])

  const totalExpected = receipt.lines.reduce((sum, l) => sum + (l.expectedQuantityBase ?? 0), 0)
  const totalReceived = receipt.lines.reduce((sum, l) => sum + l.quantityBase, 0)

  return (
    <div className="print-page">
      <TestingMarker />
      <Group justify="space-between" className="no-print" mb="md">
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>
          Back
        </Button>
        <Button leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
          Print
        </Button>
      </Group>

      <Group justify="space-between" align="center" mb="sm" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <Image src={katangaLogo} alt="Katanga TVS Motor Company" h={44} w="auto" fit="contain" />
          <div>
            <Text fw={700} fz={15}>
              Katanga TVS Motor Company
            </Text>
            <Text fz={11} c="dimmed">
              Inventory & Shipment
            </Text>
          </div>
        </Group>
        <Text fw={700} fz={13} ta="right">
          {draft ? 'DRAFT - not posted' : cancelled ? 'CANCELLED' : ''}
        </Text>
      </Group>

      <h1>
        Goods Receipt {receipt.documentNumber ?? ''}
        {draft ? ' — count sheet' : ''}
      </h1>

      <dl className="print-page__header">
        {header.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {draft && (
        <p style={{ margin: '0 0 8px' }}>
          Count sheet: write the pieces counted and, when they differ from the expected pieces, the reason. The goods are not in stock until
          the receipt is posted.
        </p>
      )}

      <table className="print-page__table">
        <thead>
          <tr>
            <th>#</th>
            <th className="left">Item</th>
            <th className="left">Unit</th>
            <th>Expected (pcs)</th>
            <th>Received (pcs)</th>
            <th>Difference</th>
            <th className="left">Reason</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line, index) => {
            const difference = line.expectedQuantityBase === null ? null : line.quantityBase - line.expectedQuantityBase
            const reason = [varianceReasonLabel(line.varianceReasonCode), line.varianceReason].filter(Boolean).join(' - ')
            return (
              <tr key={line.id}>
                <td>{index + 1}</td>
                <td className="left">
                  {line.itemCode} - {line.itemName}
                  {line.containerLineNumber !== null ? ` (load line ${line.containerLineNumber})` : ''}
                </td>
                <td className="left">{unitLabel(line.unitTypeName ?? '', line.packingFormula)}</td>
                <td>{line.expectedQuantityBase === null ? '' : formatNumber(line.expectedQuantityBase)}</td>
                {/* A count sheet leaves the counting to the pen. */}
                <td style={{ minWidth: 90 }}>{draft ? '' : formatNumber(line.quantityBase)}</td>
                <td style={{ minWidth: 80 }}>{draft || difference === null ? '' : `${difference > 0 ? '+' : ''}${formatNumber(difference)}`}</td>
                <td className="left" style={{ minWidth: 180 }}>
                  {draft ? '' : reason}
                </td>
              </tr>
            )
          })}
          {receipt.lines.length === 0 && (
            <tr>
              <td colSpan={7} className="left">
                No lines.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <dl className="print-page__totals">
        <div>
          <dt>Expected (pcs)</dt>
          <dd>{formatNumber(totalExpected)}</dd>
        </div>
        <div>
          <dt>Received (pcs)</dt>
          <dd>{draft ? '' : formatNumber(totalReceived)}</dd>
        </div>
      </dl>

      <Group justify="space-between" mt={60} gap="xl" grow>
        <div style={{ borderTop: '1px solid #000', paddingTop: 4, fontSize: 11 }}>Received by</div>
        <div style={{ borderTop: '1px solid #000', paddingTop: 4, fontSize: 11 }}>Delivered by / driver</div>
      </Group>
    </div>
  )
}
