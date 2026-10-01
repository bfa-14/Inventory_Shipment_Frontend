import { ActionIcon, Badge, Group, Paper, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import type { ReceiptAllocationDto } from '../../../api/sales/receipts'
import { dateLabel, stamp } from '../../documents/documentKind'
import { formatNumber } from '../../format'

interface ReceiptAppliedCardProps {
  allocations: ReceiptAllocationDto[]
  baseCurrencyCode: string
  /** Taking an allocation back: only on a posted Free Receipt, whose credit it returns. */
  canRemove: boolean
  onRemove: (allocation: ReceiptAllocationDto) => void
}

/**
 * Which invoices a saved receipt has paid.
 *
 * A REMOVED ALLOCATION STAYS IN THE LIST, struck through, with who took it back and when. It is the
 * record that the invoice was once marked paid by this receipt: deleting the row would make an
 * invoice that went back to "Unpaid" look as though it never had a payment against it.
 */
export function ReceiptAppliedCard({ allocations, baseCurrencyCode, canRemove, onRemove }: ReceiptAppliedCardProps) {
  if (allocations.length === 0) return null

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">Applied to invoices</Title>
      <Table.ScrollContainer minWidth={760}>
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Invoice</Table.Th>
              <Table.Th w={110}>Invoice date</Table.Th>
              <Table.Th w={150} ta="right">Applied</Table.Th>
              <Table.Th w={120} ta="right">Rate</Table.Th>
              <Table.Th w={140} ta="right">Value ({baseCurrencyCode})</Table.Th>
              <Table.Th>Allocated</Table.Th>
              <Table.Th w={50} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {allocations.map((a) => (
              <Table.Tr key={a.id} c={a.isLive ? undefined : 'dimmed'}>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" fw={500} td={a.isLive ? undefined : 'line-through'}>{a.invoiceNumber}</Text>
                    {!a.isLive && <Badge size="xs" color="gray" variant="light">Removed</Badge>}
                  </Group>
                </Table.Td>
                <Table.Td>{dateLabel(a.invoiceDate)}</Table.Td>
                <Table.Td ta="right">{formatNumber(a.amountInvoiceCurrency, a.invoiceDecimalPlaces)} {a.invoiceCurrencyCode}</Table.Td>
                <Table.Td ta="right">{formatNumber(a.invoiceExchangeRate, 4)}</Table.Td>
                <Table.Td ta="right">{formatNumber(a.amountBase, 2)}</Table.Td>
                <Table.Td>
                  <Text size="sm">{stamp(a.allocatedAtUtc)}{a.allocatedByName ? ` · ${a.allocatedByName}` : ''}</Text>
                  {a.removedAtUtc && <Text size="xs" c="dimmed">Removed {stamp(a.removedAtUtc)}{a.removedByName ? ` · ${a.removedByName}` : ''}</Text>}
                </Table.Td>
                <Table.Td>
                  {canRemove && a.isLive && (
                    <Tooltip label="Take this allocation back" withArrow>
                      <ActionIcon variant="subtle" color="red" aria-label={`Remove allocation to ${a.invoiceNumber}`} onClick={() => onRemove(a)}>
                        <IconX size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  )
}
