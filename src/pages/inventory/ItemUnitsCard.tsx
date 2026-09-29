import { ActionIcon, Badge, Box, Button, Card, Group, Skeleton, Stack, Table, Text, Tooltip } from '@mantine/core'
import { IconCheck, IconMinus, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import type { ItemUnitDto } from '../../api/types'

interface ItemUnitsCardProps {
  units: ItemUnitDto[]
  /** False in view mode and for a reader without the edit permission: the table is then read-only. */
  editable: boolean
  loading?: boolean
  onAdd(): void
  onEdit(unit: ItemUnitDto): void
  onDelete(unit: ItemUnitDto): void
  /** The unit a request is currently running for; its icons are disabled meanwhile. */
  busyUnitId?: number | null
  /**
   * True while the item is being created, when a unit is not optional: an item with no units
   * cannot be sold, bought or counted, so Save refuses. Said here as well, because the rule belongs
   * to this card and a reader should meet it before the Save button tells them.
   */
  required?: boolean
}

/** A green tick or a dimmed dash - a yes/no cell reads faster than the words. */
function Flag({ on, label }: { on: boolean; label: string }) {
  return on ? (
    <Tooltip label={label} withArrow position="top">
      <IconCheck size={17} color="var(--mantine-color-green-6)" aria-label={label} />
    </Tooltip>
  ) : (
    <IconMinus size={15} color="var(--mantine-color-gray-4)" aria-label={`Not a ${label.toLowerCase()}`} />
  )
}

/** The item's packing units: what it is bought, stored and sold in, and how they convert. */
export function ItemUnitsCard({
  units,
  editable,
  loading = false,
  onAdd,
  onEdit,
  onDelete,
  busyUnitId,
  required = false,
}: ItemUnitsCardProps) {
  const missing = required && units.length === 0

  return (
    <Card radius="lg" p="lg" withBorder>
      <Group justify="space-between" align="center" mb="md" wrap="wrap" gap="sm">
        <Box>
          <Text fw={600} fz="md">
            Units &amp; Packaging
            {required ? (
              // The same asterisk the required fields carry, so the card reads as one of them.
              <Text component="span" c="red" aria-hidden>
                {' '}
                *
              </Text>
            ) : null}
          </Text>
          <Text c="dimmed" fz="sm">
            The base unit is the quantity everything else converts to.
          </Text>
        </Box>
        {editable ? (
          <Button variant="light" size="sm" leftSection={<IconPlus size={16} />} onClick={onAdd}>
            Add Unit
          </Button>
        ) : null}
      </Group>

      {loading ? (
        <Stack gap="xs">
          <Skeleton height={34} radius="sm" />
          <Skeleton height={34} radius="sm" />
        </Stack>
      ) : units.length === 0 ? (
        <Text c={missing ? 'red' : 'dimmed'} fz="sm" py="md">
          No units yet.{' '}
          {editable
            ? 'Add the unit this item is counted in - the first one becomes the base unit.'
            : 'This item cannot be transacted until it has a base unit.'}
        </Text>
      ) : (
        // A narrow screen scrolls the table sideways rather than crushing eight columns into 390px.
        <Table.ScrollContainer minWidth={720}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Unit Type</Table.Th>
                <Table.Th ta="right">Packing Formula</Table.Th>
                <Table.Th>SKU Code</Table.Th>
                <Table.Th>Barcode</Table.Th>
                <Table.Th ta="center">Sales</Table.Th>
                <Table.Th ta="center">Purchase</Table.Th>
                <Table.Th ta="center">Base</Table.Th>
                {editable ? <Table.Th ta="right">Actions</Table.Th> : null}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {units.map((unit) => (
                <Table.Tr key={unit.id}>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Text fz="sm" fw={unit.isBaseUnit ? 600 : 400}>
                        {unit.unitTypeName}
                      </Text>
                      {unit.isBaseUnit ? (
                        <Badge size="xs" variant="light" color="blue">
                          Base
                        </Badge>
                      ) : null}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text fz="sm">{unit.packingFormula}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm">{unit.skuCode}</Text>
                  </Table.Td>
                  <Table.Td>
                    {unit.barcode ? (
                      <Text fz="sm">{unit.barcode}</Text>
                    ) : (
                      <Text c="dimmed" fz="sm">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td ta="center">
                    <Flag on={unit.isSalesUnit} label="Sales unit" />
                  </Table.Td>
                  <Table.Td ta="center">
                    <Flag on={unit.isPurchaseUnit} label="Purchase unit" />
                  </Table.Td>
                  <Table.Td ta="center">
                    <Flag on={unit.isBaseUnit} label="Base unit" />
                  </Table.Td>
                  {editable ? (
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Edit unit" withArrow position="top">
                          <ActionIcon
                            variant="subtle"
                            color="blue"
                            aria-label={`Edit unit ${unit.skuCode}`}
                            disabled={busyUnitId === unit.id}
                            onClick={() => onEdit(unit)}
                          >
                            <IconPencil size={17} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip
                          label={unit.isBaseUnit ? 'The base unit cannot be deleted' : 'Delete unit'}
                          withArrow
                          position="top"
                        >
                          {/* A disabled ActionIcon swallows pointer events, so the span keeps the tooltip alive. */}
                          <span>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              aria-label={`Delete unit ${unit.skuCode}`}
                              disabled={unit.isBaseUnit || busyUnitId === unit.id}
                              onClick={() => onDelete(unit)}
                            >
                              <IconTrash size={17} />
                            </ActionIcon>
                          </span>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  ) : null}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  )
}
