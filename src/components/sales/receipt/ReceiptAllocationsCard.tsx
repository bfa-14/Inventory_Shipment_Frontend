import { Alert, Badge, Button, Group, Loader, NumberInput, Paper, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconWand } from '@tabler/icons-react'
import type { OpenInvoiceDto } from '../../../api/sales/receipts'
import { dateLabel } from '../../documents/documentKind'
import { formatNumber, numberInputValue } from '../../format'
import { allocationBase, fillOldestFirst, isBalanced } from './receiptModel'

interface ReceiptAllocationsCardProps {
  title: string
  invoices: OpenInvoiceDto[]
  loading: boolean
  /** Whether a customer has been chosen; without one there is nothing to list. */
  hasClient: boolean
  /** Invoice id → amount typed, in the INVOICE's currency. */
  amounts: Record<number, number | null>
  onChange: (invoiceId: number, amount: number | null) => void
  onFill: (amounts: Record<number, number>) => void
  /** What the allocations must come to, in the base currency: the receipt's amount, or its unapplied credit. */
  targetBase: number
  baseCurrencyCode: string
  readOnly: boolean
  /** Shown above the table, e.g. why this card is here. */
  intro?: string
  /** An extra action beside the title, e.g. "Apply allocation". */
  action?: React.ReactNode
  /** Applying only part of the credit is fine (a posted Free Receipt): being short is then information, not an error. */
  partialOk?: boolean
}

/**
 * The customer's unpaid invoices, and how much of this receipt goes to each.
 *
 * THE AMOUNT IS TYPED IN THE INVOICE'S OWN CURRENCY, because that is what the customer thinks they
 * are paying ("settle INV-0007, 2,500 CDF"). Its value in the base currency is that amount divided
 * by the INVOICE'S rate — the one it was issued at — so an invoice is settled at the rate it was
 * sold at, whatever today's rate has done, and the figure on the right is what the three-way balance
 * actually uses.
 */
export function ReceiptAllocationsCard({
  title,
  invoices,
  loading,
  hasClient,
  amounts,
  onChange,
  onFill,
  targetBase,
  baseCurrencyCode,
  readOnly,
  intro,
  action,
  partialOk = false,
}: ReceiptAllocationsCardProps) {
  const allocatedBase = invoices.reduce((sum, invoice) => sum + allocationBase(invoice, amounts[invoice.id] ?? null), 0)
  const difference = targetBase - allocatedBase
  const balanced = isBalanced(targetBase, allocatedBase)

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Title order={5}>{title}</Title>
        <Group gap="xs">
          {!readOnly && invoices.length > 0 && (
            <Tooltip label="Spread the amount over the oldest invoices first" withArrow>
              <Button variant="default" leftSection={<IconWand size={16} />} onClick={() => onFill(fillOldestFirst(invoices, targetBase))}>
                Allocate oldest first
              </Button>
            </Tooltip>
          )}
          {action}
        </Group>
      </Group>

      {intro && <Text size="sm" c="dimmed" mb="sm">{intro}</Text>}

      {!hasClient ? (
        <Text size="sm" c="dimmed">Choose a customer to see the invoices they owe.</Text>
      ) : loading ? (
        <Group justify="center" py="md"><Loader size="sm" /></Group>
      ) : invoices.length === 0 ? (
        <Text size="sm" c="dimmed">This customer has no unpaid posted invoices.</Text>
      ) : (
        <Table.ScrollContainer minWidth={860}>
          <Table striped highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Invoice</Table.Th>
                <Table.Th w={110}>Date</Table.Th>
                <Table.Th w={80}>Currency</Table.Th>
                <Table.Th w={130} ta="right">Total</Table.Th>
                <Table.Th w={130} ta="right">Outstanding</Table.Th>
                <Table.Th w={160} ta="right">Allocate</Table.Th>
                <Table.Th w={130} ta="right">Value ({baseCurrencyCode})</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {invoices.map((invoice) => {
                const typed = amounts[invoice.id] ?? null
                const over = typed !== null && typed > invoice.outstandingAmount + 0.005
                return (
                  <Table.Tr key={invoice.id}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Text size="sm" fw={500}>{invoice.documentNumber}</Text>
                        <Badge size="xs" variant="light" color={invoice.paymentStatus === 'Partial' ? 'orange' : 'gray'}>{invoice.paymentStatus}</Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td>{dateLabel(invoice.documentDate)}</Table.Td>
                    <Table.Td>{invoice.currencyCode}</Table.Td>
                    <Table.Td ta="right">{formatNumber(invoice.invoiceTotal, invoice.decimalPlaces)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(invoice.outstandingAmount, invoice.decimalPlaces)}</Table.Td>
                    <Table.Td>
                      <NumberInput
                        aria-label={`Amount to allocate to ${invoice.documentNumber}`}
                        min={0}
                        decimalScale={invoice.decimalPlaces}
                        thousandSeparator=","
                        hideControls
                        value={typed ?? ''}
                        onChange={(next) => onChange(invoice.id, numberInputValue(next))}
                        error={over ? 'More than outstanding' : undefined}
                        styles={{ input: { textAlign: 'right' } }}
                        disabled={readOnly}
                      />
                    </Table.Td>
                    <Table.Td ta="right">{formatNumber(allocationBase(invoice, typed), 2)}</Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {hasClient && !loading && invoices.length > 0 && (
        <>
          <Group justify="space-between" mt="md">
            <Text size="sm" c="dimmed">Allocated ({baseCurrencyCode})</Text>
            <Text fw={600}>{formatNumber(allocatedBase, 2)}</Text>
          </Group>
          <Alert
            mt="sm"
            color={balanced ? 'green' : partialOk && difference > 0 ? 'blue' : 'red'}
            title={balanced ? 'Allocation matches the amount' : partialOk && difference > 0 ? 'Part of the credit will stay unapplied' : 'Allocation does not match the amount'}
          >
            {balanced
              ? `Fully allocated: ${formatNumber(targetBase, 2)} ${baseCurrencyCode}.`
              : `${formatNumber(targetBase, 2)} ${baseCurrencyCode} to allocate, ${formatNumber(allocatedBase, 2)} allocated: ${difference > 0 ? 'still to allocate' : 'over-allocated by'} ${formatNumber(Math.abs(difference), 2)} ${baseCurrencyCode}.`}
          </Alert>
        </>
      )}
    </Paper>
  )
}
