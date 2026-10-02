import { useState } from 'react'
import { Anchor, Badge, Button, Checkbox, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { Link } from 'react-router'
import { routes } from '../../routes'
import type { BulkActionResult } from '../../api/documents'
import { ApiError } from '../../api/http'
import { purchaseDocumentsApi, type LinkedPurchaseDocumentDto } from '../../api/purchase/documents'
import { BulkResultsModal } from '../documents/BulkResultsModal'
import { dateLabel } from '../documents/documentKind'
import { formatMoney, formatNumber } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { PURCHASE_STATUS_COLOURS, purchaseKindOf, purchaseStatusLabel } from './purchaseKind'

interface LinkedDocumentsCardProps {
  linked: LinkedPurchaseDocumentDto[]
  /**
   * An order's page, read by someone who may post invoices: its DRAFT invoices can be ticked and posted
   * together ("Post selected") — one invoice per item makes several drafts per order.
   */
  canPostInvoices?: boolean
  /** After "Post selected": the page reads the order again, so the card shows the new numbers. */
  onPosted?: () => void
}

/**
 * The chain this document sits in: what it came from, and what was made from it.
 *
 * AN ORDER'S INVOICES AND AN INVOICE'S RETURNS ARE WHERE THE STOCK WENT, so they are one click away
 * rather than a search. Each is named with its kind and its status, because a cancelled invoice
 * under an order means the order is open again and a reader should see that here.
 */
export function LinkedDocumentsCard({ linked, canPostInvoices = false, onPosted }: LinkedDocumentsCardProps) {
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
        <Badge color={PURCHASE_STATUS_COLOURS[doc.status] ?? 'gray'} variant="light" style={{ flexShrink: 0 }}>
          {purchaseStatusLabel(doc.status)}
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

      {linked.length === 0 ? (
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
