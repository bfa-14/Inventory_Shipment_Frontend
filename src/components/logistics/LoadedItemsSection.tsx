import { Fragment } from 'react'
import { ActionIcon, Anchor, Badge, Button, Checkbox, Group, NumberInput, Paper, ScrollArea, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { Link } from 'react-router'
import { routes } from '../../routes'
import type { FobSource } from '../../api/logistics/containers'
import { formatNumber, numberInputValue } from '../format'
import { lineOil, type LoadLine } from './containerForm'

interface LoadedItemsSectionProps {
  lines: LoadLine[]
  /** Status 1–5 and containers.create: quantities, oil and the lines themselves can change. */
  editable: boolean
  onLinesChange: (lines: LoadLine[]) => void
  onAddItems: () => void
  /** Line numbers the server refused ("Line 2: ..."), highlighted with the message. */
  lineErrors: Record<number, string>
  baseCurrencyCode: string
}

const FOB_SOURCE_COLOURS: Record<FobSource, string> = { Order: 'gray', Invoice: 'blue', Offload: 'green' }

/**
 * What the container carries: order lines in PIECES, grouped by purchase order, with how far each is
 * invoiced and what it really costs — FOB per unit (from the order, the invoices, or frozen at the
 * offload), the posted charges per unit and the landed cost, final once offloaded.
 *
 * A LINE THAT IS INVOICED IS HELD: its quantity cannot go below what is invoiced (the server says
 * LINE_INVOICED) and it cannot be removed. The input's minimum says so before the server does.
 */
export function LoadedItemsSection({ lines, editable, onLinesChange, onAddItems, lineErrors, baseCurrencyCode }: LoadedItemsSectionProps) {
  const received = lines.some((l) => l.receivedQuantityBase !== null)
  const columnCount = 13 + (editable ? 1 : 0)

  function update(key: string, patch: Partial<LoadLine>) {
    onLinesChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  return (
    <Paper radius="lg" p="md" withBorder data-loaded-items>
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Title order={5}>5. Loaded items</Title>
        {editable ? (
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={onAddItems}>
            Add items from purchase orders…
          </Button>
        ) : null}
      </Group>

      {lines.length === 0 ? (
        <Text c="dimmed" fz="sm" ta="center" py="md">
          No items loaded yet.
        </Text>
      ) : (
        <ScrollArea type="auto">
          <Table miw={1480} verticalSpacing={4} striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40}>#</Table.Th>
                <Table.Th>Item code</Table.Th>
                <Table.Th>Model</Table.Th>
                <Table.Th w={130} ta="right">Qty (pcs)</Table.Th>
                <Table.Th ta="right">Invoiced (posted / draft)</Table.Th>
                <Table.Th>PI No.</Table.Th>
                <Table.Th ta="right">FOB/unit</Table.Th>
                <Table.Th ta="right">Charges/unit</Table.Th>
                <Table.Th ta="right">Landed/unit ({baseCurrencyCode})</Table.Th>
                <Table.Th ta="right">Received</Table.Th>
                <Table.Th>Variance</Table.Th>
                <Table.Th>Oil</Table.Th>
                <Table.Th w={110}>Oil qty/unit</Table.Th>
                {editable ? <Table.Th w={44} /> : null}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((line, index) => {
                const error = lineErrors[index + 1]
                const newGroup = index === 0 || lines[index - 1].purchaseOrderId !== line.purchaseOrderId
                const saved = line.saved
                const short = line.receivedQuantityBase !== null && line.receivedQuantityBase < line.quantity
                const belowInvoiced = line.quantity < line.minBase
                const tooMuch = line.quantity > line.maxBase
                return (
                  <Fragment key={line.key}>
                    {newGroup ? (
                      <Table.Tr data-order-group={line.purchaseOrderId}>
                        <Table.Td colSpan={columnCount} bg="var(--mantine-color-gray-0)">
                          <Group gap="xs">
                            <Anchor component={Link} to={routes.purchaseOrder(line.purchaseOrderId)} fw={700} fz="sm">
                              {line.purchaseOrderNumber ?? `Order #${line.purchaseOrderId}`}
                            </Anchor>
                            <Text fz="sm" c="dimmed">
                              {line.supplierName}
                            </Text>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ) : null}
                    <Table.Tr bg={error ? 'var(--mantine-color-red-0)' : undefined}>
                      <Table.Td>
                        {error ? (
                          <Tooltip label={error} multiline w={320} withArrow>
                            <Text fz="sm" c="red" fw={700}>
                              {index + 1}
                            </Text>
                          </Tooltip>
                        ) : (
                          index + 1
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text fz="sm" fw={600}>
                          {line.itemCode}
                        </Text>
                        <Text fz="xs" c="dimmed">
                          {line.itemName}
                        </Text>
                      </Table.Td>
                      <Table.Td>{line.model ?? '—'}</Table.Td>
                      <Table.Td>
                        {editable ? (
                          <NumberInput
                            size="xs"
                            min={1}
                            max={line.maxBase}
                            // Not clamped: below the invoiced quantity the SERVER answers (LINE_INVOICED), and says why.
                            clampBehavior="none"
                            allowDecimal={false}
                            allowNegative={false}
                            thousandSeparator=","
                            // Empty while retyping (0 in state): snapping to 1 would glue the next digits onto it.
                            value={line.quantity || ''}
                            error={
                              line.quantity < 1
                                ? 'Required'
                                : tooMuch
                                  ? `Max ${formatNumber(line.maxBase)}`
                                  : belowInvoiced
                                    ? `${formatNumber(line.minBase)} invoiced`
                                    : undefined
                            }
                            onChange={(value) => update(line.key, { quantity: numberInputValue(value) ?? 0 })}
                            aria-label={`Quantity of ${line.itemCode}`}
                          />
                        ) : (
                          <Text fz="sm" ta="right">
                            {formatNumber(line.quantity)}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right">
                        {saved ? `${formatNumber(saved.invoicedPostedBase)} / ${formatNumber(saved.invoicedDraftBase)}` : '—'}
                      </Table.Td>
                      <Table.Td>
                        <Text fz="sm">{saved?.invoiceNumbers ?? '—'}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        {saved ? (
                          <Group gap={4} justify="flex-end" wrap="nowrap">
                            <Text fz="sm">{formatNumber(saved.unitFobBase, 2)}</Text>
                            <Badge size="xs" variant="light" color={FOB_SOURCE_COLOURS[saved.fobSource]} data-fob-source={saved.fobSource}>
                              {saved.fobSource}
                            </Badge>
                          </Group>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      <Table.Td ta="right">{saved ? formatNumber(saved.chargesPerUnitBase ?? 0, 2) : '—'}</Table.Td>
                      <Table.Td ta="right">
                        {saved?.landedCostBase != null ? (
                          <Group gap={4} justify="flex-end" wrap="nowrap">
                            <Text fz="sm" fw={saved.isLandedFinal ? 700 : 400}>
                              {formatNumber(saved.landedCostBase, 2)}
                            </Text>
                            {saved.isLandedFinal ? null : (
                              <Text fz="xs" c="dimmed">
                                est.
                              </Text>
                            )}
                          </Group>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      <Table.Td ta="right" c={short ? 'orange' : undefined} fw={short ? 700 : undefined}>
                        {received ? formatNumber(line.receivedQuantityBase) : '—'}
                      </Table.Td>
                      <Table.Td>
                        <Text fz="sm">{line.varianceReason ?? (received && line.receivedQuantityBase !== null ? formatNumber(line.receivedQuantityBase - line.quantity) : '—')}</Text>
                      </Table.Td>
                      <Table.Td>
                        {editable ? (
                          <Checkbox
                            checked={line.oilIncluded}
                            onChange={(e) => update(line.key, { oilIncluded: e.currentTarget.checked })}
                            aria-label={`Oil included for ${line.itemCode}`}
                          />
                        ) : line.oilIncluded ? (
                          `Yes (${formatNumber(lineOil(line), 2)})`
                        ) : (
                          'No'
                        )}
                      </Table.Td>
                      <Table.Td>
                        {editable ? (
                          <NumberInput
                            size="xs"
                            min={0}
                            decimalScale={2}
                            disabled={!line.oilIncluded}
                            value={line.oilQtyPerUnit ?? ''}
                            onChange={(value) => update(line.key, { oilQtyPerUnit: numberInputValue(value) })}
                            aria-label={`Oil per unit for ${line.itemCode}`}
                          />
                        ) : (
                          formatNumber(line.oilQtyPerUnit, 2)
                        )}
                      </Table.Td>
                      {editable ? (
                        <Table.Td>
                          <Tooltip label={line.minBase > 0 ? 'Invoiced - it cannot be removed' : 'Remove'} withArrow>
                            <span>
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                disabled={line.minBase > 0}
                                aria-label={`Remove ${line.itemCode}`}
                                onClick={() => onLinesChange(lines.filter((l) => l.key !== line.key))}
                              >
                                <IconTrash size={16} />
                              </ActionIcon>
                            </span>
                          </Tooltip>
                        </Table.Td>
                      ) : null}
                    </Table.Tr>
                  </Fragment>
                )
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Paper>
  )
}
