import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert, Badge, Button, Group, Loader, Paper, SimpleGrid, Table, Text } from '@mantine/core'
import { IconArrowLeft } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import type { ItemStockBalanceDto } from '../../api/types'
import { formatDateTime, formatNumber } from '../../components/format'
import { PageHeader } from '../../components/ui/PageHeader'

/**
 * One item's stock, warehouse by warehouse - where the item card's "Stock Balance" quick link goes.
 *
 * EVERY WAREHOUSE THAT HAS HELD THE ITEM, zero included: a warehouse that has just been emptied is
 * an answer ("none left there"), not something to hide. A negative figure is out-of-stock selling
 * the warehouse has not caught up with yet, and is shown in red rather than rounded away.
 */
export function ItemStockBalancePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const itemId = Number(id)
  const [data, setData] = useState<ItemStockBalanceDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    itemsApi
      .stockBalance(itemId, controller.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof ApiError ? err.message : 'The stock balance could not be loaded.')
      })
    return () => controller.abort()
  }, [itemId])

  const back = () => void navigate(`/inventory/items/${itemId}`)
  const holding = data?.warehouses.filter((w) => w.onHandBase !== 0).length ?? 0

  return (
    <div>
      <PageHeader
        title="Stock Balance"
        subtitle={data ? `${data.itemCode} - ${data.itemName}, on hand per warehouse in base units.` : undefined}
        breadcrumbs={[
          { label: 'Item Definition', to: '/inventory/items' },
          { label: data?.itemCode ?? '…', to: `/inventory/items/${itemId}` },
          { label: 'Stock Balance' },
        ]}
        actions={
          <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={back}>
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
          <SimpleGrid cols={{ base: 1, sm: 3 }} mb="md">
            <Paper withBorder radius="lg" p="md">
              <Text c="dimmed" fz="sm">Total on hand</Text>
              <Text fw={700} fz="xl">{formatNumber(data.totalOnHandBase)}</Text>
            </Paper>
            <Paper withBorder radius="lg" p="md">
              <Text c="dimmed" fz="sm">Warehouses holding it</Text>
              <Text fw={700} fz="xl">{formatNumber(holding)}</Text>
            </Paper>
            <Paper withBorder radius="lg" p="md">
              <Text c="dimmed" fz="sm">Inventory value</Text>
              <Text fw={700} fz="xl">{formatNumber(data.totalInventoryValue, 2)} USD</Text>
            </Paper>
          </SimpleGrid>

          <Paper withBorder radius="lg" p="md">
            {data.warehouses.length === 0 ? (
              <Text c="dimmed" ta="center" py="lg">This item has never been in stock in any warehouse.</Text>
            ) : (
              <Table.ScrollContainer minWidth={640}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Warehouse</Table.Th>
                      <Table.Th>Branch</Table.Th>
                      <Table.Th ta="right">On Hand</Table.Th>
                      <Table.Th ta="right">Value (USD)</Table.Th>
                      <Table.Th>Last Movement</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.warehouses.map((w) => (
                      <Table.Tr key={w.warehouseId}>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            <Text fz="sm" fw={500}>{w.warehouseCode} - {w.warehouseName}</Text>
                            {!w.warehouseIsActive && <Badge size="xs" color="gray" variant="light">Inactive</Badge>}
                          </Group>
                        </Table.Td>
                        <Table.Td>{w.branchName}</Table.Td>
                        <Table.Td ta="right">
                          <Text fz="sm" fw={600} c={w.onHandBase < 0 ? 'red' : w.onHandBase === 0 ? 'dimmed' : undefined}>
                            {formatNumber(w.onHandBase)}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right">{formatNumber(w.inventoryValue, 2)}</Table.Td>
                        <Table.Td>{w.lastMovementAtUtc ? formatDateTime(w.lastMovementAtUtc) : '—'}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                  <Table.Tfoot>
                    <Table.Tr>
                      <Table.Th colSpan={2}>Total</Table.Th>
                      <Table.Th ta="right">{formatNumber(data.totalOnHandBase)}</Table.Th>
                      <Table.Th ta="right">{formatNumber(data.totalInventoryValue, 2)}</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Tfoot>
                </Table>
              </Table.ScrollContainer>
            )}
          </Paper>
        </>
      )}
    </div>
  )
}
