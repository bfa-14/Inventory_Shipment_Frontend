import { Anchor, Paper, Table, Text, Title } from '@mantine/core'
import { Link } from 'react-router'
import { costCauseLabel } from '../../api/purchase/goodsReceipts'
import type { PurchaseDocumentCostAdjustmentDto } from '../../api/purchase/documents'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../navigation'
import { routes } from '../../routes'
import { stamp } from '../documents/documentKind'
import { formatNumber } from '../format'
import { COST_ADJUSTMENTS_HINT } from './goodsReceipts/goodsReceiptModel'

interface InvoiceReceiptCostCardProps {
  adjustments: PurchaseDocumentCostAdjustmentDto[]
  /** The base currency: every figure here is in it. */
  currencyCode: string
}

/** "+120.00" / "-40.00": a cost adjustment always says which way it went. */
function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${formatNumber(value, 2)}`
}

/**
 * "Cost of received goods": what this supplier invoice did to the cost of goods that were already received when it was
 * posted (or cancelled) - the goods receipts' lines brought from the order price to the invoice's cost (rule 10).
 *
 * THE SENTENCE FIRST, the detail under it: "Cost of received goods adjusted: +120.00 USD (stock 80.00, cost of sales
 * 40.00)". The part still in stock moved the average cost; the part already sold went to the cost of sales.
 *
 * Shown on a supplier invoice that has any; the figures are the server's.
 */
export function InvoiceReceiptCostCard({ adjustments, currencyCode }: InvoiceReceiptCostCardProps) {
  const { hasPermission } = useAuth()
  const canViewReceipts = hasPermission(PERMISSIONS.goodsReceiptsView)

  const totals = adjustments.reduce(
    (sum, a) => ({ amount: sum.amount + a.amountBase, stock: sum.stock + a.inventoryBase, cogs: sum.cogs + a.cogsBase }),
    { amount: 0, stock: 0, cogs: 0 },
  )
  const before = (a: PurchaseDocumentCostAdjustmentDto) => a.unitCostBefore ?? a.fobBefore
  const after = (a: PurchaseDocumentCostAdjustmentDto) => a.unitCostAfter ?? a.fobAfter

  return (
    <Paper radius="lg" p="md" withBorder data-receipt-cost-card>
      <Title order={5} mb={4}>
        Cost of received goods
      </Title>
      <Text fz="sm" fw={600} mb={4} data-receipt-cost-total>
        Cost of received goods adjusted: {signed(totals.amount)} {currencyCode} (stock {formatNumber(totals.stock, 2)}, cost of sales{' '}
        {formatNumber(totals.cogs, 2)})
      </Text>
      <Text size="sm" c="dimmed" mb="sm">
        {COST_ADJUSTMENTS_HINT}
      </Text>

      <Table.ScrollContainer minWidth={1000}>
        <Table verticalSpacing="xs" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Cause</Table.Th>
              <Table.Th>Goods receipt</Table.Th>
              <Table.Th>Item</Table.Th>
              <Table.Th ta="right">Received</Table.Th>
              <Table.Th ta="right">Unit cost before → after</Table.Th>
              <Table.Th ta="right">Amount ({currencyCode})</Table.Th>
              <Table.Th ta="right">To stock</Table.Th>
              <Table.Th ta="right">To cost of sales</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {adjustments.map((a) => {
              const receipt = a.goodsReceiptNumber ?? `draft #${a.goodsReceiptId}`
              return (
                <Table.Tr key={a.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{stamp(a.changedAtUtc)}</Table.Td>
                  <Table.Td>
                    <Text fz="sm">{costCauseLabel(a.causeKind, a.causeNumber)}</Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    {canViewReceipts ? (
                      <Anchor component={Link} to={routes.goodsReceipt(a.goodsReceiptId)} fz="sm">
                        {receipt}
                      </Anchor>
                    ) : (
                      <Text fz="sm">{receipt}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
                      {a.itemCode || '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">{formatNumber(a.receivedBase)}</Table.Td>
                  <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                    {formatNumber(before(a), 2)} → {formatNumber(after(a), 2)}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text fz="sm" fw={500}>
                      {signed(a.amountBase)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">{formatNumber(a.inventoryBase, 2)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(a.cogsBase, 2)}</Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr>
              <Table.Th colSpan={6}>Total</Table.Th>
              <Table.Th ta="right">{signed(totals.amount)}</Table.Th>
              <Table.Th ta="right">{formatNumber(totals.stock, 2)}</Table.Th>
              <Table.Th ta="right">{formatNumber(totals.cogs, 2)}</Table.Th>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  )
}
