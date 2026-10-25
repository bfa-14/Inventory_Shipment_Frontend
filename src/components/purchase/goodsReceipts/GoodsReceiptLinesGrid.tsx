import { useMemo, type ReactNode } from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
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
import {
  COST_SOURCE_LABELS,
  VARIANCE_REASONS,
  varianceReasonLabel,
  type GoodsReceiptSourceKind,
  type VarianceReasonCode,
} from '../../../api/purchase/goodsReceipts'
import type { ItemLookupDto } from '../../../api/types'
import { unitLabel } from '../../documents/documentKind'
import { formatNumber, numberInputValue } from '../../format'
import {
  costSourceOf,
  differenceOf,
  lineValueOf,
  receivedBaseOf,
  unitCostOf,
  type GoodsReceiptLineForm,
  type WarehouseGroup,
} from './goodsReceiptModel'
import { notYoursNote } from '../../documents/lineWarehouses'

interface GoodsReceiptLinesGridProps {
  lines: GoodsReceiptLineForm[]
  sourceKind: GoodsReceiptSourceKind
  /** A draft the reader may change. */
  editable: boolean
  /** Posted (or cancelled): the figures are the server's. */
  posted: boolean
  onChange(key: string, patch: Partial<GoodsReceiptLineForm>): void
  onRemove(key: string): void
  onAdd(): void
  /** A receipt without an order: the item picked on a line (the page fetches its units and last cost). */
  onItemChosen(key: string, itemId: number): void
  /** The items a typed line may hold (receipts without an order). */
  items: ItemLookupDto[]
  warehouseData: WarehouseGroup[]
  currencyCode: string
}

const REASON_DATA = VARIANCE_REASONS.map((r) => ({ value: r.value, label: r.label }))

/**
 * The lines of a goods receipt: what was expected, what was received, why they differ, and what it is worth.
 *
 * THE SOURCE DECIDES WHAT MAY CHANGE. A container's lines are its load lines: nothing is added or removed, the received
 * pieces go from 0 to the loaded quantity, and a reason is required when they differ. An order's or an invoice's lines
 * take a warehouse each and "Nothing more will come", and can be left out of the draft (their pieces stay to receive).
 * Only a receipt without an order adds lines ("+ Add line") and types its unit cost.
 *
 * A TABLE ON A SCREEN, CARDS ON A PHONE. At 390 px each line shows Item, Expected, Received and Reason first; the cost
 * figures drop below them, because the warehouse counts pieces and only then looks at money.
 */
export function GoodsReceiptLinesGrid({
  lines,
  sourceKind,
  editable,
  posted,
  onChange,
  onRemove,
  onAdd,
  onItemChosen,
  items,
  warehouseData,
  currencyCode,
}: GoodsReceiptLinesGridProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  const manualReceipt = sourceKind === 'Manual'
  const showWarehouse = sourceKind !== 'Container'
  const showExpected = !manualReceipt || lines.some((l) => l.expectedQuantityBase !== null)
  const showCloseShort = lines.some((l) => l.kind !== 'container' && l.poLineId !== null)
  const removable = editable && sourceKind !== 'Container'

  /* The options are built once per list, not on every render: the list is the whole catalogue. */
  const itemOptions = useMemo(() => items.map((i) => ({ value: String(i.id), label: `${i.itemCode} — ${i.itemName}` })), [items])
  const optionsFor = (line: GoodsReceiptLineForm) =>
    line.itemId !== null && !items.some((i) => i.id === line.itemId)
      ? [{ value: String(line.itemId), label: `${line.itemCode} — ${line.itemName}` }, ...itemOptions]
      : itemOptions

  /* ── cells ──────────────────────────────────────────────────────────────────────────────────── */

  function itemCell(line: GoodsReceiptLineForm, index: number): ReactNode {
    const typed = editable && line.kind === 'manual'
    const refs = [
      line.containerLineNumber !== null ? `Load line ${line.containerLineNumber}` : null,
      line.orderNumber,
      line.invoiceNumber,
      sourceKind === 'Container' && line.supplierName ? line.supplierName : null,
    ].filter((part): part is string => !!part)

    if (typed) {
      return (
        <Stack gap={4} miw={220}>
          <Select
            aria-label={`Item, line ${index + 1}`}
            placeholder="Choose an item"
            data={optionsFor(line)}
            value={line.itemId === null ? null : String(line.itemId)}
            onChange={(next) => next && onItemChosen(line.key, Number(next))}
            searchable
            limit={100}
            nothingFoundMessage="No item matches"
            size="xs"
            data-line-item={index}
          />
          <Select
            aria-label={`Unit, line ${index + 1}`}
            data={line.units.map((u) => ({ value: String(u.id), label: unitLabel(u.unitTypeName, u.packingFormula) }))}
            value={line.itemUnitId === null ? null : String(line.itemUnitId)}
            onChange={(next) => {
              const unit = line.units.find((u) => String(u.id) === next)
              if (unit) onChange(line.key, { itemUnitId: unit.id, unitTypeName: unit.unitTypeName, packingFormula: unit.packingFormula })
            }}
            disabled={line.units.length === 0}
            placeholder="Unit"
            size="xs"
          />
        </Stack>
      )
    }

    return (
      <Stack gap={0} miw={150}>
        <Group gap={6} wrap="nowrap">
          <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
            {line.itemCode}
          </Text>
          {line.error && (
            <Tooltip label={line.error} multiline w={300} withArrow>
              <IconAlertTriangle size={15} color="var(--mantine-color-red-6)" />
            </Tooltip>
          )}
        </Group>
        <Text fz="xs" c="dimmed">
          {line.itemName}
        </Text>
        {refs.length > 0 && (
          <Text fz="xs" c="dimmed">
            {refs.join(' · ')}
          </Text>
        )}
      </Stack>
    )
  }

  function warehouseCell(line: GoodsReceiptLineForm, index: number): ReactNode {
    if (!editable) return <Text fz="sm">{line.warehouseCode ?? '—'}</Text>
    return (
      <Select
        aria-label={`Warehouse, line ${index + 1}`}
        placeholder="Choose"
        data={warehouseData}
        value={line.warehouseId === null ? null : String(line.warehouseId)}
        onChange={(next) => onChange(line.key, { warehouseId: next === null ? null : Number(next) })}
        searchable
        nothingFoundMessage="No warehouse matches"
        size="xs"
        w={phone ? '100%' : 140}
        // (92) a warehouse the reader may not use says so under the cell, which cuts the label's mark
        error={notYoursNote(warehouseData, line.warehouseId) ?? (line.error && line.warehouseId === null ? true : undefined)}
      />
    )
  }

  function expectedCell(line: GoodsReceiptLineForm): ReactNode {
    return <Text fz="sm">{line.expectedQuantityBase === null ? '—' : formatNumber(line.expectedQuantityBase)}</Text>
  }

  function receivedCell(line: GoodsReceiptLineForm, index: number): ReactNode {
    const pieces = receivedBaseOf(line)
    const boxed = line.packingFormula > 1
    if (!editable) {
      return (
        <Stack gap={0} align="flex-end">
          <Text fz="sm" fw={600}>
            {formatNumber(pieces)}
          </Text>
          {boxed && (
            <Text fz="xs" c="dimmed">
              {formatNumber(line.quantity)} × {unitLabel(line.unitTypeName, line.packingFormula)}
            </Text>
          )}
        </Stack>
      )
    }
    // A container line is counted in pieces and cannot exceed what was loaded (63000 otherwise).
    const max = line.kind === 'container' && line.expectedQuantityBase !== null ? line.expectedQuantityBase : undefined
    return (
      <NumberInput
        aria-label={`Received, line ${index + 1}`}
        value={line.quantity}
        onChange={(next) => onChange(line.key, { quantity: Math.max(0, Math.trunc(numberInputValue(next) ?? 0)) })}
        min={0}
        max={max}
        clampBehavior="strict"
        allowDecimal={false}
        allowNegative={false}
        thousandSeparator=","
        size="xs"
        w={phone ? '100%' : 96}
        description={boxed ? `${unitLabel(line.unitTypeName, line.packingFormula)} = ${formatNumber(pieces)} pcs` : undefined}
        data-line-received={line.key}
      />
    )
  }

  function differenceCell(line: GoodsReceiptLineForm): ReactNode {
    const difference = differenceOf(line)
    if (difference === null) return <Text fz="sm">—</Text>
    // Red only when the missing pieces are settled short (a container line, or "Nothing more will come"); on an
    // order or invoice line they are simply still to receive.
    const settles = line.kind === 'container' || line.closeShort
    return (
      <Text
        fz="sm"
        fw={difference !== 0 ? 600 : undefined}
        c={difference < 0 ? (settles ? 'red' : 'dimmed') : difference > 0 ? 'orange.7' : 'dimmed'}
      >
        {difference > 0 ? '+' : ''}
        {formatNumber(difference)}
      </Text>
    )
  }

  /** The reason: a code and a note. Required when a container line differs, or when nothing more will come. */
  function reasonCell(line: GoodsReceiptLineForm, index: number): ReactNode {
    const difference = differenceOf(line)
    // A container line explains any difference; an order or invoice line only what will never come.
    const needed = line.kind === 'container' ? difference !== null && difference !== 0 : line.closeShort
    if (!editable) {
      const label = varianceReasonLabel(line.varianceReasonCode)
      if (!label && !line.varianceReason) return <Text fz="sm">—</Text>
      return (
        <Stack gap={0}>
          {label && <Text fz="sm">{label}</Text>}
          {line.varianceReason && (
            <Text fz="xs" c="dimmed">
              {line.varianceReason}
            </Text>
          )}
        </Stack>
      )
    }
    if (!needed && !line.varianceReasonCode && !line.varianceReason) return <Text fz="sm" c="dimmed">—</Text>
    const required = needed
    return (
      <Stack gap={4} miw={150}>
        <Select
          aria-label={`Reason, line ${index + 1}`}
          placeholder={required ? 'Choose a reason' : 'Reason'}
          data={REASON_DATA}
          value={line.varianceReasonCode}
          onChange={(next) => onChange(line.key, { varianceReasonCode: (next as VarianceReasonCode | null) ?? null })}
          clearable={!required}
          size="xs"
          error={required && !line.varianceReasonCode && line.error ? true : undefined}
        />
        <TextInput
          aria-label={`Reason note, line ${index + 1}`}
          placeholder="Note"
          value={line.varianceReason}
          onChange={(event) => onChange(line.key, { varianceReason: event.currentTarget.value })}
          maxLength={300}
          size="xs"
        />
      </Stack>
    )
  }

  function closeShortCell(line: GoodsReceiptLineForm): ReactNode {
    if (line.kind === 'container' || line.poLineId === null) return <Text fz="sm" c="dimmed">—</Text>
    if (!editable) return <Text fz="sm">{line.closeShort ? 'Yes' : 'No'}</Text>
    return (
      <Checkbox
        aria-label="Nothing more will come"
        checked={line.closeShort}
        onChange={(event) => onChange(line.key, { closeShort: event.currentTarget.checked })}
      />
    )
  }

  function costCell(line: GoodsReceiptLineForm, index: number): ReactNode {
    const source = costSourceOf(line)
    const badge = source ? (
      <Badge size="xs" variant="light" color={source === 'Order' ? 'yellow' : source === 'Manual' ? 'gray' : source === 'Mixed' ? 'orange' : 'green'}>
        {COST_SOURCE_LABELS[source]}
      </Badge>
    ) : null

    if (editable && line.kind === 'manual') {
      return (
        <Stack gap={4} align="flex-end">
          <NumberInput
            aria-label={`Unit cost, line ${index + 1}`}
            value={line.manualUnitCostBase ?? ''}
            onChange={(next) => onChange(line.key, { manualUnitCostBase: numberInputValue(next) })}
            min={0}
            decimalScale={6}
            thousandSeparator=","
            allowNegative={false}
            size="xs"
            w={120}
          />
          {badge}
        </Stack>
      )
    }

    const cost = unitCostOf(line)
    const received = receivedBaseOf(line)
    return (
      <Stack gap={2} align="flex-end" miw={96}>
        <Text fz="sm">{cost === null ? '—' : formatNumber(cost, 2)}</Text>
        {badge}
        {posted && line.kind !== 'manual' && received > 0 && (
          <Text fz={11} c="dimmed" ta="right">
            {formatNumber(line.invoicedBase)} of {formatNumber(received)} pcs invoiced
          </Text>
        )}
      </Stack>
    )
  }

  function valueCell(line: GoodsReceiptLineForm): ReactNode {
    const value = lineValueOf(line, posted)
    return <Text fz="sm">{value === null ? '—' : formatNumber(value, 2)}</Text>
  }

  // A line of an order or an invoice can be left out of the draft too: its pieces simply stay to receive (the server
  // never drops a line of 0 on its own). A container's lines are its load lines and stay.
  function removeCell(line: GoodsReceiptLineForm, index: number): ReactNode {
    if (!(editable && line.kind !== 'container')) return null
    return (
      <Tooltip label={line.kind === 'manual' ? 'Remove line' : 'Remove line: its pieces stay to receive'} withArrow>
        <ActionIcon variant="subtle" color="red" aria-label={`Remove line ${index + 1}`} onClick={() => onRemove(line.key)}>
          <IconTrash size={16} />
        </ActionIcon>
      </Tooltip>
    )
  }

  const addLine =
    editable && manualReceipt ? (
      <Group mt="sm">
        <Button variant="default" size="xs" onClick={onAdd}>
          + Add line
        </Button>
      </Group>
    ) : null

  const empty = (
    <Text size="sm" c="dimmed" ta="center" py="md">
      {manualReceipt ? 'No line yet. Add the goods received with + Add line.' : 'This receipt has no lines.'}
    </Text>
  )

  /* ── a phone: one card per line, the counting first and the money below ──────────────────── */

  if (phone) {
    return (
      <Stack gap="sm">
        {lines.length === 0 && empty}
        {lines.map((line, index) => (
          <Paper
            key={line.key}
            withBorder
            radius="md"
            p="sm"
            bg={line.error ? 'var(--mantine-color-red-0)' : undefined}
            data-line={index + 1}
          >
            <Group justify="space-between" align="flex-start" wrap="nowrap" mb="xs">
              <Group gap={6} align="flex-start" wrap="nowrap">
                <Text fz="xs" c="dimmed" pt={2}>
                  {index + 1}
                </Text>
                {itemCell(line, index)}
              </Group>
              {removeCell(line, index)}
            </Group>
            {line.error && (
              <Text fz="xs" c="red" mb="xs">
                {line.error}
              </Text>
            )}
            <SimpleGrid cols={showExpected ? 3 : 1} spacing="xs">
              {showExpected && (
                <Box>
                  <Text fz="xs" c="dimmed">
                    Expected (pcs)
                  </Text>
                  {expectedCell(line)}
                </Box>
              )}
              <Box>
                <Text fz="xs" c="dimmed">
                  Received (pcs)
                </Text>
                {receivedCell(line, index)}
              </Box>
              {showExpected && (
                <Box>
                  <Text fz="xs" c="dimmed">
                    Difference
                  </Text>
                  {differenceCell(line)}
                </Box>
              )}
            </SimpleGrid>
            {showExpected && (
              <Box mt="xs">
                <Text fz="xs" c="dimmed">
                  Reason
                </Text>
                {reasonCell(line, index)}
              </Box>
            )}
            {(showWarehouse || (showCloseShort && line.kind !== 'container' && line.poLineId !== null)) && (
              <SimpleGrid cols={2} spacing="xs" mt="xs">
                {showWarehouse && (
                  <Box>
                    <Text fz="xs" c="dimmed">
                      Warehouse
                    </Text>
                    {warehouseCell(line, index)}
                  </Box>
                )}
                {showCloseShort && line.kind !== 'container' && line.poLineId !== null && (
                  <Box>
                    <Text fz="xs" c="dimmed">
                      Nothing more will come
                    </Text>
                    {closeShortCell(line)}
                  </Box>
                )}
              </SimpleGrid>
            )}
            <Group justify="space-between" align="flex-start" mt="xs" pt="xs" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
              <Box>
                <Text fz="xs" c="dimmed">
                  Unit cost
                </Text>
                {costCell(line, index)}
              </Box>
              <Box ta="right">
                <Text fz="xs" c="dimmed">
                  Value ({currencyCode})
                </Text>
                {valueCell(line)}
              </Box>
            </Group>
          </Paper>
        ))}
        {addLine}
      </Stack>
    )
  }

  /* ── a screen: one table ──────────────────────────────────────────────────────────────────── */

  return (
    <>
      <Table.ScrollContainer minWidth={showWarehouse ? 1040 : 880}>
        <Table verticalSpacing="xs" horizontalSpacing={8} striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={30}>#</Table.Th>
              <Table.Th>Item</Table.Th>
              {showWarehouse && <Table.Th>Warehouse</Table.Th>}
              {showExpected && <Table.Th ta="right">Expected (pcs)</Table.Th>}
              <Table.Th ta="right">Received (pcs)</Table.Th>
              {showExpected && <Table.Th ta="right">Difference</Table.Th>}
              {showExpected && <Table.Th>Reason</Table.Th>}
              {showCloseShort && <Table.Th ta="center">Nothing more will come</Table.Th>}
              <Table.Th ta="right">Unit cost ({currencyCode})</Table.Th>
              <Table.Th ta="right">Value ({currencyCode})</Table.Th>
              {removable && <Table.Th w={40} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={12}>{empty}</Table.Td>
              </Table.Tr>
            )}
            {lines.map((line, index) => (
              <Table.Tr key={line.key} bg={line.error ? 'var(--mantine-color-red-0)' : undefined} data-line={index + 1}>
                <Table.Td>
                  <Text fz="sm" c="dimmed">
                    {index + 1}
                  </Text>
                </Table.Td>
                <Table.Td>{itemCell(line, index)}</Table.Td>
                {showWarehouse && <Table.Td>{warehouseCell(line, index)}</Table.Td>}
                {showExpected && <Table.Td ta="right">{expectedCell(line)}</Table.Td>}
                <Table.Td>
                  <Group justify="flex-end">{receivedCell(line, index)}</Group>
                </Table.Td>
                {showExpected && <Table.Td ta="right">{differenceCell(line)}</Table.Td>}
                {showExpected && <Table.Td>{reasonCell(line, index)}</Table.Td>}
                {showCloseShort && (
                  <Table.Td>
                    <Group justify="center">{closeShortCell(line)}</Group>
                  </Table.Td>
                )}
                <Table.Td>{costCell(line, index)}</Table.Td>
                <Table.Td ta="right">{valueCell(line)}</Table.Td>
                {removable && <Table.Td>{removeCell(line, index)}</Table.Td>}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {addLine}
    </>
  )
}
