import { ActionIcon, Anchor, Badge, Group, Paper, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import { Link } from 'react-router'
import type { PaymentAllocationDto } from '../../../api/purchase/payments'
import { dateLabel, stamp } from '../../documents/documentKind'
import { formatNumber } from '../../format'

interface PaymentAppliedCardProps {
  allocations: PaymentAllocationDto[]
  paymentCurrencyCode: string
  /** Taking an allocation back: only on a posted Free Payment, whose advance it returns. */
  canRemove: boolean
  onRemove: (allocation: PaymentAllocationDto) => void
}

/**
 * Which documents a saved payment has paid.
 *
 * A REMOVED ALLOCATION STAYS IN THE LIST, struck through, with who took it back and when: it is the
 * record that the document was once paid by this payment.
 */
export function PaymentAppliedCard({ allocations, paymentCurrencyCode, canRemove, onRemove }: PaymentAppliedCardProps) {
  if (allocations.length === 0) return null
  const live = allocations.filter((a) => a.isLive)
  const total = live.reduce((sum, a) => sum + a.amountPaymentCurrency, 0)

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">Paid documents</Title>
      <Table.ScrollContainer minWidth={960}>
        <Table striped highlightOnHover verticalSpacing="xs" withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Document</Table.Th>
              <Table.Th w={110}>Date</Table.Th>
              <Table.Th>Container Ref.</Table.Th>
              <Table.Th w={150} ta="right">Allocated</Table.Th>
              <Table.Th w={120} ta="right">Rate</Table.Th>
              <Table.Th w={140} ta="right">In {paymentCurrencyCode}</Table.Th>
              <Table.Th>Allocated by</Table.Th>
              <Table.Th w={50} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {allocations.map((a) => (
              <Table.Tr key={a.id} c={a.isLive ? undefined : 'dimmed'}>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    {a.documentKind === 'PINV' ? (
                      <Anchor component={Link} to={`/purchase/invoices/${a.documentId}`} size="sm" fw={500} td={a.isLive ? undefined : 'line-through'}>{a.documentNumber}</Anchor>
                    ) : (
                      <Text size="sm" fw={500} td={a.isLive ? undefined : 'line-through'}>{a.documentNumber}</Text>
                    )}
                    {a.chargeTypeName && <Text size="xs" c="dimmed">{a.chargeTypeName}</Text>}
                    {!a.isLive && <Badge size="xs" color="gray" variant="light">Removed</Badge>}
                  </Group>
                </Table.Td>
                <Table.Td>{dateLabel(a.documentDate)}</Table.Td>
                <Table.Td>{a.containerRef ?? '–'}</Table.Td>
                <Table.Td ta="right">{formatNumber(a.amountDocCurrency, a.documentDecimalPlaces)} {a.documentCurrencyCode}</Table.Td>
                <Table.Td ta="right">{formatNumber(a.rateToPayment, a.rateToPayment === 1 ? 0 : 6)}</Table.Td>
                <Table.Td ta="right">{formatNumber(a.amountPaymentCurrency, 2)}</Table.Td>
                <Table.Td>
                  <Text size="sm">{stamp(a.allocatedAtUtc)}{a.allocatedByName ? ` · ${a.allocatedByName}` : ''}</Text>
                  {a.removedAtUtc && <Text size="xs" c="dimmed">Removed {stamp(a.removedAtUtc)}{a.removedByName ? ` · ${a.removedByName}` : ''}</Text>}
                </Table.Td>
                <Table.Td>
                  {canRemove && a.isLive && (
                    <Tooltip label="Take this allocation back" withArrow>
                      <ActionIcon variant="subtle" color="red" aria-label={`Remove allocation to ${a.documentNumber}`} onClick={() => onRemove(a)}>
                        <IconX size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr style={{ background: 'var(--mantine-color-blue-light)' }}>
              <Table.Th colSpan={5}>Total</Table.Th>
              <Table.Th ta="right">{formatNumber(total, 2)}</Table.Th>
              <Table.Th colSpan={2} />
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  )
}
