import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Button, Group, Image, Loader, Text } from '@mantine/core'
import { IconArrowLeft, IconPrinter } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { transfersApi, type TransferOrderDto, type TransferWarehouseRefDto } from '../../api/inventory/transfers'
import { katangaLogo } from '../../assets'
import { dateLabel } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { TestingMarker } from '../../environment/TestingMarker'
import { routes } from '../../routes'

/** A4 PORTRAIT for this page alone: the shared print sheet is landscape (the wide count sheets). Later, so it wins. */
const PORTRAIT = '@media print { @page { size: A4 portrait; margin: 12mm; } }'

/** "LKS-01 - Likasi Warehouse (Likasi Branch)". */
function placeText(ref: TransferWarehouseRefDto): string {
  const branch = ref.branchName ?? ref.branchCode
  return `${ref.code} - ${ref.name}${branch ? ` (${branch})` : ''}`
}

/** One signature box: who, when, and the signature itself. */
function SignatureBox({ title }: { title: string }) {
  const line = { borderBottom: '1px solid #000', height: 22, marginBottom: 6 }
  return (
    <div style={{ border: '1px solid #000', padding: 8, fontSize: 11, flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{title}</div>
      <div>Name</div>
      <div style={line} />
      <div>Date</div>
      <div style={line} />
      <div>Signature</div>
      <div style={{ ...line, height: 36 }} />
    </div>
  )
}

/**
 * The dispatch note on paper (script 90, M15): the sheet that travels on the truck with the goods of one dispatch -
 * which order, from where to where, when it left and when it is expected, the items and their pieces, and three
 * signatures (the one who dispatched, the driver, the one who received). NO COST EVER: the paper goes to drivers and
 * storekeepers.
 *
 * Outside the shell like the goods receipt's count sheet (`window.print()` once loaded), read from the order (GET
 * …/{id}): the dispatch is one of its postings.
 */
export function TransferDispatchPrintPage() {
  const { id, postingId } = useParams<{ id: string; postingId: string }>()
  const navigate = useNavigate()
  const [order, setOrder] = useState<TransferOrderDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const printed = useRef(false)

  useEffect(() => {
    let cancelled = false
    transfersApi
      .get(Number(id))
      .then((doc) => {
        if (!cancelled) setOrder(doc)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'The transfer order could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const posting = order?.postings.find((p) => p.id === Number(postingId) && p.kind === 'Dispatch') ?? null

  useEffect(() => {
    if (!posting || printed.current) return
    printed.current = true
    const timer = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(timer)
  }, [posting])

  const back = () => void navigate(order ? routes.transferOrder(order.id) : routes.transferOrders)

  const problem = error ?? (order && !posting ? 'Dispatch or receipt not found.' : null)
  if (problem) {
    return (
      <div className="print-page">
        <TestingMarker />
        <Alert color="red" mb="md">
          {problem}
        </Alert>
        <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>
          Back
        </Button>
      </div>
    )
  }
  if (!order || !posting) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  const reversed = posting.status === 'Reversed'
  const header: [string, string][] = [
    ['Transfer order', order.documentNumber ?? `#${order.id}`],
    ['From', placeText(order.from)],
    ['To', placeText(order.to)],
    ['Dispatch date', dateLabel(posting.postingDate)],
    ['ETA', dateLabel(posting.eta)],
    ['Waybill / truck', posting.referenceNo || '—'],
  ]
  if (posting.notes) header.push(['Notes', posting.notes])
  const totalPieces = posting.lines.reduce((sum, line) => sum + line.quantityBase, 0)

  return (
    <div className="print-page">
      <style>{PORTRAIT}</style>
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
          {reversed ? 'REVERSED' : ''}
        </Text>
      </Group>

      <h1>Dispatch note {posting.documentNumber}</h1>

      <dl className="print-page__header">
        {header.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {/* The note is read on a phone too: the table keeps the page's width there. */}
      <table className="print-page__table" style={{ minWidth: 0 }}>
        <thead>
          <tr>
            <th>#</th>
            <th className="left">Item code</th>
            <th className="left">Item name</th>
            <th>Pcs</th>
          </tr>
        </thead>
        <tbody>
          {posting.lines.map((line, index) => (
            <tr key={line.id}>
              <td>{index + 1}</td>
              <td className="left">{line.itemCode}</td>
              <td className="left">{line.itemName}</td>
              <td>{formatNumber(line.quantityBase)}</td>
            </tr>
          ))}
          {posting.lines.length === 0 && (
            <tr>
              <td colSpan={4} className="left">
                No lines.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <dl className="print-page__totals">
        <div>
          <dt>Total pcs</dt>
          <dd>{formatNumber(totalPieces)}</dd>
        </div>
      </dl>

      <div style={{ display: 'flex', gap: 12, marginTop: 40, flexWrap: 'wrap' }}>
        <SignatureBox title="Dispatched by" />
        <SignatureBox title="Driver" />
        <SignatureBox title="Received by" />
      </div>
    </div>
  )
}
