import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Alert, Anchor, Badge, Button, Group, Loader, Paper, SegmentedControl, SimpleGrid, Table, Text } from '@mantine/core'
import { IconArrowLeft } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import type { PurchaseDocumentStatus } from '../../api/purchase/documents'
import type { ItemPurchaseOrdersDto } from '../../api/types'
import { dateLabel } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { PURCHASE_STATUS_COLOURS, purchaseStatusLabel } from '../../components/purchase/purchaseKind'
import { PageHeader } from '../../components/ui/PageHeader'

/**
 * The purchase orders that have one item on them - where the item card's "Purchase Orders" quick
 * link goes.
 *
 * WHAT EACH ORDER ASKS FOR OF THIS ITEM, not the order's totals: an order of twenty items is one
 * row here, with this item's ordered, received and still-to-come quantities. "Still to come" is
 * counted on open orders only - a draft has not been sent, and a cancelled or closed order will not
 * deliver any more - so the On order figure is stock that is really on its way.
 */
export function ItemPurchaseOrdersPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const itemId = Number(id)
  const [data, setData] = useState<ItemPurchaseOrdersDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState<'open' | 'all'>('all')

  useEffect(() => {
    const controller = new AbortController()
    itemsApi
      .purchaseOrders(itemId, controller.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof ApiError ? err.message : 'The purchase orders could not be loaded.')
      })
    return () => controller.abort()
  }, [itemId])

  const orders = (data?.orders ?? []).filter((o) => show === 'all' || o.outstandingBase > 0)

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle={data ? `${data.itemCode} - ${data.itemName}: the orders it is on, with what each still has to deliver, in base units.` : undefined}
        breadcrumbs={[
          { label: 'Item Definition', to: '/inventory/items' },
          { label: data?.itemCode ?? '…', to: `/inventory/items/${itemId}` },
          { label: 'Purchase Orders' },
        ]}
        actions={
          <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => void navigate(`/inventory/items/${itemId}`)}>
            Back to item
          </Button>
        }
      />

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      {!data && !error && (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      )}

      {data && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
            {[
              ['Open orders', data.openOrders],
              ['On order (still to come)', data.outstandingBase],
              ['Ordered', data.orderedBase],
              ['Received', data.receivedBase],
            ].map(([label, value]) => (
              <Paper key={label} withBorder radius="lg" p="md">
                <Text c="dimmed" fz="sm">{label}</Text>
                <Text fw={700} fz="xl">{formatNumber(value as number)}</Text>
              </Paper>
            ))}
          </SimpleGrid>

          <Paper withBorder radius="lg" p="md">
            <Group justify="space-between" mb="sm">
              <Text c="dimmed" fz="sm">Ordered and Received leave out cancelled orders.</Text>
              <SegmentedControl
                size="xs"
                value={show}
                onChange={(next) => setShow(next as 'open' | 'all')}
                data={[
                  { value: 'all', label: `All (${data.orders.length})` },
                  { value: 'open', label: `Still to come (${data.openOrders})` },
                ]}
              />
            </Group>

            {orders.length === 0 ? (
              <Text c="dimmed" ta="center" py="lg">
                {data.orders.length === 0 ? 'This item is not on any purchase order.' : 'No open order is still waiting for this item.'}
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={900}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Order No.</Table.Th>
                      <Table.Th>Date</Table.Th>
                      <Table.Th>Expected</Table.Th>
                      <Table.Th>Supplier</Table.Th>
                      <Table.Th>Branch</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th ta="right">Ordered</Table.Th>
                      <Table.Th ta="right">Received</Table.Th>
                      <Table.Th ta="right">Still to come</Table.Th>
                      <Table.Th ta="right">Amount</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {orders.map((o) => (
                      <Table.Tr key={o.documentId}>
                        <Table.Td>
                          <Anchor component={Link} to={`/purchase/orders/${o.documentId}`} fz="sm" fw={500}>
                            {o.documentNumber ?? `Draft #${o.documentId}`}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>{dateLabel(o.documentDate)}</Table.Td>
                        <Table.Td>{o.expectedDate ? dateLabel(o.expectedDate) : '—'}</Table.Td>
                        <Table.Td>{o.supplierName}</Table.Td>
                        <Table.Td>{o.branchName}</Table.Td>
                        <Table.Td>
                          <Badge color={PURCHASE_STATUS_COLOURS[o.status as PurchaseDocumentStatus] ?? 'gray'} variant="light">
                            {purchaseStatusLabel(o.status as PurchaseDocumentStatus)}
                          </Badge>
                        </Table.Td>
                        <Table.Td ta="right">{formatNumber(o.orderedBase)}</Table.Td>
                        <Table.Td ta="right">{formatNumber(o.receivedBase)}</Table.Td>
                        <Table.Td ta="right">
                          <Text fz="sm" fw={o.outstandingBase > 0 ? 600 : 400} c={o.outstandingBase > 0 ? undefined : 'dimmed'}>
                            {formatNumber(o.outstandingBase)}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                          {formatNumber(o.amount, o.decimalPlaces)} {o.currencyCode}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Paper>
        </>
      )}
    </div>
  )
}
