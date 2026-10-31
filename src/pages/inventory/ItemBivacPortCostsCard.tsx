import { useEffect, useState } from 'react'
import { ActionIcon, Alert, Button, Card, Group, NumberInput, Select, Skeleton, Stack, Table, Text, Tooltip } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi, type ItemBivacPortCostDto } from '../../api/inventory/items'
import { currenciesApi } from '../../api/masterdata/currencies'
import { portLabel, portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import { formatNumber, numberInputValue } from '../../components/format'
import { notify } from '../../components/ui/notify'

export interface ItemBivacPortCostsCardProps {
  itemId: number
  itemCode: string
  /** inventory.items.edit: change the costs. */
  canEdit: boolean
}

interface Row {
  portId: string | null
  costBase: number | null
}

function toRows(list: ItemBivacPortCostDto[]): Row[] {
  return list.map((r) => ({ portId: String(r.portId), costBase: r.costBase }))
}

/**
 * "BIVAC COST PER PORT" ON ITEM DEFINITION (script 97), shown on a saved BIVAC item: what a BIVAC / Inspection charge
 * costs at each port of destination. A BIVAC charge on containers names this item and takes, for each container, the
 * cost of its port. A card that saves on its own, like the stock levels card: plain buttons, never the item's form.
 */
export function ItemBivacPortCostsCard({ itemId, itemCode, canEdit }: ItemBivacPortCostsCardProps) {
  const [baseCode, setBaseCode] = useState('USD')
  const [saved, setSaved] = useState<ItemBivacPortCostDto[] | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    itemsApi
      .bivacPortCosts(itemId, controller.signal)
      .then((list) => {
        setSaved(list)
        setRows(toRows(list))
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof ApiError ? err.message : 'The BIVAC costs could not be loaded.')
      })
    portsApi.lookup(true).then(setPorts).catch(() => {})
    currenciesApi
      .lookup()
      .then((list) => {
        const base = list.find((c) => c.isBaseCurrency)
        if (base) setBaseCode(base.currencyCode)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [itemId])

  const changed = saved !== null && JSON.stringify(toRows(saved)) !== JSON.stringify(rows)
  const usedPorts = new Set(rows.map((r) => r.portId).filter((p): p is string => p !== null))
  const incomplete = rows.some((r) => r.portId === null || r.costBase === null || r.costBase < 0)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const list = await itemsApi.setBivacPortCosts(
        itemId,
        rows.map((r) => ({ portId: Number(r.portId), costBase: r.costBase ?? 0 })),
      )
      setSaved(list)
      setRows(toRows(list))
      notify.success(`BIVAC costs of ${itemCode} saved.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The BIVAC costs could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card radius="lg" p="lg" withBorder>
      <Stack gap="sm">
        <div>
          <Text fw={600} fz="md">
            BIVAC cost per port
          </Text>
          <Text fz="sm" c="dimmed">
            What a BIVAC / Inspection charge costs at each port of destination, in {baseCode}. A BIVAC charge on containers
            takes the cost of each container's port, and posting it posts a BIVAC Out of 1 pc.
          </Text>
        </div>
        {error && <Alert color="red">{error}</Alert>}
        {saved === null && !error ? (
          <Skeleton h={60} />
        ) : rows.length === 0 && !canEdit ? (
          <Text fz="sm" c="dimmed">
            No port has a BIVAC cost for this item yet.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={320}>
            <Table verticalSpacing={4} fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Port</Table.Th>
                  <Table.Th ta="right">Cost ({baseCode})</Table.Th>
                  {canEdit && <Table.Th w={40} />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row, index) => (
                  <Table.Tr key={index}>
                    <Table.Td>
                      {canEdit ? (
                        <Select
                          aria-label="Port"
                          placeholder="Choose the port"
                          data={ports
                            .filter((p) => String(p.id) === row.portId || !usedPorts.has(String(p.id)))
                            .map((p) => ({ value: String(p.id), label: `${p.portCode} - ${portLabel(p)}` }))}
                          value={row.portId}
                          onChange={(next) => setRows((all) => all.map((r, i) => (i === index ? { ...r, portId: next } : r)))}
                          searchable
                          allowDeselect={false}
                        />
                      ) : (
                        (saved?.find((s) => String(s.portId) === row.portId)?.portName ?? row.portId)
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      {canEdit ? (
                        <NumberInput
                          aria-label="Cost"
                          min={0}
                          decimalScale={2}
                          fixedDecimalScale
                          thousandSeparator=","
                          value={row.costBase ?? ''}
                          onChange={(next) =>
                            setRows((all) => all.map((r, i) => (i === index ? { ...r, costBase: numberInputValue(next) } : r)))
                          }
                        />
                      ) : (
                        formatNumber(row.costBase ?? 0, 2)
                      )}
                    </Table.Td>
                    {canEdit && (
                      <Table.Td>
                        <Tooltip label="Remove this port">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label="Remove this port"
                            onClick={() => setRows((all) => all.filter((_, i) => i !== index))}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {canEdit && saved !== null && (
          <Group justify="space-between">
            <Button
              type="button"
              variant="light"
              leftSection={<IconPlus size={16} />}
              onClick={() => setRows((all) => [...all, { portId: null, costBase: null }])}
            >
              Add a port
            </Button>
            <Tooltip label={incomplete ? 'Choose a port and type a cost on every row.' : 'Nothing changed.'} disabled={changed && !incomplete}>
              <Button type="button" loading={saving} disabled={!changed || incomplete} onClick={() => void save()}>
                Save costs
              </Button>
            </Tooltip>
          </Group>
        )}
      </Stack>
    </Card>
  )
}
