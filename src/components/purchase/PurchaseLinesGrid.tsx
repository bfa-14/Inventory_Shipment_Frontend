import { Fragment } from 'react'
import { ActionIcon, Anchor, Badge, Group, Menu, NumberInput, Select, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconDotsVertical, IconExternalLink, IconTrash } from '@tabler/icons-react'
import { Link } from 'react-router'
import { containerStatusColour, containerStatusLabel } from '../../api/logistics/containers'
import type { ItemLookupDto, ItemUnitDto } from '../../api/types'
import { unitLabel } from '../documents/documentKind'
import { formatMoney, formatNumber, numberInputValue } from '../format'
import { lineMaximum, purchaseLineTotal } from './purchaseLines'

/**
 * One purchase line while it is on the page.
 *
 * NULLABLE WHERE A ROW CAN BE HALF-TYPED: an item chosen but no unit yet, a unit whose item has no
 * last cost. The page turns these into the API's shape on save; a null price is sent as null and the
 * server prices the line from the item's last cost (0 when it has none).
 */
export interface PurchaseLine {
  key: string
  id: number | null
  itemId: number | null
  itemCode: string
  itemName: string
  itemUnitId: number | null
  unitTypeName: string
  packingFormula: number
  /** The item's units, fetched when the item is chosen or the unit box is opened. */
  units: ItemUnitDto[]
  quantity: number
  /** The unit cost in the document currency. Null = the item's last cost, resolved by the server. */
  unitPrice: number | null
  discountPercent: number
  expiryDate: string | null
  notes: string
  /** Stock in the document's warehouse, or null while unknown. */
  onHandBase: number | null
  importRowNumber: number | null
  /** The order line an invoice line receives, or the invoice line a return line gives back. */
  sourceLineId: number | null
  /** What that source line still allows, in base units. Null on a line without a source. */
  sourceRemainingBase: number | null
  /** Orders: shipped by the supplier and not yet received, in base units. Null on a line not saved yet. */
  transitBase?: number | null
  /** Posted invoices: what the supplier charged per base unit, before the charges around it. */
  fobCostBase?: number | null
  /** Posted invoices: the charges this line took, in the base currency. */
  allocatedChargesBase?: number | null
  /** Posted invoices: FOB plus those charges, per base unit — what the ledger took. */
  landedCostBase?: number | null
  /* Invoices from containers: the container line this line invoices, kept and sent back on save. */
  containerLineId?: number | null
  containerId?: number | null
  containerRef?: string | null
  containerNo?: string | null
  containerStatus?: number | null
  /** FOB + the container charges per unit — final once the container is offloaded. */
  estimatedLandedCostBase?: number | null
  /** The saved line's quantity in base units: its own share of the container line counts as available to it. */
  savedQuantityBase?: number | null
  /** A message about the row: the server's "Line N: …". */
  error?: string
}

interface PurchaseLinesGridProps {
  lines: PurchaseLine[]
  onChange: (key: string, patch: Partial<PurchaseLine>) => void
  onRemove: (key: string) => void
  onAdd: () => void
  /** Every active item, for the Item Code select of a new row. */
  items: ItemLookupDto[]
  /** An item was picked on a row: the page fetches its units and its last cost. */
  onItemChosen: (key: string, itemId: number) => void
  /** A unit was picked: the page re-prices the line. */
  onUnitChosen: (key: string, unit: ItemUnitDto) => void
  /** The unit box was opened on a line whose units are not loaded yet. */
  onUnitsNeeded: (key: string) => void
  currencyCode: string
  decimalPlaces: number
  /** From the document type configuration: whether the cost may be typed at all. */
  priceEditable: boolean
  /** True on a return: the grid then warns when a line asks for more than there is. */
  warnOnOverdraw: boolean
  /** True on a document made from another: the item and unit are the source's and cannot change. */
  linesFromSource: boolean
  /** True on a purchase order: the grid shows what is in transit (recorded with "Mark as shipped"). */
  showTransit?: boolean
  /** True on a POSTED purchase invoice: the three cost columns the charges produced. */
  showCosts?: boolean
  /** The base currency's code, for the cost column captions. */
  baseCurrencyCode?: string
  /** An invoice from containers: the lines are grouped under a header per container. */
  groupByContainer?: boolean
  /** An invoice from containers: FOB + the container charges per unit. */
  showEstimatedLanded?: boolean
  /** False on an invoice from containers: its lines are the container lines, none can be added. */
  allowAdd?: boolean
  readOnly: boolean
}

/**
 * The purchase document's lines, edited in place.
 *
 * THE SALES GRID IN COST MODE. Same plain table, same inputs in the cells, same "+ Click to add"
 * row; what differs is what the price column means — the unit COST in the document currency,
 * defaulted from the item's last cost and typed over freely — and the cap a source puts on the
 * quantity: an invoice line cannot receive more than its order line still has, and the row says
 * "Remaining: n" under the box so the limit is visible before the server refuses it.
 */
export function PurchaseLinesGrid({
  lines,
  onChange,
  onRemove,
  onAdd,
  items,
  onItemChosen,
  onUnitChosen,
  onUnitsNeeded,
  currencyCode,
  decimalPlaces,
  priceEditable,
  warnOnOverdraw,
  linesFromSource,
  showTransit = false,
  showCosts = false,
  baseCurrencyCode = 'USD',
  groupByContainer = false,
  showEstimatedLanded = false,
  allowAdd = true,
  readOnly,
}: PurchaseLinesGridProps) {
  const columnCount = 11 + (showTransit ? 1 : 0) + (showCosts ? 3 : 0) + (showEstimatedLanded ? 1 : 0)

  const itemOptions = items.map((i) => ({ value: String(i.id), label: `${i.itemCode} — ${i.itemName}` }))

  return (
    <Table.ScrollContainer minWidth={1150 + (showTransit ? 100 : 0) + (showCosts ? 380 : 0) + (showEstimatedLanded ? 130 : 0)}>
      <Table striped highlightOnHover verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={56}>#</Table.Th>
            <Table.Th w={240}>Item Code</Table.Th>
            <Table.Th w={200}>Item Name</Table.Th>
            <Table.Th w={150}>Unit</Table.Th>
            <Table.Th w={90} ta="right">On Hand</Table.Th>
            <Table.Th w={110} ta="right">Qty</Table.Th>
            {showTransit && <Table.Th w={100} ta="right">In transit</Table.Th>}
            <Table.Th w={150} ta="right">Unit Cost</Table.Th>
            <Table.Th w={90} ta="right">Disc %</Table.Th>
            <Table.Th w={140} ta="right">Line Total</Table.Th>
            {showCosts && (
              <>
                <Table.Th w={120} ta="right">FOB ({baseCurrencyCode})</Table.Th>
                <Table.Th w={120} ta="right">Charges ({baseCurrencyCode})</Table.Th>
                <Table.Th w={140} ta="right">Landed cost ({baseCurrencyCode})</Table.Th>
              </>
            )}
            {showEstimatedLanded && <Table.Th w={130} ta="right">Est. landed/unit ({baseCurrencyCode})</Table.Th>}
            <Table.Th w={160}>Notes</Table.Th>
            <Table.Th w={84} />
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {lines.map((line, index) => {
            const wanted = line.quantity * (line.packingFormula || 1)
            const short = warnOnOverdraw && line.onHandBase !== null && wanted > line.onHandBase
            const max = lineMaximum(line)
            const over = max !== null && line.quantity > max
            const problem = line.error ?? (over ? `Only ${formatNumber(max)} remain on the source line.` : undefined)
            const fixed = readOnly || (linesFromSource && line.sourceLineId !== null)
            // A header row above the first line of each container (the server returns them grouped).
            const newGroup = groupByContainer && (index === 0 || lines[index - 1].containerId !== line.containerId)

            return (
              <Fragment key={line.key}>
              {newGroup && (
                <Table.Tr data-container-group={line.containerId ?? 'none'}>
                  <Table.Td colSpan={columnCount} bg="var(--mantine-color-gray-0)">
                    {line.containerId ? (
                      <Group gap="xs" wrap="wrap">
                        <Anchor component={Link} to={`/logistics/containers/${line.containerId}`} fw={700} fz="sm">
                          {line.containerRef}
                        </Anchor>
                        {line.containerNo ? <Text fz="sm" c="dimmed">{line.containerNo}</Text> : null}
                        {line.containerStatus ? (
                          <Badge size="sm" variant="light" color={containerStatusColour(line.containerStatus)}>
                            {containerStatusLabel(line.containerStatus)}
                          </Badge>
                        ) : null}
                      </Group>
                    ) : (
                      <Text fz="sm" c="dimmed">Without container</Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              )}
              <Table.Tr bg={problem ? 'var(--mantine-color-red-0)' : undefined}>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    {index + 1}
                    {problem && (
                      <Tooltip label={problem} multiline w={300} withArrow>
                        <IconAlertTriangle size={15} color="var(--mantine-color-red-6)" />
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>

                <Table.Td data-line-item={index} className="line-item-link">
                  {readOnly || line.itemId !== null ? (
                    line.itemId === null ? (
                      <Text fz="sm" fw={500}>{line.itemCode}</Text>
                    ) : (
                      <Group gap={4} wrap="nowrap">
                        <Anchor component={Link} to={`/inventory/items/${line.itemId}`} target="_blank" rel="noopener" fz="sm" fw={500} tabIndex={-1} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {line.itemCode}
                          <IconExternalLink size={14} className="line-item-link-icon" />
                        </Anchor>
                      </Group>
                    )
                  ) : (
                    <Select
                      data={itemOptions}
                      value={null}
                      placeholder="Choose an item"
                      searchable
                      onChange={(next) => next && onItemChosen(line.key, Number(next))}
                      error={Boolean(line.error)}
                      comboboxProps={{ withinPortal: true }}
                    />
                  )}
                </Table.Td>

                <Table.Td>
                  <Text fz="sm" c="dimmed">{line.itemName || '—'}</Text>
                </Table.Td>

                <Table.Td>
                  {fixed ? (
                    <Text fz="sm">{unitLabel(line.unitTypeName, line.packingFormula)}</Text>
                  ) : (
                    <Select
                      data={line.units.map((u) => ({ value: String(u.id), label: unitLabel(u.unitTypeName, u.packingFormula) }))}
                      value={line.itemUnitId === null ? null : String(line.itemUnitId)}
                      placeholder={line.itemId ? unitLabel(line.unitTypeName, line.packingFormula) || 'Unit' : '—'}
                      disabled={line.itemId === null}
                      onDropdownOpen={() => line.units.length === 0 && onUnitsNeeded(line.key)}
                      onChange={(next) => {
                        const unit = line.units.find((u) => String(u.id) === next)
                        if (unit) onUnitChosen(line.key, unit)
                      }}
                      comboboxProps={{ withinPortal: true }}
                    />
                  )}
                </Table.Td>

                <Table.Td ta="right">
                  {line.onHandBase === null ? (
                    <Text fz="sm" c="dimmed">—</Text>
                  ) : (
                    <Text fz="sm" fw={short ? 700 : 400} c={short ? 'red' : undefined}>
                      {formatNumber(line.onHandBase)}
                    </Text>
                  )}
                </Table.Td>

                <Table.Td data-line-qty={line.key}>
                  {readOnly ? (
                    <Text fz="sm" ta="right">{formatNumber(line.quantity)}</Text>
                  ) : (
                    <NumberInput
                      value={line.quantity > 0 ? line.quantity : ''}
                      min={1}
                      max={max ?? undefined}
                      step={1}
                      allowDecimal={false}
                      allowNegative={false}
                      thousandSeparator=","
                      onChange={(next) => onChange(line.key, { quantity: numberInputValue(next) ?? 0 })}
                      error={short || over}
                      description={max === null ? undefined : `Remaining: ${formatNumber(max)}`}
                      aria-label={`Quantity of line ${index + 1}`}
                    />
                  )}
                </Table.Td>

                {showTransit && (
                  <Table.Td ta="right" data-line-transit={line.key}>
                    {line.transitBase == null || line.transitBase === 0 ? (
                      <Text fz="sm" c="dimmed">{line.transitBase === 0 ? '0' : '—'}</Text>
                    ) : (
                      <Tooltip label="Shipped by the supplier, not yet received (base units)" withArrow>
                        <Text fz="sm" fw={600} c="blue">{formatNumber(line.transitBase)}</Text>
                      </Tooltip>
                    )}
                  </Table.Td>
                )}

                <Table.Td data-line-cost={line.key}>
                  {readOnly || !priceEditable ? (
                    <Tooltip label="The cost is set by the document type configuration" disabled={readOnly || priceEditable} withArrow>
                      <Text fz="sm" ta="right" c={line.unitPrice === null ? 'dimmed' : undefined}>
                        {line.unitPrice === null ? '—' : formatNumber(line.unitPrice, decimalPlaces)}
                      </Text>
                    </Tooltip>
                  ) : (
                    <NumberInput
                      value={line.unitPrice ?? ''}
                      min={0}
                      decimalScale={decimalPlaces}
                      fixedDecimalScale
                      thousandSeparator=","
                      placeholder="Last cost"
                      onChange={(next) => onChange(line.key, { unitPrice: numberInputValue(next) })}
                      aria-label={`Unit cost of line ${index + 1}`}
                    />
                  )}
                </Table.Td>

                <Table.Td>
                  {readOnly ? (
                    <Text fz="sm" ta="right">{formatNumber(line.discountPercent, 2)}</Text>
                  ) : (
                    <NumberInput
                      value={line.discountPercent}
                      min={0}
                      max={100}
                      decimalScale={2}
                      allowNegative={false}
                      clampBehavior="strict"
                      onChange={(next) => onChange(line.key, { discountPercent: numberInputValue(next) ?? 0 })}
                      aria-label={`Discount of line ${index + 1}`}
                    />
                  )}
                </Table.Td>

                <Table.Td ta="right">
                  <Text fz="sm" fw={500}>{formatMoney(purchaseLineTotal(line), currencyCode, decimalPlaces)}</Text>
                </Table.Td>

                {showCosts && (
                  <>
                    {/* Per base unit, so FOB and Landed read against each other; the charges are the line's whole share. */}
                    <Table.Td ta="right" data-line-fob={line.key}>
                      <Text fz="sm">{formatNumber(line.fobCostBase, 2)}</Text>
                    </Table.Td>
                    <Table.Td ta="right" data-line-charges={line.key}>
                      <Text fz="sm">{formatNumber(line.allocatedChargesBase, 2)}</Text>
                    </Table.Td>
                    <Table.Td ta="right" data-line-landed={line.key}>
                      <Tooltip label="FOB plus the charges allocated to this line, per base unit — what the ledger took" withArrow>
                        <Text fz="sm" fw={600}>{formatNumber(line.landedCostBase, 2)}</Text>
                      </Tooltip>
                    </Table.Td>
                  </>
                )}

                {showEstimatedLanded && (
                  <Table.Td ta="right" data-line-est-landed={line.key}>
                    <Text fz="sm" fw={600}>{formatNumber(line.estimatedLandedCostBase, 2)}</Text>
                  </Table.Td>
                )}

                <Table.Td>
                  {readOnly ? (
                    <Text fz="sm" c="dimmed">{line.notes || '—'}</Text>
                  ) : (
                    <TextInput
                      value={line.notes}
                      placeholder="Optional"
                      maxLength={300}
                      onChange={(event) => onChange(line.key, { notes: event.currentTarget.value })}
                    />
                  )}
                </Table.Td>

                <Table.Td>
                  <Group gap={2} wrap="nowrap" justify="flex-end">
                    {!readOnly && (
                      <Tooltip label="Remove line" withArrow>
                        <ActionIcon variant="subtle" color="red" onClick={() => onRemove(line.key)} aria-label={`Remove line ${index + 1}`}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                    <Menu position="bottom-end" withinPortal shadow="md" width={200}>
                      <Menu.Target>
                        <ActionIcon variant="subtle" tabIndex={-1} aria-label={`Actions for line ${index + 1}`}>
                          <IconDotsVertical size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          component="a"
                          href={line.itemId === null ? undefined : `/inventory/items/${line.itemId}`}
                          target="_blank"
                          rel="noopener"
                          leftSection={<IconExternalLink size={14} />}
                          disabled={line.itemId === null}
                        >
                          View item details
                        </Menu.Item>
                        {!readOnly && (
                          <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => onRemove(line.key)}>
                            Remove line
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </Table.Td>
              </Table.Tr>
              </Fragment>
            )
          })}

          {lines.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <Text ta="center" c="dimmed" py="lg">
                  No lines yet. Scan an item above, add one below, or import a file.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}

          {!readOnly && allowAdd && (
            <Table.Tr style={{ cursor: 'pointer' }} onClick={onAdd}>
              <Table.Td colSpan={columnCount}>
                <Text c="dimmed" fz="sm">
                  + Click to add an item…
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
