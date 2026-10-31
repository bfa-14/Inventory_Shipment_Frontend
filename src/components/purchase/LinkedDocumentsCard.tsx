import { useState } from 'react'
import { Anchor, Badge, Button, Checkbox, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { Link } from 'react-router'
import { routes } from '../../routes'
import type { BulkActionResult } from '../../api/documents'
import { ApiError } from '../../api/http'
import { goodsReceiptStatusColour, goodsReceiptStatusLabel, toGoodsReceiptStatus } from '../../api/purchase/goodsReceipts'
import { purchaseDocumentsApi, type LinkedPurchaseDocumentDto, type PurchaseDocumentGoodsReceiptDto } from '../../api/purchase/documents'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../navigation'
import { BulkResultsModal } from '../documents/BulkResultsModal'
import { dateLabel } from '../documents/documentKind'
import { formatMoney, formatNumber } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { purchaseKindOf, purchaseStatusColour, purchaseStatusLabel } from './purchaseKind'

interface LinkedDocumentsCardProps {
  linked: LinkedPurchaseDocumentDto[]
  /**
   * An order's page, read by someone who may post invoices: its DRAFT invoices can be ticked and posted
   * together ("Post selected") — one invoice per item makes several drafts per order.
   */
  canPostInvoices?: boolean
  /** After "Post selected": the page reads the order again, so the card shows the new numbers. */
  onPosted?: () => void
  /** The goods receipts of the order's or the invoice's lines: where its goods came in. */
  goodsReceipts?: PurchaseDocumentGoodsReceiptDto[]
}

/**
 * The chain this document sits in: what it came from, and what was made from it.
 *
 * AN ORDER'S INVOICES, ITS GOODS RECEIPTS AND AN INVOICE'S RETURNS ARE WHERE THE GOODS WENT, so they are one click
 * away rather than a search. Each is named with its kind and its status (an order: Saved, Partially posted or Posted,
 * from its posted invoices), because a cancelled invoice under an order brings the order back to Partially posted or
 * Saved and a reader should see that here. A goods receipt is a link only for a reader who may
 * open goods receipts.
 */
export function LinkedDocumentsCard({ linked, canPostInvoices = false, onPosted, goodsReceipts = [] }: LinkedDocumentsCardProps) {
  const { hasPermission } = useAuth()
  const canViewReceipts = hasPermission(PERMISSIONS.goodsReceiptsView)
  const source = linked.filter((l) => l.relation === 'Source')
  const children = linked.filter((l) => l.relation === 'Child')
  const postable = (doc: LinkedPurchaseDocumentDto) =>
    canPostInvoices && doc.relation === 'Child' && doc.documentTypeCode === 'PINV' && doc.status === 'Draft'

  const [selected, setSelected] = useState<number[]>([])
  const [posting, setPosting] = useState(false)
  const [result, setResult] = useState<BulkActionResult | null>(null)
  /* What is ticked and still a draft: a reload may have posted or removed some. */
  const ticked = selected.filter((id) => children.some((doc) => doc.id === id && postable(doc)))

  async function postSelected() {
    const go = await confirm({
      title: `Post ${formatNumber(ticked.length)} invoice(s)`,
      message: `Post the ${formatNumber(ticked.length)} selected draft invoice(s)? Each is posted on its own: one refusal does not stop the others.`,
      confirmLabel: 'Post selected',
    })
    if (!go) return
    setPosting(true)
    try {
      const results = await purchaseDocumentsApi.postMany(ticked)
      setResult({
        requested: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      })
      setSelected((current) => current.filter((id) => !results.some((r) => r.id === id && r.ok)))
      onPosted?.()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The invoices could not be posted.')
    } finally {
      setPosting(false)
    }
  }

  const row = (doc: LinkedPurchaseDocumentDto) => {
    const kind = purchaseKindOf(doc.documentTypeCode)
    const label = doc.documentNumber ?? `${kind?.title ?? doc.documentTypeName} draft #${doc.id}`
    return (
      <Group key={`${doc.relation}-${doc.id}`} justify="space-between" wrap="nowrap" gap="xs" data-linked-document={doc.id}>
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          {canPostInvoices && doc.relation === 'Child' ? (
            <Checkbox
              size="xs"
              checked={ticked.includes(doc.id)}
              disabled={!postable(doc) || posting}
              onChange={(event) => {
                const on = event.currentTarget.checked
                setSelected((current) => (on ? [...current, doc.id] : current.filter((id) => id !== doc.id)))
              }}
              aria-label={`Select ${label}`}
            />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <Anchor component={Link} to={routes.purchaseDocument(doc.documentTypeCode, doc.id)} fz="sm" fw={500}>
              {label}
            </Anchor>
            <Text fz="xs" c="dimmed">
              {kind?.title ?? doc.documentTypeName} · {dateLabel(doc.documentDate)} · {formatMoney(doc.totalAmount, doc.currencyCode)}
            </Text>
          </div>
        </Group>
        <Badge color={purchaseStatusColour(doc.status, doc.documentTypeCode, doc.invoicingStatus)} variant="light" style={{ flexShrink: 0 }}>
          {purchaseStatusLabel(doc.status, doc.documentTypeCode, doc.invoicingStatus)}
        </Badge>
      </Group>
    )
  }

  const receiptRow = (receipt: PurchaseDocumentGoodsReceiptDto) => {
    const status = toGoodsReceiptStatus(receipt.status)
    const label = receipt.documentNumber ?? `Goods receipt draft #${receipt.id}`
    const where = [receipt.containerRef, receipt.warehouseCode ?? receipt.warehouseName].filter(Boolean).join(' · ')
    return (
      <Group key={`grn-${receipt.id}`} justify="space-between" wrap="nowrap" gap="xs" data-linked-goods-receipt={receipt.id}>
        <div style={{ minWidth: 0 }}>
          {canViewReceipts ? (
            <Anchor component={Link} to={routes.goodsReceipt(receipt.id)} fz="sm" fw={500}>
              {label}
            </Anchor>
          ) : (
            <Text fz="sm" fw={500}>
              {label}
            </Text>
          )}
          <Text fz="xs" c="dimmed">
            Goods receipt · {dateLabel(receipt.documentDate)} · {formatNumber(receipt.hereBase ?? receipt.receivedBase)} pcs{where ? ` · ${where}` : ''}
          </Text>
        </div>
        <Badge color={goodsReceiptStatusColour(status)} variant="light" style={{ flexShrink: 0 }}>
          {goodsReceiptStatusLabel(status)}
        </Badge>
      </Group>
    )
  }

  return (
    <Paper radius="lg" p="md" withBorder data-linked-documents>
      <Group justify="space-between" mb="sm" gap="xs">
        <Title order={5}>Linked Documents</Title>
        {canPostInvoices && children.some(postable) ? (
          <Button size="xs" disabled={ticked.length === 0} loading={posting} onClick={() => void postSelected()} data-post-selected>
            Post selected{ticked.length > 0 ? ` (${formatNumber(ticked.length)})` : ''}
          </Button>
        ) : null}
      </Group>

      {linked.length === 0 && goodsReceipts.length === 0 ? (
        <Text fz="sm" c="dimmed">
          Nothing is linked to this document yet.
        </Text>
      ) : (
        <Stack gap="sm">
          {source.length > 0 && (
            <div>
              <Text fz="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
                Source
              </Text>
              <Stack gap="xs">{source.map(row)}</Stack>
            </div>
          )}
          {children.length > 0 && (
            <div>
              <Text fz="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
                Created from this document
              </Text>
              <Stack gap="xs">{children.map(row)}</Stack>
            </div>
          )}
          {goodsReceipts.length > 0 && (
            <div data-linked-goods-receipts>
              <Text fz="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
                Goods receipts
              </Text>
              <Stack gap="xs">{goodsReceipts.map(receiptRow)}</Stack>
            </div>
          )}
        </Stack>
      )}

      <BulkResultsModal
        opened={result !== null}
        title="Post selected invoices"
        result={result}
        successLabel="Posted"
        labelOf={(item) => `Purchase invoice draft #${item.id}`}
        onClose={() => setResult(null)}
      />
    </Paper>
  )
}
