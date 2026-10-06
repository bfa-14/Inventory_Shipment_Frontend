import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Alert, Anchor, Badge, Button, Group, Loader, Paper, SegmentedControl, SimpleGrid, Table, Text } from '@mantine/core'
import { IconArrowLeft } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import { containerStatusColour, containerStatusLabel } from '../../api/logistics/containers'
import type { ItemContainersDto } from '../../api/types'
import { dateLabel } from '../../components/documents/documentKind'
import { formatNumber } from '../../components/format'
import { PageHeader } from '../../components/ui/PageHeader'

/**
 * The containers that carry one item - where the item card's "Containers" quick link goes.
 *
 * WHAT EACH CONTAINER HOLDS OF THIS ITEM: loaded, received, and still on the way. "On the way" runs
 * from Confirmed to Cleared - a draft has not shipped, and an offloaded, closed or cancelled
 * container is no longer bringing anything - so the figure is stock that is really coming.
 */
export function ItemContainersPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const itemId = Number(id)
  const [data, setData] = useState<ItemContainersDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState<'coming' | 'all'>('all')

  useEffect(() => {
    const controller = new AbortController()
    itemsApi
      .containers(itemId, controller.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof ApiError ? err.message : 'The containers could not be loaded.')
      })
    return () => controller.abort()
  }, [itemId])

  const containers = (data?.containers ?? []).filter((c) => show === 'all' || c.onTheWayBase > 0)

  return (
    <div>
      <PageHeader
        title="Containers"
        subtitle={data ? `${data.itemCode} - ${data.itemName}: the containers carrying it, in base units.` : undefined}
        breadcrumbs={[
          { label: 'Item Definition', to: '/inventory/items' },
          { label: data?.itemCode ?? '…', to: `/inventory/items/${itemId}` },
          { label: 'Containers' },
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
              ['Containers on the way', data.containersOnTheWay],
              ['On the way', data.onTheWayBase],
              ['Loaded', data.loadedBase],
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
              <Text c="dimmed" fz="sm">Loaded and Received leave out cancelled containers.</Text>
              <SegmentedControl
                size="xs"
                value={show}
                onChange={(next) => setShow(next as 'coming' | 'all')}
                data={[
                  { value: 'all', label: `All (${data.containers.length})` },
                  { value: 'coming', label: `On the way (${data.containersOnTheWay})` },
                ]}
              />
            </Group>

            {containers.length === 0 ? (
              <Text c="dimmed" ta="center" py="lg">
                {data.containers.length === 0 ? 'This item is not in any container.' : 'No container is still bringing this item.'}
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={1000}>
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Container</Table.Th>
                      <Table.Th>Type</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Purchase Order</Table.Th>
                      <Table.Th>Dispatched</Table.Th>
                      <Table.Th>ETA</Table.Th>
                      <Table.Th>Destination</Table.Th>
                      <Table.Th ta="right">Loaded</Table.Th>
                      <Table.Th ta="right">Received</Table.Th>
                      <Table.Th ta="right">On the way</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {containers.map((c) => (
                      <Table.Tr key={c.containerId}>
                        <Table.Td>
                          <Anchor component={Link} to={`/logistics/containers/${c.containerId}`} fz="sm" fw={500}>
                            {c.containerRef}
                          </Anchor>
                          {c.containerNo && <Text fz="xs" c="dimmed">{c.containerNo}</Text>}
                        </Table.Td>
                        <Table.Td>{c.containerTypeName ?? '—'}</Table.Td>
                        <Table.Td>
                          <Badge color={containerStatusColour(c.statusCode)} variant="light">{containerStatusLabel(c.statusCode)}</Badge>
                        </Table.Td>
                        <Table.Td>
                          {c.purchaseOrderId ? (
                            <Anchor component={Link} to={`/purchase/orders/${c.purchaseOrderId}`} fz="sm">
                              {c.purchaseOrderNumber ?? `#${c.purchaseOrderId}`}
                            </Anchor>
                          ) : (
                            '—'
                          )}
                        </Table.Td>
                        <Table.Td>{c.dispatchDate ? dateLabel(c.dispatchDate) : '—'}</Table.Td>
                        <Table.Td>{c.eta ? dateLabel(c.eta) : '—'}</Table.Td>
                        <Table.Td>{[c.warehouseName, c.branchName].filter(Boolean).join(', ') || '—'}</Table.Td>
                        <Table.Td ta="right">{formatNumber(c.loadedBase)}</Table.Td>
                        <Table.Td ta="right">{formatNumber(c.receivedBase)}</Table.Td>
                        <Table.Td ta="right">
                          <Text fz="sm" fw={c.onTheWayBase > 0 ? 600 : 400} c={c.onTheWayBase > 0 ? undefined : 'dimmed'}>
                            {formatNumber(c.onTheWayBase)}
                          </Text>
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
