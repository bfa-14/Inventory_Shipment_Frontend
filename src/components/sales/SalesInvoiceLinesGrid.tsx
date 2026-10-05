import { ActionIcon, Anchor, Autocomplete, Badge, Group, Menu, NumberInput, Select, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconDotsVertical, IconExternalLink, IconTrash } from '@tabler/icons-react'
import { Link } from 'react-router'
import type { ItemLookupDto, ItemUnitDto } from '../../api/types'
import { unitLabel } from '../documents/documentKind'
import { formatMoney, formatNumber, numberInputValue } from '../format'
import { invoiceLineTotal } from './salesLines'

/**
 * One invoice line while it is on the page.
 *
 * NULLABLE WHERE A ROW CAN BE HALF-TYPED: an item chosen but no unit yet, a unit with no price in the
 * list. The page turns these into the API's shape on save, and refuses to save a row it cannot price.
 */
export interface InvoiceLine {
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
  /** What the line is charged. Null when the list has no price for the unit and nobody typed one. */
  unitPrice: number | null
  /** The price list's own figure for the unit, for the "manual" badge. Null when the list has none. */
  systemPrice: number | null
  /** PriceList | Manual — Manual is what the server is told; a list price is left for it to re-find. */
  priceSource: 'PriceList' | 'Manual'
  discountPercent: number
  expiryDate: string | null
  notes: string
  /** The warehouse this line ships from. The warehouse is a LINE's now, not the document's. */
  warehouseId: number | null
  /** The specification this line is sold as, chosen from those the item offers. */
  specification: string | null
  /** What OTHER invoices called this item — the dropdown's suggestions, not a constraint. */
  specifications: string[]
  /** Stock in THIS line's warehouse, or null while unknown. */
  onHandBase: number | null
  importRowNumber: number | null
  /** A message about the row: the server's "Line N: …", or the page's own "No price in …". */
  error?: string
}

interface SalesInvoiceLinesGridProps {
  lines: InvoiceLine[]
  onChange: (key: string, patch: Partial<InvoiceLine>) => void
  onRemove: (key: string) => void
  onAdd: () => void
  /** Every active item, for the Item Code select of a new row. */
  items: ItemLookupDto[]
  /** An item was picked on a row: the page fetches its units and its price. */
  onItemChosen: (key: string, itemId: number) => void
  /** A unit was picked: the page re-resolves the price. */
  onUnitChosen: (key: string, unit: ItemUnitDto) => void
  /** The unit box was opened on a line whose units are not loaded yet. */
  onUnitsNeeded: (key: string) => void
  currencyCode: string
  decimalPlaces: number
  /** The list's name, for the "No price in …" wording. */
  priceListName: string
  /** Only a holder of the price override may type a price; with PriceList pricing it is otherwise read-only. */
  priceEditable: boolean
  /** Every active warehouse, of any branch, for the per-line Warehouse select. */
  warehouses: { value: string; label: string }[]
  readOnly: boolean
}

/**
 * The invoice's lines, edited in place.
 *
 * THE SAME SHAPE AS THE STOCK GRID — a plain table, inputs in the cells, a row that is also the Add
 * button — with two things of its own: a unit picker (a sale can be in boxes or pieces, and the
 * price follows the unit), and a price that is the list's unless somebody with the override
 * permission types over it, in which case the row says "manual" so the difference is visible.
 *
 * A ROW WITHOUT A PRICE IS RED AND SAYS SO. The list simply has no price for that unit; the page
 * refuses to save until one is typed or the unit changed, because the server would refuse it with
 * NO_PRICE anyway and a red row is a better place to learn that than a toast.
 */
export function SalesInvoiceLinesGrid({
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
  priceListName,
  priceEditable,
  warehouses,
  readOnly,
}: SalesInvoiceLinesGridProps) {
  const itemOptions = items.map((i) => ({ value: String(i.id), label: `${i.itemCode} — ${i.itemName}` }))

  /**
   * What one line's Specification box offers: what THIS invoice already says for the same item,
   * then what past invoices said.
   *
   * THE INVOICE IN FRONT OF THE READER COMES FIRST, and it comes from the rows rather than from the
   * server, so a specification typed a moment ago on another line can be picked here immediately —
   * without saving first, which is the only way the server would ever hear about it.
   *
   * The line's own text is left out: the box already holds it, and offering it back is noise.
   */
  function suggestionsFor(line: InvoiceLine) {
    const seen: string[] = []
    const add = (value?: string | null) => {
      const text = value?.trim()
      if (text && !seen.includes(text)) seen.push(text)
    }

    if (line.itemId !== null) {
      for (const other of lines) {
        if (other.key !== line.key && other.itemId === line.itemId) add(other.specification)
      }
    }
    for (const past of line.specifications) add(past)

    return seen
  }

  return (
    <Table.ScrollContainer minWidth={1510}>
      <Table striped highlightOnHover verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={56}>#</Table.Th>
            <Table.Th w={240}>Item Code</Table.Th>
            <Table.Th w={200}>Item Name</Table.Th>
            <Table.Th w={150}>Unit</Table.Th>
            <Table.Th w={170}>Specification</Table.Th>
            <Table.Th w={190}>Warehouse</Table.Th>
            <Table.Th w={90} ta="right">On Hand</Table.Th>
            <Table.Th w={100} ta="right">Qty</Table.Th>
            <Table.Th w={150} ta="right">Unit Price</Table.Th>
            <Table.Th w={90} ta="right">Disc %</Table.Th>
            <Table.Th w={140} ta="right">Line Total</Table.Th>
            <Table.Th w={160}>Notes</Table.Th>
            <Table.Th w={84} />
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {lines.map((line, index) => {
            const wanted = line.quantity * (line.packingFormula || 1)
            const short = line.onHandBase !== null && wanted > line.onHandBase
            const unpriced = line.itemUnitId !== null && line.unitPrice === null
            const problem = line.error ?? (unpriced ? `No price in ${priceListName}` : undefined)
            const manual = line.priceSource === 'Manual' && line.unitPrice !== null && line.unitPrice !== line.systemPrice

            return (
              <Table.Tr key={line.key} bg={problem ? 'var(--mantine-color-red-0)' : undefined}>
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
                  {readOnly ? (
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

                {/* A NOTE THAT REMEMBERS WHAT THE LAST ONE SAID. The cell is free text, like Notes:
                    anything may be typed. Under it sits the text already used for this ITEM — on
                    the other lines of this invoice first, then on invoices already saved — so the
                    second sale of a thing can pick what the first one called it without anybody
                    maintaining a list of specifications.

                    Suggestions, never a constraint — nothing validates the text against them, and an
                    item nobody has sold yet simply has none to offer until somebody types one. */}
                <Table.Td>
                  {readOnly ? (
                    <Text fz="sm">{line.specification || '—'}</Text>
                  ) : (
                    <Autocomplete
                      data={suggestionsFor(line)}
                      value={line.specification ?? ''}
                      placeholder={line.itemId === null ? '—' : 'Specification'}
                      disabled={line.itemId === null}
                      maxLength={100}
                      onChange={(next) => onChange(line.key, { specification: next.trim() ? next : null })}
                      comboboxProps={{ withinPortal: true }}
                    />
                  )}
                </Table.Td>

                <Table.Td>
                  {readOnly ? (
                    <Text fz="sm">
                      {warehouses.find((w) => w.value === String(line.warehouseId))?.label ?? '—'}
                    </Text>
                  ) : (
                    <Select
                      data={warehouses}
                      value={line.warehouseId === null ? null : String(line.warehouseId)}
                      placeholder={warehouses.length === 0 ? 'No active warehouses' : 'Warehouse'}
                      disabled={warehouses.length === 0}
                      searchable
                      /* On Hand is this item IN THIS WAREHOUSE, so the figure beside it goes stale
                         the moment this changes. Null shows a dash until the new one arrives. */
                      onChange={(next) => {
                        if (!next) return
                        onChange(line.key, { warehouseId: Number(next), onHandBase: null })
                      }}
                      error={Boolean(line.error) && line.warehouseId === null}
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
                      step={1}
                      allowDecimal={false}
                      allowNegative={false}
                      thousandSeparator=","
                      onChange={(next) => onChange(line.key, { quantity: numberInputValue(next) ?? 0 })}
                      error={short}
                      aria-label={`Quantity of line ${index + 1}`}
                    />
                  )}
                </Table.Td>

                <Table.Td data-line-price={line.key}>
                  {readOnly || !priceEditable ? (
                    <Tooltip
                      label={priceEditable ? '' : 'Prices come from the price list (no price override permission)'}
                      disabled={readOnly || priceEditable}
                      withArrow
                    >
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        {manual && <Badge size="xs" variant="light" color="grape">manual</Badge>}
                        <Text fz="sm" ta="right" c={line.unitPrice === null ? 'red' : undefined}>
                          {line.unitPrice === null ? '—' : formatNumber(line.unitPrice, decimalPlaces)}
                        </Text>
                      </Group>
                    </Tooltip>
                  ) : (
                    <Group gap={4} wrap="nowrap">
                      <NumberInput
                        value={line.unitPrice ?? ''}
                        min={0}
                        decimalScale={decimalPlaces}
                        fixedDecimalScale
                        thousandSeparator=","
                        onChange={(next) => {
                          const price = numberInputValue(next)
                          onChange(line.key, {
                            unitPrice: price,
                            // Typing the list's own figure back is not an override.
                            priceSource: price !== null && price !== line.systemPrice ? 'Manual' : 'PriceList',
                          })
                        }}
                        error={line.unitPrice === null}
                        aria-label={`Price of line ${index + 1}`}
                        style={{ flex: 1 }}
                      />
                      {manual && (
                        <Tooltip label={`List price ${line.systemPrice === null ? 'none' : formatNumber(line.systemPrice, decimalPlaces)}`} withArrow>
                          <Badge size="xs" variant="light" color="grape">manual</Badge>
                        </Tooltip>
                      )}
                    </Group>
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
                  <Text fz="sm" fw={500}>{formatMoney(invoiceLineTotal(line), currencyCode, decimalPlaces)}</Text>
                </Table.Td>

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
            )
          })}

          {lines.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={13}>
                <Text ta="center" c="dimmed" py="lg">
                  No lines yet. Scan an item above, add one below, or import a file.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}

          {!readOnly && (
            <Table.Tr style={{ cursor: 'pointer' }} onClick={onAdd}>
              <Table.Td colSpan={13}>
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
