import { ActionIcon, Group, NumberInput, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconTrash } from '@tabler/icons-react'
import type { ImportPriceSource } from '../../api/sales/invoiceImport'
import { unitLabel } from '../documents/documentKind'
import { formatMoney, formatNumber, numberInputValue } from '../format'
import { lineTotal } from './salesLines'

/**
 * One line of a sales import while it sits on the page.
 *
 * EVERY REFERENCE IS RESOLVED, unlike the stock grid's editable line: these rows only ever arrive
 * from the wizard, which cannot hand back a row whose item, unit and warehouse the server did not
 * find. What the reader edits here is the quantity, the discount, the notes and — with the
 * permission — the price.
 */
export interface SalesLine {
  /** Stable across re-renders and re-imports; not the Excel row, which repeats when a file is imported twice. */
  key: string
  itemId: number
  itemCode: string
  itemName: string
  itemUnitId: number
  unitTypeName: string
  packingFormula: number
  warehouseId: number
  warehouseCode: string
  expiryDate: string | null
  quantity: number
  /** Null only when the file had no price and the list had none either — the server refuses such a line. */
  unitPrice: number | null
  /** Where the price came from; Manual is sent back to the server, a list price is not. */
  priceSource: ImportPriceSource | null
  /** True once the reader typed a price here — from then on it IS a manual price. */
  priceEdited: boolean
  discountPercent: number
  notes: string
  /** The Excel row the line came from, so a later error can point back at the file. */
  importRowNumber: number | null
}

interface SalesLinesGridProps {
  lines: SalesLine[]
  onChange: (key: string, patch: Partial<SalesLine>) => void
  onRemove: (key: string) => void
  /** Stock for a line's item and warehouse: a number, null when it could not be read, undefined while loading. */
  onHandFor: (line: SalesLine) => number | null | undefined
  /** A message per line key — the page's own stock check, or the server's "Line N:" refusal. */
  errors: Record<string, string>
  currencyCode: string
  decimalPlaces: number
  /** Only a holder of sales.invoices.priceoverride may type a price; everybody else reads it. */
  canOverridePrice: boolean
  /** While the posting runs the grid waits. */
  disabled: boolean
}

/**
 * The lines about to be posted, edited in place.
 *
 * A PLAIN TABLE, like the stock document's grid and for the same reason: ten columns, every other
 * cell an input, no paging — a form, not a report. It scrolls sideways on a phone rather than
 * wrapping ten columns into a paragraph.
 *
 * A ROW WITH A PROBLEM IS RED AND SAYS WHY. The problem is either the page's running stock check
 * or the server's refusal; both arrive as a sentence, and the sentence is the tooltip on the row
 * number, where the eye goes first. The Post button stays disabled while any row is red.
 */
export function SalesLinesGrid({
  lines,
  onChange,
  onRemove,
  onHandFor,
  errors,
  currencyCode,
  decimalPlaces,
  canOverridePrice,
  disabled,
}: SalesLinesGridProps) {
  return (
    <Table.ScrollContainer minWidth={1100}>
      <Table striped highlightOnHover verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={56}>#</Table.Th>
            <Table.Th w={260}>Item</Table.Th>
            <Table.Th w={110}>Unit</Table.Th>
            <Table.Th w={120}>Warehouse</Table.Th>
            <Table.Th w={100} ta="right">On Hand</Table.Th>
            <Table.Th w={100} ta="right">Qty</Table.Th>
            <Table.Th w={140} ta="right">Price</Table.Th>
            <Table.Th w={100} ta="right">Disc %</Table.Th>
            <Table.Th w={140} ta="right">Line Total</Table.Th>
            <Table.Th w={180}>Notes</Table.Th>
            <Table.Th w={50} />
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {lines.map((line, index) => {
            const error = errors[line.key]
            const onHand = onHandFor(line)

            return (
              <Table.Tr key={line.key} bg={error ? 'var(--mantine-color-red-0)' : undefined}>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    {index + 1}
                    {error && (
                      <Tooltip label={error} multiline w={300} withArrow>
                        <IconAlertTriangle size={15} color="var(--mantine-color-red-6)" />
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>

                <Table.Td>
                  <Text fz="sm" fw={500}>{line.itemCode}</Text>
                  <Text fz="xs" c="dimmed">{line.itemName}</Text>
                </Table.Td>

                <Table.Td>
                  <Text fz="sm">{unitLabel(line.unitTypeName, line.packingFormula)}</Text>
                </Table.Td>

                <Table.Td>
                  <Text fz="sm">{line.warehouseCode}</Text>
                </Table.Td>

                <Table.Td ta="right">
                  {onHand === undefined ? (
                    <Text fz="sm" c="dimmed">…</Text>
                  ) : onHand === null ? (
                    <Text fz="sm" c="dimmed">—</Text>
                  ) : (
                    <Text fz="sm" fw={error ? 700 : 400} c={error ? 'red' : undefined}>
                      {formatNumber(onHand)}
                    </Text>
                  )}
                </Table.Td>

                <Table.Td>
                  <NumberInput
                    /* EMPTY WHILE IT IS BEING RETYPED. Snapping a cleared box back to 1 makes the next
                       keystroke append to it ("7" becomes "71"); 0 means "nothing yet", the box shows
                       nothing, and the page refuses to post a line at 0. */
                    value={line.quantity > 0 ? line.quantity : ''}
                    min={1}
                    step={1}
                    allowDecimal={false}
                    allowNegative={false}
                    thousandSeparator=","
                    onChange={(next) => onChange(line.key, { quantity: numberInputValue(next) ?? 0 })}
                    error={Boolean(error)}
                    disabled={disabled}
                    aria-label={`Quantity of line ${index + 1}`}
                  />
                </Table.Td>

                <Table.Td>
                  {canOverridePrice ? (
                    <NumberInput
                      value={line.unitPrice ?? ''}
                      min={0}
                      decimalScale={decimalPlaces}
                      fixedDecimalScale
                      thousandSeparator=","
                      onChange={(next) =>
                        onChange(line.key, { unitPrice: numberInputValue(next), priceEdited: true })
                      }
                      disabled={disabled}
                      aria-label={`Price of line ${index + 1}`}
                    />
                  ) : (
                    <Tooltip label="Prices come from the price list (no price override permission)" withArrow>
                      <Text fz="sm" ta="right" c="dimmed">
                        {line.unitPrice === null ? '—' : formatNumber(line.unitPrice, decimalPlaces)}
                      </Text>
                    </Tooltip>
                  )}
                </Table.Td>

                <Table.Td>
                  <NumberInput
                    value={line.discountPercent}
                    min={0}
                    max={100}
                    decimalScale={2}
                    allowNegative={false}
                    clampBehavior="strict"
                    onChange={(next) => onChange(line.key, { discountPercent: numberInputValue(next) ?? 0 })}
                    disabled={disabled}
                    aria-label={`Discount of line ${index + 1}`}
                  />
                </Table.Td>

                <Table.Td ta="right">
                  <Text fz="sm" fw={500}>{formatMoney(lineTotal(line), currencyCode, decimalPlaces)}</Text>
                </Table.Td>

                <Table.Td>
                  <TextInput
                    value={line.notes}
                    placeholder="Optional"
                    maxLength={300}
                    onChange={(event) => onChange(line.key, { notes: event.currentTarget.value })}
                    disabled={disabled}
                  />
                </Table.Td>

                <Table.Td>
                  <Tooltip label="Remove line" withArrow>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => onRemove(line.key)}
                      disabled={disabled}
                      aria-label={`Remove line ${index + 1}`}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            )
          })}

          {lines.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={11}>
                <Text ta="center" c="dimmed" py="lg">
                  No lines yet. Fill in the header and press “Import from Excel”.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
