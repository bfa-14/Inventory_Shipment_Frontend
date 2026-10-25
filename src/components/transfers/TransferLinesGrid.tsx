import { useMemo, type ReactNode } from 'react'
import {
  ActionIcon,
  Anchor,
  Box,
  Checkbox,
  Group,
  NumberInput,
  Paper,
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
import { LazySelect } from '../ui/LazySelect'
import { ShownRowsFooter } from '../ui/ShownRows'
import { useShownRows } from '../ui/useShownRows'
import {
  belowMinText,
  fromBelowMinText,
  levelsPhoneLine,
  minMaxHint,
  projectedHint,
  shortText,
} from './transferLevels'
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
  /**
   * (91) Min, Max and Projected at {To} (transferLevels.ts `showsLevels`): a draft, an order waiting for approval, a
   * released one not yet Received or Closed. The lines carry the figures (the server's, or a draft's own sum).
   */
  showLevels: boolean
}

/* A ROW'S TOOLTIP DRAWS NO PORTAL (frontend-conventions, "Lists of any length"): a 200-line import mounts one per row. */
const ROW_TOOLTIP = { withinPortal: false, floatingStrategy: 'fixed' } as const

/* (91) THE LEVEL COLUMNS' SIDE PADDING (Min, Max, Projected): short right-aligned figures need less than the table's 10 px,
   and the 24 px it gives back keeps a read order's columns on a 1440 screen with Item Name at its 130 px. */
const LEVEL_PX = 6

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
 *
 * LISTS OF ANY LENGTH (an import of 200 lines): Item and Unit are LazySelects (an input until reached, then the real
 * Select), a row's tooltips draw no portal, and the lines are DRAWN in steps of 200 ("Show more") - every line stays in
 * the order (totals, Save), and a new line or one with a problem always shows.
 *
 * (91) TO'S STOCK LEVEL, while the order still moves something (`showLevels`): Min and Max of To ("—" without a level)
 * and "Projected at {To}" AFTER this order. A line To stays below its Min with is red (the row tinted, Projected bold
 * red, rule L19); "Available at {From}" is orange when From goes below its own Min with this order - unless it is red
 * already (below what the line still has to dispatch): red wins, and both reasons are joined (tooltip, phone line).
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
  showLevels,
}: TransferLinesGridProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const shown = useShownRows(lines.length)
  const visible = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index < shown.limit || line.id === null || Boolean(line.error))

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

  /** A phone card's control under its own word (dimmed, like the card's figures). */
  const labelled = (label: string, control: ReactNode) => (
    <Box>
      <Text fz="xs" c="dimmed">
        {label}
      </Text>
      {control}
    </Box>
  )

  const availableTitle = `Available at ${fromCode ?? 'From'}`
  const stockTitle = `Stock at ${toCode ?? 'To'}`
  const fromName = fromCode ?? 'From'
  const toName = toCode ?? 'To'
  const projectedTitle = `Projected at ${toName}`
  /** (91) Red: To stays below its Min with this order (only while the columns show). */
  const belowMin = (line: TransferLineForm) => showLevels && line.isBelowMin
  /** (91) Orange: From goes below its own Min with this order (only while the columns show). */
  const fromLow = (line: TransferLineForm) => showLevels && line.fromBelowMinAfter

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
          // The code may break after a hyphen, as in 90: kept on one line it widened a read order past a 1440 screen
          // once the level columns show (a 15-character code made a released order scroll sideways).
        >
          {line.itemCode}
        </Anchor>
      )
    }
    return (
      <Box data-transfer-line-item={index}>
        <LazySelect
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
      <LazySelect
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

  /**
   * (91) Why "Available at {From}" is orange - From goes below its own Min with this order - and, when it is red as well
   * (red wins), the red reason first: both said together. Null when it is not orange.
   */
  function fromLowReason(line: TransferLineForm): string | null {
    if (!fromLow(line)) return null
    const orange = fromBelowMinText(fromName, line.fromAfterBase, line.fromMinBase)
    const toDispatch = toDispatchOf(line)
    return line.availableFromBase !== null && line.availableFromBase < toDispatch
      ? `${shortText(fromName, line.availableFromBase, toDispatch)} ${orange}`
      : orange
  }

  /**
   * Available at From: red when below what the line still has to dispatch; (91) else orange when From goes below its
   * own Min with this order; who else takes some, on hover.
   */
  function availableCell(line: TransferLineForm) {
    if (line.availableFromBase === null)
      return (
        <Text fz="sm" c="dimmed">
          —
        </Text>
      )
    const short = line.availableFromBase < toDispatchOf(line)
    const low = !short && fromLow(line)
    // The reasons first (red, orange), then who else takes some: one tooltip.
    const reasons = phone ? null : fromLowReason(line)
    const committed = availabilityTooltip(line)
    const tooltip = [reasons, committed].filter((part): part is string => Boolean(part)).join(' · ') || null
    const text = (
      <Text
        fz="sm"
        fw={short || low ? 700 : 400}
        c={short ? 'red' : low ? 'orange.7' : undefined}
        // A phone card reads it under its label, left; the table's figures stand right.
        ta={phone ? undefined : 'right'}
        data-transfer-available-short={short || undefined}
        data-transfer-available-low={fromLow(line) || undefined}
      >
        {formatNumber(line.availableFromBase)}
      </Text>
    )
    // A phone has no hover: "{n} on hand · {c} promised to other orders" is a line under the figure there.
    if (phone)
      return (
        <>
          {text}
          {tooltip ? (
            <Text fz="xs" c="dimmed">
              {tooltip}
            </Text>
          ) : null}
        </>
      )
    return tooltip ? (
      <Tooltip {...ROW_TOOLTIP} label={tooltip} withArrow multiline={Boolean(reasons)} w={reasons ? 300 : undefined}>
        {text}
      </Tooltip>
    ) : (
      text
    )
  }

  /** (91) To's Min or Max: "—" without a level (a level without a Max: "—" too). */
  function levelCell(line: TransferLineForm, value: number | null) {
    if (!line.toHasLevel || value === null)
      return (
        <Text fz="sm" c="dimmed" ta="right">
          —
        </Text>
      )
    return (
      <Text fz="sm" ta="right">
        {formatNumber(value)}
      </Text>
    )
  }

  /** (91) Projected at To AFTER this order: bold red, with the reason on hover, while To stays below its Min. */
  function projectedCell(line: TransferLineForm) {
    if (line.toProjectedAfterBase === null)
      return (
        <Text fz="sm" c="dimmed" ta="right">
          —
        </Text>
      )
    const red = belowMin(line)
    const text = (
      <Text
        fz="sm"
        ta="right"
        fw={red ? 700 : 400}
        c={red ? 'red' : undefined}
        data-transfer-projected-below={red || undefined}
      >
        {formatNumber(line.toProjectedAfterBase)}
      </Text>
    )
    return red ? (
      <Tooltip {...ROW_TOOLTIP} label={belowMinText(toName, line.toMinBase)} withArrow>
        {text}
      </Tooltip>
    ) : (
      text
    )
  }

  /** (91) The phone card's levels: "Min 20 · Max 60 · Projected 60 at LUB-01", red when below, the reasons dimmed. */
  function phoneLevels(line: TransferLineForm) {
    if (!showLevels || line.itemId === null) return null
    const red = belowMin(line)
    const fromReason = fromLowReason(line)
    return (
      <Box mt="xs" data-transfer-line-levels>
        <Text fz="sm" c={red ? 'red' : undefined} fw={red ? 600 : undefined}>
          {levelsPhoneLine(line, toName)}
        </Text>
        {red ? (
          <Text fz="xs" c="dimmed">
            {belowMinText(toName, line.toMinBase)}
          </Text>
        ) : null}
        {fromReason ? (
          <Text fz="xs" c="dimmed">
            {fromReason}
          </Text>
        ) : null}
      </Box>
    )
  }

  /** The row's tint: a refusal's red first, else (91) red while To stays below its Min with this order. */
  function rowTint(line: TransferLineForm): string | undefined {
    if (line.error) return 'var(--mantine-color-red-0)'
    return belowMin(line) ? 'var(--mantine-color-red-light)' : undefined
  }

  function stockCell(line: TransferLineForm) {
    if (line.onHandToBase === null)
      return (
        <Text fz="sm" c="dimmed">
          —
        </Text>
      )
    return (
      <Text fz="sm" ta={phone ? undefined : 'right'}>
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
      <Tooltip {...ROW_TOOLTIP} label={line.error} multiline w={280} withArrow>
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
        {visible.map(({ line, index }) => (
          <Paper key={line.key} withBorder radius="md" p="sm" bg={rowTint(line)}>
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
                {availableCell(line)}
              </Box>
              <Box>
                <Text fz="xs" c="dimmed">
                  {stockTitle}
                </Text>
                {stockCell(line)}
              </Box>
            </SimpleGrid>
            {phoneLevels(line)}
            {editable && (
              <Stack gap="xs" mt="xs">
                {/* Each control under its own word, as the figures above it: a box that says only "Optional" or
                    "Unit" told nothing on a phone. */}
                {labelled('Item', itemControl(line, index))}
                <SimpleGrid cols={2} spacing="xs">
                  {labelled('Unit', unitControl(line, index))}
                  {labelled('Ordered', orderedControl(line, index))}
                </SimpleGrid>
                {labelled('Notes', notesControl(line, index))}
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
        <ShownRowsFooter limit={shown.limit} total={lines.length} noun="lines" more={shown.more} all={shown.all} />
        {editable && (
          <Anchor component="button" type="button" fz="sm" onClick={onAdd} ta="left">
            + Add line
          </Anchor>
        )}
        {totalsRow}
      </Stack>
    )
  }

  const columnCount = 11 + (showLevels ? 3 : 0) + (selectable ? 1 : 0) + (editable ? 1 : 0)
  /* (91) THREE MORE COLUMNS while the levels show. A draft's form already scrolls inside its card: it gets their room.
     Read, the columns still fit a 1440 screen: the widths below are hints the table narrows (headers wrap), and it
     scrolls only below that. Item Name keeps its 130 px whatever shows (script 90's rule: never squeezed to a word a
     line); the figure columns and Notes give up their room first, and the three level columns pad 6 px a side instead
     of 10 (LEVEL_PX: 24 px back, what a released order's tick column takes at 1440). A long item code breaks after a
     hyphen rather than widen the table; long warehouse codes in the headers can still make it scroll a little: Item
     Name is not squeezed for them. */
  const minWidth = editable ? 1330 + (showLevels ? 230 : 0) : showLevels ? 1120 : 1100
  const levelHeader = (title: string, hint: string, width: number) => (
    <Table.Th w={width} ta="right" px={LEVEL_PX}>
      <Tooltip label={hint} multiline w={260} withArrow>
        <span>{title}</span>
      </Tooltip>
    </Table.Th>
  )

  return (
    <>
      {/* THE COLUMNS FIT A 1440 SCREEN WHEN READ (a draft's selects need more and scroll): fixed widths, and Item Name
          takes what is left without being squeezed to a word a line. */}
      <Table.ScrollContainer minWidth={minWidth}>
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              {selectable && <Table.Th w={36} />}
              <Table.Th w={52}>#</Table.Th>
              <Table.Th w={editable ? 220 : 130}>Item Code</Table.Th>
              <Table.Th miw={130}>Item Name</Table.Th>
              <Table.Th w={editable ? 130 : 100}>Unit</Table.Th>
              <Table.Th w={115} ta="right">
                {availableTitle}
              </Table.Th>
              <Table.Th w={105} ta="right">
                {stockTitle}
              </Table.Th>
              {showLevels && levelHeader('Min', minMaxHint(toName), 66)}
              {showLevels && levelHeader('Max', minMaxHint(toName), 66)}
              {showLevels && levelHeader(projectedTitle, projectedHint(toName), 98)}
              <Table.Th w={editable ? 110 : 90} ta="right">
                Ordered
              </Table.Th>
              <Table.Th w={90} ta="right">
                Dispatched
              </Table.Th>
              <Table.Th w={85} ta="right">
                Received
              </Table.Th>
              <Table.Th w={90} ta="right">
                To dispatch
              </Table.Th>
              <Table.Th w={editable ? 160 : 130}>Notes</Table.Th>
              {editable && <Table.Th w={44} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visible.map(({ line, index }) => (
              <Table.Tr
                key={line.key}
                bg={rowTint(line)}
                data-transfer-line={index + 1}
                data-transfer-line-below-min={belowMin(line) || undefined}
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
                {showLevels && (
                  <Table.Td ta="right" px={LEVEL_PX}>
                    {levelCell(line, line.toMinBase)}
                  </Table.Td>
                )}
                {showLevels && (
                  <Table.Td ta="right" px={LEVEL_PX}>
                    {levelCell(line, line.toMaxBase)}
                  </Table.Td>
                )}
                {showLevels && (
                  <Table.Td ta="right" px={LEVEL_PX}>
                    {projectedCell(line)}
                  </Table.Td>
                )}
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
                    <Tooltip {...ROW_TOOLTIP} label="Remove line" withArrow>
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
      <ShownRowsFooter limit={shown.limit} total={lines.length} noun="lines" more={shown.more} all={shown.all} />
      {totalsRow}
    </>
  )
}
