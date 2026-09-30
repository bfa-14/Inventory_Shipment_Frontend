import { ActionIcon, Anchor, Group, Menu, NumberInput, Select, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconDotsVertical, IconExternalLink, IconTrash } from '@tabler/icons-react'
import { Link } from 'react-router'
import type { ItemLookupDto, ItemUnitDto } from '../../api/types'
import { formatNumber, numberInputValue } from '../format'
import { money, unitLabel } from './documentKind'

/**
 * One row of the grid while it is being edited.
 *
 * IT IS NOT THE API'S LINE. A row being typed into is half-finished by definition — an item chosen
 * but no unit yet, a quantity with no item — so every reference is nullable here and the page turns
 * these into the API's shape only when it saves. Mapping the server's non-null line onto the editor
 * would mean either lying about the types or refusing to let anybody start a row.
 */
export interface EditableLine {
  /** Stable across re-orders and re-renders. Not the id: a new row has no id and two do not collide. */
  key: string
  /** The server's line id, or null on a row that has never been saved. */
  id: number | null
  itemId: number | null
  itemCode: string
  itemName: string
  itemUnitId: number | null
  unitTypeName: string
  packingFormula: number
  warehouseId: number | null
  expiryDate: string | null
  quantity: number
  unitCost: number
  notes: string
  /** Stock in this item and warehouse, or null while it is being fetched. */
  onHandBase: number | null
  /**
   * What the Unit select offers. Narrowed to the three fields it actually draws with, so a line
   * loaded from the server can seed this from the unit it already carries without inventing the
   * rest of an ItemUnitDto - the full list replaces it once the item's units arrive.
   */
  units: Pick<ItemUnitDto, 'id' | 'unitTypeName' | 'packingFormula'>[]
  /** A "Line N: …" message the API sent back about this row. */
  error?: string
}

interface DocumentLinesGridProps {
  lines: EditableLine[]
  onChange: (key: string, patch: Partial<EditableLine>) => void
  onRemove: (key: string) => void
  onAdd: () => void
  /** Every active item, for the Item Code select. Searchable, so the whole list is fine. */
  items: ItemLookupDto[]
  /** When an item is picked, the page fetches its units and its last cost. */
  onItemChosen: (key: string, itemId: number) => void
  currencyCode: string
  /** False on an Inventory Out: the cost is the average, applied by the database. */
  costIsEditable: boolean
  /** True on an Out — the grid then warns when a line asks for more than there is. */
  warnOnOverdraw: boolean
  readOnly: boolean
}

/**
 * The lines of a document, edited in place.
 *
 * A PLAIN TABLE RATHER THAN THE SHARED DataTable, and the reason is the inputs. The shared grid is
 * built for reading — paging, sorting, per-column funnels — and a document's lines are a form: eight
 * to fifteen rows, no paging, every cell editable, and the tab order left-to-right through all of
 * them. Bending a reading grid into a form is how both stop working.
 *
 * IT SCROLLS SIDEWAYS ON A PHONE rather than reflowing. Eleven columns cannot stack into something
 * readable, and a row whose cells wrap into a paragraph is worse than one the reader swipes.
 */
export function DocumentLinesGrid({
  lines,
  onChange,
  onRemove,
  onAdd,
  items,
  onItemChosen,
  currencyCode,
  costIsEditable,
  warnOnOverdraw,
  readOnly,
}: DocumentLinesGridProps) {
  const itemOptions = items.map((i) => ({ value: String(i.id), label: `${i.itemCode} — ${i.itemName}` }))

  /**
   * Enter in a quantity moves to the next row's item.
   *
   * That is the rhythm of typing a document from a paper note: item, quantity, next item. Without it
   * the reader tabs through five cells to get back to where they were going.
   */
  function jumpToNextRow(index: number) {
    const next = document.querySelector<HTMLInputElement>(`[data-line-item="${index + 1}"] input`)
    next?.focus()
  }

  const total = (line: EditableLine) => line.quantity * line.unitCost

  return (
    <Table.ScrollContainer minWidth={1050}>
      <Table striped highlightOnHover verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={44}>#</Table.Th>
            <Table.Th w={240}>Item Code</Table.Th>
            <Table.Th w={200}>Item Name</Table.Th>
            <Table.Th w={140}>Unit</Table.Th>
            <Table.Th w={90} ta="right">On Hand</Table.Th>
            <Table.Th w={100} ta="right">Qty</Table.Th>
            <Table.Th w={130} ta="right">Unit Cost</Table.Th>
            <Table.Th w={130} ta="right">Total Cost</Table.Th>
            <Table.Th w={160}>Notes</Table.Th>
            <Table.Th w={84} />
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {lines.map((line, index) => {
            /* THE COMPARISON IS IN BASE UNITS, because that is what the ledger holds: two Boxes of
               twelve is twenty-four pieces, and comparing 2 against an on-hand of 20 would call a
               line fine that the server is about to refuse. */
            const wanted = line.quantity * (line.packingFormula || 1)
            const short = warnOnOverdraw && line.onHandBase !== null && wanted > line.onHandBase

            return (
              <Table.Tr
                key={line.key}
                bg={line.error ? 'var(--mantine-color-red-0)' : undefined}
              >
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    {index + 1}
                    {line.error && (
                      <Tooltip label={line.error} multiline w={280} withArrow>
                        <IconAlertTriangle size={15} color="var(--mantine-color-red-6)" />
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>

                {/* THE CODE IS A LINK TO THE ITEM, in a new tab so the document stays where it is.
                    tabIndex -1 everywhere: the link and its icon are for the mouse, and a reader
                    tabbing item → unit → quantity must not land on them. */}
                <Table.Td data-line-item={index} className="line-item-link">
                  {readOnly ? (
                    line.itemId === null ? (
                      <Text fz="sm" fw={500}>{line.itemCode}</Text>
                    ) : (
                      <ItemLink itemId={line.itemId} code={line.itemCode} />
                    )
                  ) : (
                    <Group gap={4} wrap="nowrap">
                      <Select
                        data={itemOptions}
                        value={line.itemId === null ? null : String(line.itemId)}
                        placeholder="Choose an item"
                        searchable
                        onChange={(next) => {
                          if (!next) return
                          onItemChosen(line.key, Number(next))
                        }}
                        error={Boolean(line.error) && line.itemId === null}
                        comboboxProps={{ withinPortal: true }}
                        style={{ flex: 1 }}
                      />
                      {line.itemId !== null && (
                        <Tooltip label="View item details (new tab)" withArrow>
                          <ActionIcon
                            component="a"
                            href={`/inventory/items/${line.itemId}`}
                            target="_blank"
                            rel="noopener"
                            variant="subtle"
                            size="sm"
                            tabIndex={-1}
                            aria-label={`View item ${line.itemCode}`}
                          >
                            <IconExternalLink size={15} className="line-item-link-icon" />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
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
                      data={line.units.map((u) => ({
                        value: String(u.id),
                        label: unitLabel(u.unitTypeName, u.packingFormula),
                      }))}
                      value={line.itemUnitId === null ? null : String(line.itemUnitId)}
                      placeholder={line.itemId ? 'Unit' : '—'}
                      disabled={line.units.length === 0}
                      onChange={(next) => {
                        const unit = line.units.find((u) => String(u.id) === next)
                        if (!unit) return
                        onChange(line.key, {
                          itemUnitId: unit.id,
                          unitTypeName: unit.unitTypeName,
                          packingFormula: unit.packingFormula,
                        })
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
                      /* Empty while it is being retyped: a cleared box snapped back to 1 would make
                         the next keystroke append ("7" → "71"). 0 is "nothing yet"; the page refuses to
                         save a line at 0. */
                      value={line.quantity > 0 ? line.quantity : ''}
                      min={1}
                      step={1}
                      allowDecimal={false}
                      thousandSeparator=","
                      onChange={(next) => onChange(line.key, { quantity: numberInputValue(next) ?? 0 })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          jumpToNextRow(index)
                        }
                      }}
                      error={short}
                    />
                  )}
                </Table.Td>

                <Table.Td data-line-cost={line.key}>
                  {readOnly || !costIsEditable ? (
                    <Tooltip
                      label="Average cost is applied automatically"
                      // Said in every mode on an Out: a posted Out's cost is still the average, not a typed figure.
                      disabled={costIsEditable}
                      withArrow
                    >
                      <Text fz="sm" ta="right" c={costIsEditable ? undefined : 'dimmed'}>
                        {formatNumber(line.unitCost, 2)}
                      </Text>
                    </Tooltip>
                  ) : (
                    <NumberInput
                      value={line.unitCost}
                      min={0}
                      decimalScale={2}
                      fixedDecimalScale
                      thousandSeparator=","
                      // Parsed, not type-checked: with fixedDecimalScale the value arrives as "2,150.00".
                      onChange={(next) => onChange(line.key, { unitCost: numberInputValue(next) ?? 0 })}
                    />
                  )}
                </Table.Td>

                <Table.Td ta="right">
                  <Text fz="sm" fw={500}>{money(total(line), currencyCode)}</Text>
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
                    {/* The row menu: what can be done with the line beyond editing it. */}
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
              <Table.Td colSpan={10}>
                <Text ta="center" c="dimmed" py="lg">
                  No lines yet. Scan an item above, or add one below.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}

          {/* The row that is also a button. A grid whose only way to grow is a toolbar button above
              it makes people hunt upwards after every line they finish. */}
          {!readOnly && (
            <Table.Tr style={{ cursor: 'pointer' }} onClick={onAdd}>
              <Table.Td colSpan={10}>
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

/** The item code as a link to Item Definition, in a new tab, with the icon appearing on hover. */
function ItemLink({ itemId, code }: { itemId: number; code: string }) {
  return (
    <Anchor
      component={Link}
      to={`/inventory/items/${itemId}`}
      target="_blank"
      rel="noopener"
      fz="sm"
      fw={500}
      tabIndex={-1}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      {code}
      <IconExternalLink size={14} className="line-item-link-icon" />
    </Anchor>
  )
}
