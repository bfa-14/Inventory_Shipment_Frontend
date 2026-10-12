import { Anchor, Paper, Table, Text, Title } from '@mantine/core'
import { Link } from 'react-router'
import { costCauseLabel, type GoodsReceiptCostChangeDto } from '../../../api/purchase/goodsReceipts'
import { useAuth } from '../../../auth/useAuth'
import { PERMISSIONS } from '../../../navigation'
import { routes } from '../../../routes'
import { stamp } from '../../documents/documentKind'
import { formatNumber } from '../../format'
import { COST_ADJUSTMENTS_HINT } from './goodsReceiptModel'

interface GoodsReceiptCostAdjustmentsCardProps {
  changes: GoodsReceiptCostChangeDto[]
  currencyCode: string
}

/**
 * "Cost adjustments": how the cost of these goods moved after they were received - an invoice posted or cancelled, a
 * landed cost adjustment, another receipt of the same order line, goods sold before the receipt was posted. Each one
 * says how much went to the stock (the average cost) and how much to the cost of sales.
 *
 * Shown on a posted receipt that has any.
 */
export function GoodsReceiptCostAdjustmentsCard({ changes, currencyCode }: GoodsReceiptCostAdjustmentsCardProps) {
  const { hasPermission } = useAuth()

  /** The document that caused it, as a link when the reader may open it. */
  function causeRoute(change: GoodsReceiptCostChangeDto): string | null {
    if (change.causeId === null) return null
    switch (change.causeKind) {
      case 'PINV':
      case 'PINVCANCEL':
        return hasPermission(PERMISSIONS.purchaseInvoicesView) ? routes.purchaseInvoice(change.causeId) : null
      case 'LCA':
      case 'LCACANCEL':
        return hasPermission(PERMISSIONS.landedCostsView) ? `/purchase/landed-cost-adjustments/${change.causeId}` : null
      case 'GRNPOST':
      case 'GRNCANCEL':
        return routes.goodsReceipt(change.causeId)
      default:
        return null
    }
  }

  const totals = changes.reduce(
    (sum, c) => ({ amount: sum.amount + c.amountBase, stock: sum.stock + c.inventoryBase, cogs: sum.cogs + c.cogsBase }),
    { amount: 0, stock: 0, cogs: 0 },
  )

  const before = (c: GoodsReceiptCostChangeDto) => c.unitCostBefore ?? c.fobBefore
  const after = (c: GoodsReceiptCostChangeDto) => c.unitCostAfter ?? c.fobAfter

  return (
    <Paper radius="lg" p="md" withBorder data-cost-adjustments>
      <Title order={5} mb={4}>
        Cost adjustments
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        {COST_ADJUSTMENTS_HINT}
      </Text>

      <Table.ScrollContainer minWidth={960}>
        <Table verticalSpacing="xs" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Cause</Table.Th>
              <Table.Th>Item</Table.Th>
              <Table.Th ta="right">Received</Table.Th>
              <Table.Th ta="right">Unit cost before → after</Table.Th>
              <Table.Th ta="right">Amount ({currencyCode})</Table.Th>
              <Table.Th ta="right">To stock</Table.Th>
              <Table.Th ta="right">To cost of sales</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {changes.map((change) => {
              const route = causeRoute(change)
              const label = costCauseLabel(change.causeKind, change.causeNumber)
              return (
                <Table.Tr key={change.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{stamp(change.changedAtUtc)}</Table.Td>
                  <Table.Td>
                    {route ? (
                      <Anchor component={Link} to={route} fz="sm">
                        {label}
                      </Anchor>
                    ) : (
                      <Text fz="sm">{label}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
                      {change.itemCode ?? (change.lineNumber !== null ? `Line ${change.lineNumber}` : '—')}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">{formatNumber(change.receivedBase)}</Table.Td>
                  <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                    {formatNumber(before(change), 2)} → {formatNumber(after(change), 2)}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text fz="sm" fw={500} c={change.amountBase < 0 ? 'teal' : undefined}>
                      {change.amountBase > 0 ? '+' : ''}
                      {formatNumber(change.amountBase, 2)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right">{formatNumber(change.inventoryBase, 2)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(change.cogsBase, 2)}</Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr>
              <Table.Th colSpan={5}>Total</Table.Th>
              <Table.Th ta="right">
                {totals.amount > 0 ? '+' : ''}
                {formatNumber(totals.amount, 2)}
              </Table.Th>
              <Table.Th ta="right">{formatNumber(totals.stock, 2)}</Table.Th>
              <Table.Th ta="right">{formatNumber(totals.cogs, 2)}</Table.Th>
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  )
}
