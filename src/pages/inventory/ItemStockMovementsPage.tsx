import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Alert, Anchor, Badge, Button, Group, Loader, Paper, SimpleGrid, Table, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconArrowLeft } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import type { ItemStockMovementDto, ItemStockStatementDto } from '../../api/types'
import { fromIsoDate, isoDate } from '../../components/documents/documentKind'
import { formatDateTime, formatNumber } from '../../components/format'
import { PageHeader } from '../../components/ui/PageHeader'

/** Where a movement's document opens. A type without a page of its own shows its number only. */
function documentRoute(m: ItemStockMovementDto): string | null {
  switch (m.documentTypeCode) {
    case 'INV_IN': return `/inventory/stock-in/${m.documentId}`
    case 'INV_OUT': return `/inventory/stock-out/${m.documentId}`
    case 'SINV': return `/sales/invoices/${m.documentId}`
    case 'PO': return `/purchase/orders/${m.documentId}`
    case 'PINV': return `/purchase/invoices/${m.documentId}`
    case 'PRET': return `/purchase/returns/${m.documentId}`
    // container offloading receives the goods against the container
    case 'CNT': return `/logistics/containers/${m.documentId}`
    default: return null
  }
}

/**
 * One item's stock statement - where the item card's "Stock Movement" quick link goes.
 *
 * READ LIKE A BANK STATEMENT: the balance brought forward, then every movement oldest first with
 * what came in, what went out and the balance after it, then what is left. A cancelled document
 * shows twice - the movement and its reversal - because both happened to the stock.
 *
 * THE ITEM, NOT A WAREHOUSE: every warehouse's movements in one running balance, which ends at the
 * item's total on hand. The dates live in the address, so a link can be shared as it is seen.
 */
export function ItemStockMovementsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const itemId = Number(id)
  const [params, setParams] = useSearchParams()
  const from = params.get('from')
  const to = params.get('to')

  const [data, setData] = useState<ItemStockStatementDto | null>(null)
  /** The filters the table shows; while it differs from the ones asked for, a load is under way. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const key = `${itemId}|${from ?? ''}|${to ?? ''}`
  const loading = loadedKey !== key
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    itemsApi
      .stockMovements(itemId, { from, to }, controller.signal)
      .then((answer) => {
        setData(answer)
        setError(null)
        setLoadedKey(key)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof ApiError ? err.message : 'The stock movements could not be loaded.')
        setLoadedKey(key)
      })
    return () => controller.abort()
  }, [itemId, from, to, key])

  function setFilter(key: 'from' | 'to', value: string | null) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  return (
    <div>
      <PageHeader
        title="Stock Movement"
        subtitle={data ? `${data.itemCode} - ${data.itemName}: every movement with the balance after it, in base units.` : undefined}
        breadcrumbs={[
          { label: 'Item Definition', to: '/inventory/items' },
          { label: data?.itemCode ?? '…', to: `/inventory/items/${itemId}` },
          { label: 'Stock Movement' },
        ]}
        actions={
          <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => void navigate(`/inventory/items/${itemId}`)}>
            Back to item
          </Button>
        }
      />

      <Paper withBorder radius="lg" p="md" mb="md">
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <DateInput
            label="From"
            placeholder="The first movement"
            valueFormat="DD/MM/YYYY"
            value={fromIsoDate(from)}
            maxDate={to ? (fromIsoDate(to) ?? undefined) : undefined}
            onChange={(next) => setFilter('from', next ? isoDate(new Date(next)) : null)}
            clearable
          />
          <DateInput
            label="To"
            placeholder="Today"
            valueFormat="DD/MM/YYYY"
            value={fromIsoDate(to)}
            minDate={from ? (fromIsoDate(from) ?? undefined) : undefined}
            onChange={(next) => setFilter('to', next ? isoDate(new Date(next)) : null)}
            clearable
          />
        </SimpleGrid>
      </Paper>

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      {loading && !data && (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      )}

      {data && (
        <>
          <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
            {[
              ['Opening balance', data.openingBase],
              ['In', data.totalIn],
              ['Out', data.totalOut],
              ['Closing balance', data.closingBase],
            ].map(([label, value]) => (
              <Paper key={label} withBorder radius="lg" p="md">
                <Text c="dimmed" fz="sm">{label}</Text>
                <Text fw={700} fz="xl">{formatNumber(value as number)}</Text>
              </Paper>
            ))}
          </SimpleGrid>

          <Paper withBorder radius="lg" p="md" style={{ opacity: loading ? 0.6 : 1 }}>
            <Table.ScrollContainer minWidth={820}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Document</Table.Th>
                    <Table.Th>Client / Supplier / Reason</Table.Th>
                    <Table.Th ta="right">In</Table.Th>
                    <Table.Th ta="right">Out</Table.Th>
                    <Table.Th ta="right">Balance</Table.Th>
                    <Table.Th ta="right">Unit Cost (USD)</Table.Th>
                    <Table.Th>By</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Text fz="sm" fw={600}>{from ? 'Balance brought forward' : 'Opening balance'}</Text>
                    </Table.Td>
                    <Table.Td ta="right"><Text fz="sm" fw={600}>{formatNumber(data.openingBase)}</Text></Table.Td>
                    <Table.Td colSpan={2} />
                  </Table.Tr>
                  {data.movements.map((m) => {
                    const route = documentRoute(m)
                    return (
                      <Table.Tr key={m.id}>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(m.movementDate)}</Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <div>
                              <Text fz="xs" c="dimmed">{m.documentTypeName ?? m.documentTypeCode}</Text>
                              {route ? (
                                <Anchor component={Link} to={route} fz="sm" fw={500}>{m.documentNumber ?? `#${m.documentId}`}</Anchor>
                              ) : (
                                <Text fz="sm" fw={500}>{m.documentNumber ?? `#${m.documentId}`}</Text>
                              )}
                            </div>
                            {m.isReversal && <Badge size="xs" color="orange" variant="light">Cancelled</Badge>}
                          </Group>
                        </Table.Td>
                        <Table.Td>{m.counterparty ?? m.reasonCode ?? '—'}</Table.Td>
                        <Table.Td ta="right">{m.quantityIn ? <Text fz="sm" c="teal">{formatNumber(m.quantityIn)}</Text> : ''}</Table.Td>
                        <Table.Td ta="right">{m.quantityOut ? <Text fz="sm" c="red">{formatNumber(m.quantityOut)}</Text> : ''}</Table.Td>
                        <Table.Td ta="right"><Text fz="sm" fw={600} c={m.balance < 0 ? 'red' : undefined}>{formatNumber(m.balance)}</Text></Table.Td>
                        <Table.Td ta="right">{m.unitCostBase === null ? '—' : formatNumber(m.unitCostBase, 2)}</Table.Td>
                        <Table.Td>{m.createdByName ?? '—'}</Table.Td>
                      </Table.Tr>
                    )
                  })}
                  {data.movements.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={8}>
                        <Text c="dimmed" ta="center" py="md">No movement in this period.</Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
                <Table.Tfoot>
                  <Table.Tr>
                    <Table.Th colSpan={3}>Closing balance</Table.Th>
                    <Table.Th ta="right">{formatNumber(data.totalIn)}</Table.Th>
                    <Table.Th ta="right">{formatNumber(data.totalOut)}</Table.Th>
                    <Table.Th ta="right">{formatNumber(data.closingBase)}</Table.Th>
                    <Table.Th colSpan={2} />
                  </Table.Tr>
                </Table.Tfoot>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        </>
      )}
    </div>
  )
}
