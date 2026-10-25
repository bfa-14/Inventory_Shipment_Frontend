import { useMemo } from 'react'
import {
  ActionIcon,
  Anchor,
  Box,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconAlertTriangle, IconTrash } from '@tabler/icons-react'
import { Link } from 'react-router'
import type { ItemLookupDto } from '../../api/types'
import { unitLabel } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import {
  availabilityTooltip,
  orderedBaseOf,
  toDispatchOf,
  type TransferLineForm,
  type TransferTotals,
} from './transferModel'

interface TransferLinesGridProps {
  lines: TransferLineForm[]
  /** A draft the reader may change: item, unit, Ordered and Notes are typed, lines added and removed. */
  editable: boolean
  /** The code of From and of To, for the column titles ("Available at LKS-01"); null while not chosen. */
  fromCode: string | null
  toCode: string | null
  /** The items a line may take (active items); a line's own item stays an option on its own line. */
  items: ItemLookupDto[]
  onChange(key: string, patch: Partial<TransferLineForm>): void
  onRemove(key: string): void
  onAdd(): void
  /** An item picked on a line: the page fetches its units and its availability. */
  onItemChosen(key: string, itemId: number): void
  /**
   * A released order and a reader who may dispatch: a checkbox on each line with something to dispatch, the Dispatch
   * dialog's preselection. Off otherwise.
   */
  selectable: boolean
  selected: Set<number>
  onToggle(lineId: number, checked: boolean): void
  /** The totals row (rule T11): Ordered, Dispatched, Received, On the way, Not sent, Lost - all in pcs. */
  totals: TransferTotals
}

/** "= 24 pcs", dimmed under Ordered when the line's unit is not the base unit. */
function inPieces(line: TransferLineForm) {
  if ((line.packingFormula || 1) === 1) return null
  return (
    <Text fz="xs" c="dimmed" ta="right" style={{ whiteSpace: 'nowrap' }}>
      = {formatNumber(orderedBaseOf(line))} pcs
    </Text>
  )
}

/**
 * The lines of a transfer order (2.6.3): what moves, in which unit, how much has left and arrived.
 *
 * ORDERED IS THE LINE'S UNIT, EVERYTHING ELSE IS PIECES (rule T11). "2 BOX" is what was asked for; Dispatched, Received
 * and To dispatch - and the totals row - are what the stock counts. On the way is never a column: a line's goods on the
 * way belong to its dispatches (the "Dispatches and receipts" card); the totals row says the order's.
 *
 * WHERE THE ITEM STANDS, beside each line: Available at From (on hand less what the other released orders still take
 * from it; red below what the line still has to dispatch), and the stock at To. Information only: releasing an order
 * reserves nothing (rule T14).
 *
 * A PLAIN TABLE, like every document's lines (DocumentLinesGrid): a form, not a reading grid. Below 48em one card per
 * line.
 */
export function TransferLinesGrid({
  lines,
  editable,
  fromCode,
  toCode,
  items,
  onChange,
  onRemove,
  onAdd,
  onItemChosen,
  selectable,
  selected,
  onToggle,
  totals,
}: TransferLinesGridProps) {
  const phone = useMediaQuery('(max-width: 48em)')

  /* THE OPTIONS ARE BUILT ONCE PER LIST: the whole catalogue, and a new array on every keystroke would make each row's
     Select parse it again. A line's own item, missing from the list (made inactive since), stays an option on its own
     line only, first. */
  const itemOptions = useMemo(
    () => items.map((i) => ({ value: String(i.id), label: `${i.itemCode} — ${i.itemName}` })),
    [items],
  )
  const listed = useMemo(() => new Set(items.map((i) => i.id)), [items])
  const optionsFor = (line: TransferLineForm) =>
    line.itemId !== null && !listed.has(line.itemId)
      ? [{ value: String(line.itemId), label: `${line.itemCode} — ${line.itemName}` }, ...itemOptions]
      : itemOptions

  const availableTitle = `Available at ${fromCode ?? 'From'}`
  const stockTitle = `Stock at ${toCode ?? 'To'}`

  /** Enter in Ordered goes to the next line's item: item, quantity, next item. */
  function jumpToNextRow(index: number) {
    document.querySelector<HTMLInputElement>(`[data-transfer-line-item="${index + 1}"] input`)?.focus()
  }

  function itemControl(line: TransferLineForm, index: number) {
    if (!editable) {
      return line.itemId === null ? (
        <Text fz="sm" fw={500}>
          {line.itemCode}
        </Text>
      ) : (
        <Anchor
          component={Link}
          to={`/inventory/items/${line.itemId}`}
          target="_blank"
          rel="noopener"
          fz="sm"
          fw={500}
          tabIndex={-1}
        >
          {line.itemCode}
        </Anchor>
      )
    }
    return (
      <Box data-transfer-line-item={index}>
        <Select
          aria-label={`Item, line ${index + 1}`}
          data={optionsFor(line)}
          value={line.itemId === null ? null : String(line.itemId)}
          placeholder="Choose an item"
          searchable
          limit={100}
          onChange={(next) => {
            if (next) onItemChosen(line.key, Number(next))
          }}
          error={Boolean(line.error) && line.itemId === null}
          comboboxProps={{ withinPortal: true }}
        />
      </Box>
    )
  }

  function unitControl(line: TransferLineForm, index: number) {
    if (!editable) return <Text fz="sm">{unitLabel(line.unitName, line.packingFormula)}</Text>
    return (
      <Select
        aria-label={`Unit, line ${index + 1}`}
        data={line.units.map((u) => ({ value: String(u.id), label: unitLabel(u.unitTypeName, u.packingFormula) }))}
        value={line.itemUnitId === null ? null : String(line.itemUnitId)}
        placeholder={line.itemId ? 'Unit' : '—'}
        disabled={line.units.length === 0}
        onChange={(next) => {
          const unit = line.units.find((u) => String(u.id) === next)
          if (unit)
            onChange(line.key, {
              itemUnitId: unit.id,
              unitName: unit.unitTypeName,
              packingFormula: unit.packingFormula || 1,
            })
        }}
        comboboxProps={{ withinPortal: true }}
      />
    )
  }

  function orderedControl(line: TransferLineForm, index: number) {
    if (!editable) {
      return (
        <>
          <Text fz="sm" ta="right">
            {formatNumber(line.quantity)}
          </Text>
          {inPieces(line)}
        </>
      )
    }
    return (
      <Box data-transfer-line-qty={line.key}>
        <NumberInput
          aria-label={`Ordered, line ${index + 1}`}
          // Empty while retyped: a cleared box snapped back to 1 would make the next key append ("7" -> "71").
          value={line.quantity > 0 ? line.quantity : ''}
          min={1}
          step={1}
          allowDecimal={false}
          allowNegative={false}
          thousandSeparator=","
          onChange={(next) => onChange(line.key, { quantity: Math.trunc(numberInputValue(next) ?? 0) })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              jumpToNextRow(index)
            }
          }}
          error={Boolean(line.error) && line.quantity < 1}
        />
        {inPieces(line)}
      </Box>
    )
  }

  /** Available at From: red when below what the line still has to dispatch; who else takes some, on hover. */
  function availableCell(line: TransferLineForm) {
    if (line.availableFromBase === null)
      return (
        <Text fz="sm" c="dimmed">
          —
        </Text>
      )
    const short = line.availableFromBase < toDispatchOf(line)
    const tooltip = availabilityTooltip(line)
    const text = (
      <Text
        fz="sm"
        fw={short ? 700 : 400}
        c={short ? 'red' : undefined}
        ta="right"
        data-transfer-available-short={short || undefined}
      >
        {formatNumber(line.availableFromBase)}
      </Text>
    )
    return tooltip ? (
      <Tooltip label={tooltip} withArrow>
        {text}
      </Tooltip>
    ) : (
      text
    )
  }

  function stockCell(line: TransferLineForm) {
    if (line.onHandToBase === null)
      return (
        <Text fz="sm" c="dimmed">
          —
        </Text>
      )
    return (
      <Text fz="sm" ta="right">
        {formatNumber(line.onHandToBase)}
      </Text>
    )
  }

  function notesControl(line: TransferLineForm, index: number) {
    if (!editable)
      return (
        <Text fz="sm" c="dimmed">
          {line.notes || '—'}
        </Text>
      )
    return (
      <TextInput
        aria-label={`Notes, line ${index + 1}`}
        value={line.notes}
        placeholder="Optional"
        maxLength={300}
        onChange={(event) => onChange(line.key, { notes: event.currentTarget.value })}
      />
    )
  }

  function tickControl(line: TransferLineForm) {
    if (!selectable || line.id === null || toDispatchOf(line) <= 0) return null
    const id = line.id
    return (
      <Checkbox
        aria-label={`Dispatch line ${line.lineNumber || ''}`.trim()}
        checked={selected.has(id)}
        onChange={(event) => onToggle(id, event.currentTarget.checked)}
      />
    )
  }

  function errorMark(line: TransferLineForm) {
    if (!line.error) return null
    return (
      <Tooltip label={line.error} multiline w={280} withArrow>
        <IconAlertTriangle size={15} color="var(--mantine-color-red-6)" />
      </Tooltip>
    )
  }

  const totalsRow = (
    <Paper withBorder radius="md" p="sm" mt="sm" bg="var(--mantine-color-gray-0)" data-transfer-totals>
      <SimpleGrid cols={{ base: 2, xs: 3, md: 6 }} spacing="xs">
        {(
          [
            ['Ordered (pcs)', totals.orderedBase],
            ['Dispatched', totals.dispatchedBase],
            ['Received', totals.receivedBase],
            ['On the way', totals.onTheWayBase],
            ['Not sent', totals.notSentBase],
            ['Lost', totals.lostBase],
          ] as const
        ).map(([label, value]) => (
          <Box key={label}>
            <Text fz="xs" c="dimmed">
              {label}
            </Text>
            <Text fz="sm" fw={600}>
              {formatNumber(value)}
            </Text>
          </Box>
        ))}
      </SimpleGrid>
    </Paper>
  )

  if (phone) {
    return (
      <Stack gap="sm">
        {lines.map((line, index) => (
          <Paper
            key={line.key}
            withBorder
            radius="md"
            p="sm"
            bg={line.error ? 'var(--mantine-color-red-0)' : undefined}
          >
            <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
              <Group gap={6} wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
                {tickControl(line)}
                <Box style={{ minWidth: 0 }}>
                  {/* "TVS-APACHE-160 · 84 PC · 40 dispatched · 30 received · 44 to dispatch" */}
                  <Text fz="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
                    {[
                      line.itemCode || `Line ${index + 1}`,
                      `${formatNumber(line.quantity)} ${line.unitName}`.trim(),
                      `${formatNumber(line.dispatchedBase)} dispatched`,
                      `${formatNumber(line.receivedBase)} received`,
                      `${formatNumber(toDispatchOf(line))} to dispatch`,
                    ].join(' · ')}
                  </Text>
                  {line.itemName ? (
                    <Text fz="xs" c="dimmed">
                      {line.itemName}
                    </Text>
                  ) : null}
                </Box>
              </Group>
              <Group gap={2} wrap="nowrap">
                {errorMark(line)}
                {editable && (
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => onRemove(line.key)}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                )}
              </Group>
            </Group>
            {line.error ? (
              <Text fz="xs" c="red" mt={4}>
                {line.error}
              </Text>
            ) : null}
            <SimpleGrid cols={2} spacing="xs" mt="xs">
              <Box>
                <Text fz="xs" c="dimmed">
                  {availableTitle}
                </Text>
                <Box style={{ textAlign: 'left' }}>{availableCell(line)}</Box>
              </Box>
              <Box>
                <Text fz="xs" c="dimmed">
                  {stockTitle}
                </Text>
                {stockCell(line)}
              </Box>
            </SimpleGrid>
            {editable && (
              <Stack gap="xs" mt="xs">
                {itemControl(line, index)}
                <SimpleGrid cols={2} spacing="xs">
                  {unitControl(line, index)}
                  {orderedControl(line, index)}
                </SimpleGrid>
                {notesControl(line, index)}
              </Stack>
            )}
            {!editable && line.notes ? (
              <Text fz="xs" c="dimmed" mt={4}>
                {line.notes}
              </Text>
            ) : null}
          </Paper>
        ))}
        {lines.length === 0 && (
          <Text ta="center" c="dimmed" py="md" fz="sm">
            {editable ? 'No lines yet. Scan an item above, or add one below.' : 'No lines.'}
          </Text>
        )}
        {editable && (
          <Anchor component="button" type="button" fz="sm" onClick={onAdd} ta="left">
            + Add line
          </Anchor>
        )}
        {totalsRow}
      </Stack>
    )
  }

  const columnCount = 11 + (selectable ? 1 : 0) + (editable ? 1 : 0)

  return (
    <>
      <Table.ScrollContainer minWidth={editable ? 1280 : 1100}>
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              {selectable && <Table.Th w={36} />}
              <Table.Th w={52}>#</Table.Th>
              <Table.Th w={editable ? 240 : 150}>Item Code</Table.Th>
              <Table.Th>Item Name</Table.Th>
              <Table.Th w={editable ? 150 : 110}>Unit</Table.Th>
              <Table.Th w={130} ta="right">
                {availableTitle}
              </Table.Th>
              <Table.Th w={120} ta="right">
                {stockTitle}
              </Table.Th>
              <Table.Th w={editable ? 120 : 95} ta="right">
                Ordered
              </Table.Th>
              <Table.Th w={95} ta="right">
                Dispatched
              </Table.Th>
              <Table.Th w={90} ta="right">
                Received
              </Table.Th>
              <Table.Th w={100} ta="right">
                To dispatch
              </Table.Th>
              <Table.Th w={editable ? 180 : 160}>Notes</Table.Th>
              {editable && <Table.Th w={44} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((line, index) => (
              <Table.Tr
                key={line.key}
                bg={line.error ? 'var(--mantine-color-red-0)' : undefined}
                data-transfer-line={index + 1}
              >
                {selectable && <Table.Td>{tickControl(line)}</Table.Td>}
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    {formatNumber(index + 1)}
                    {errorMark(line)}
                  </Group>
                </Table.Td>
                <Table.Td>{itemControl(line, index)}</Table.Td>
                <Table.Td>
                  <Text fz="sm" c="dimmed">
                    {line.itemName || '—'}
                  </Text>
                </Table.Td>
                <Table.Td>{unitControl(line, index)}</Table.Td>
                <Table.Td ta="right">{availableCell(line)}</Table.Td>
                <Table.Td ta="right">{stockCell(line)}</Table.Td>
                <Table.Td>{orderedControl(line, index)}</Table.Td>
                <Table.Td ta="right">{formatNumber(line.dispatchedBase)}</Table.Td>
                <Table.Td ta="right">{formatNumber(line.receivedBase)}</Table.Td>
                <Table.Td ta="right">
                  <Text fz="sm" fw={600}>
                    {formatNumber(toDispatchOf(line))}
                  </Text>
                </Table.Td>
                <Table.Td>{notesControl(line, index)}</Table.Td>
                {editable && (
                  <Table.Td>
                    <Tooltip label="Remove line" withArrow>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() => onRemove(line.key)}
                        aria-label={`Remove line ${index + 1}`}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}

            {lines.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={columnCount}>
                  <Text ta="center" c="dimmed" py="lg" fz="sm">
                    {editable ? 'No lines yet. Scan an item above, or add one below.' : 'No lines.'}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}

            {/* The row that is also a button: a grid whose only way to grow is a button above it sends the reader
                hunting upwards after every line. */}
            {editable && (
              <Table.Tr style={{ cursor: 'pointer' }} onClick={onAdd} data-transfer-add-line>
                <Table.Td colSpan={columnCount}>
                  <Text c="dimmed" fz="sm">
                    + Add line
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {totalsRow}
    </>
  )
}
