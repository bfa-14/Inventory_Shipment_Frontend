import { Anchor, Badge, Paper, Stack, Table, Text, Title } from '@mantine/core'
import { Link } from 'react-router'
import type { ShortagePurchaseOrderDto } from '../../api/inventory/shortages'
import { dateLabel } from '../documents/documentKind'
import { formatMoney } from '../format'
import { PURCHASE_ORDER, PURCHASE_STATUS_COLOURS } from '../purchase/purchaseKind'

/**
 * The purchase orders created from this plan — the second link of Shortage → PO → Purchase Invoice.
 * A cancelled order stays listed (with its status): the plan did produce it, and a reader asking
 * "was this ever ordered?" should see that it was, and what became of it.
 */
export function ShortagePurchaseOrdersCard({ orders }: { orders: ShortagePurchaseOrderDto[] }) {
  return (
    <Paper radius="lg" p="md" withBorder id="purchase-orders" data-shortage-orders>
      <Title order={5} mb="sm">Purchase orders</Title>

      {orders.length === 0 ? (
        <Text size="sm" c="dimmed">None yet. A posted plan becomes a purchase order with "Create Purchase Order".</Text>
      ) : (
        <Stack gap={0}>
          <Table verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Number</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th ta="right">Amount</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {orders.map((order) => (
                <Table.Tr key={order.id}>
                  <Table.Td>
                    <Anchor component={Link} to={`${PURCHASE_ORDER.route}/${order.id}`} fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
                      {order.documentNumber ?? `draft #${order.id}`}
                    </Anchor>
                  </Table.Td>
                  <Table.Td><Text fz="sm">{dateLabel(order.documentDate)}</Text></Table.Td>
                  <Table.Td><Badge variant="light" color={PURCHASE_STATUS_COLOURS[order.status] ?? 'gray'}>{order.status}</Badge></Table.Td>
                  <Table.Td ta="right"><Text fz="sm" style={{ whiteSpace: 'nowrap' }}>{formatMoney(order.totalAmount, order.currencyCode)}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      )}
    </Paper>
  )
}
