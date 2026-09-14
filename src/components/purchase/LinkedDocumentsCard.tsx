import { Anchor, Badge, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { Link } from 'react-router'
import type { LinkedPurchaseDocumentDto } from '../../api/purchase/documents'
import { dateLabel } from '../documents/documentKind'
import { formatMoney } from '../format'
import { PURCHASE_STATUS_COLOURS, purchaseKindOf } from './purchaseKind'

/**
 * The chain this document sits in: what it came from, and what was made from it.
 *
 * AN ORDER'S INVOICES AND AN INVOICE'S RETURNS ARE WHERE THE STOCK WENT, so they are one click away
 * rather than a search. Each is named with its kind and its status, because a cancelled invoice
 * under an order means the order is open again and a reader should see that here.
 */
export function LinkedDocumentsCard({ linked }: { linked: LinkedPurchaseDocumentDto[] }) {
  const source = linked.filter((l) => l.relation === 'Source')
  const children = linked.filter((l) => l.relation === 'Child')

  const row = (doc: LinkedPurchaseDocumentDto) => {
    const kind = purchaseKindOf(doc.documentTypeCode)
    return (
      <Group key={`${doc.relation}-${doc.id}`} justify="space-between" wrap="nowrap" gap="xs">
        <div style={{ minWidth: 0 }}>
          <Anchor component={Link} to={`${kind?.route ?? '/purchase/orders'}/${doc.id}`} fz="sm" fw={500}>
            {doc.documentNumber ?? `${kind?.title ?? doc.documentTypeName} draft #${doc.id}`}
          </Anchor>
          <Text fz="xs" c="dimmed">
            {kind?.title ?? doc.documentTypeName} · {dateLabel(doc.documentDate)} · {formatMoney(doc.totalAmount, doc.currencyCode)}
          </Text>
        </div>
        <Badge color={PURCHASE_STATUS_COLOURS[doc.status] ?? 'gray'} variant="light">
          {doc.status}
        </Badge>
      </Group>
    )
  }

  return (
    <Paper radius="lg" p="md" withBorder data-linked-documents>
      <Title order={5} mb="sm">
        Linked Documents
      </Title>

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
    </Paper>
  )
}
