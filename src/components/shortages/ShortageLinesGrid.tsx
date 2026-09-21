import { useState } from 'react'
import { ActionIcon, Anchor, Badge, Group, NumberInput, Text, TextInput, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconRestore, IconTrash } from '@tabler/icons-react'
import { Link } from 'react-router'
import { unitLabel } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { DataTable, type DataTableColumn, type DataTableSortStatus } from '../ui/DataTable'
import { derive, type ShortageDerived, type ShortageLine } from './shortageMath'

/** A line with its place on the document and every derived cell — what the grid sorts and draws. */
type Row = ShortageLine & ShortageDerived & { lineNo: number }

interface ShortageLinesGridProps {
  lines: ShortageLine[]
  /** The header's "Lead Time (Month)": one value for every line. */
  leadTimeMonths: number
  onChange: (key: string, patch: Partial<ShortageLine>) => void
  onRemove: (key: string) => void
  readOnly: boolean
}

/** What a column sorts by. Anything not named here sorts by its own accessor. */
const SORT_VALUE: Record<string, (row: Row) => number | string> = {
  itemCode: (row) => row.itemCode.toLowerCase(),
  effectiveMonthlySales: (row) => row.effectiveMonthlySales,
  coverageMonths: (row) => row.coverageMonths ?? Number.POSITIVE_INFINITY,
  pcPerContainer: (row) => row.pcPerContainer ?? -1,
  containerRequirement: (row) => row.containerRequirement ?? -1,
  minQuantity: (row) => row.minQuantity ?? -1,
  maxQuantity: (row) => row.maxQuantity ?? -1,
  lastCost: (row) => row.lastCost ?? -1,
  notes: (row) => row.notes.toLowerCase(),
}

const LINE_ORDER: DataTableSortStatus<Row> = { columnAccessor: 'lineNo', direction: 'asc' }

function compare(a: Row, b: Row, status: DataTableSortStatus<Row>): number {
  const accessor = status.columnAccessor as string
  const read = SORT_VALUE[accessor] ?? ((row: Row) => (row as unknown as Record<string, number | string>)[accessor] ?? 0)
  const left = read(a)
  const right = read(b)
  const result = typeof left === 'string' || typeof right === 'string' ? String(left).localeCompare(String(right)) : left - right
  return (status.direction === 'asc' ? result : -result) || a.lineNo - b.lineNo
}

/**
 * The plan's lines: nine figures from the server, three cells the planner types into, and the rest
 * worked out between them as they are typed.
 *
 * THE ORDER IS FROZEN WHILE YOU TYPE. Sorting by Required Qty and then editing one would otherwise
 * move the row out from under the cursor at the first digit. The order is taken when a header is
 * clicked (and when lines are added or removed) and kept until the next click — a row can be out
 * of place by its new value, and clicking the header again puts it right.
 *
 * WIDE ON PURPOSE, SCROLLING INSIDE ITS CARD. Nineteen columns is the customer's study; the "#" and
 * Item columns stay put while the rest scroll (`.shortage-lines` in app.css), so a figure at the far
 * right is still a figure *of something*.
 */
export function ShortageLinesGrid({ lines, leadTimeMonths, onChange, onRemove, readOnly }: ShortageLinesGridProps) {
  const [sortStatus, setSortStatus] = useState<DataTableSortStatus<Row>>(LINE_ORDER)
  const [order, setOrder] = useState<string[]>([])

  const rows: Row[] = lines.map((line, index) => ({ ...line, ...derive(line, leadTimeMonths), lineNo: index + 1 }))
  const byKey = new Map(rows.map((row) => [row.key, row]))

  // Lines were added or removed: keep the frozen order for the rows still here, put the new ones
  // at the end. Corrected during the render that changes the lines, never in an effect, so no row
  // is painted in the wrong place for a frame.
  const known = order.filter((key) => byKey.has(key))
  const added = rows.filter((row) => !order.includes(row.key)).map((row) => row.key)
  if (known.length !== order.length || added.length > 0) setOrder([...known, ...added])

  const records = [...known, ...added].map((key) => byKey.get(key)!)

  function sortBy(status: DataTableSortStatus<Row>) {
    setSortStatus(status)
    setOrder([...rows].sort((a, b) => compare(a, b, status)).map((row) => row.key))
  }

  const number = (value: number | null, decimals = 0) => <Text fz="sm">{formatNumber(value, decimals)}</Text>

  const columns: DataTableColumn<Row>[] = [
    {
      accessor: 'lineNo',
      title: '#',
      sortable: true,
      width: 56,
      render: (row) => (
        <Group gap={4} wrap="nowrap">
          <Text fz="sm">{row.lineNo}</Text>
          {row.error && (
            <Tooltip label={row.error} multiline w={300} withArrow>
              <IconAlertTriangle size={15} color="var(--mantine-color-red-6)" />
            </Tooltip>
          )}
        </Group>
      ),
    },
    {
      accessor: 'itemCode',
      title: 'Item',
      sortable: true,
      width: 210,
      render: (row) => (
        <div>
          <Anchor component={Link} to={`/inventory/items/${row.itemId}`} fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
            {row.itemCode}
          </Anchor>
          <Text fz="xs" c="dimmed" lineClamp={1} title={row.itemName}>{row.itemName}</Text>
        </div>
      ),
    },
    { accessor: 'currentInventoryBase', title: 'Current Inventory', sortable: true, width: 160, textAlign: 'right', render: (row) => number(row.currentInventoryBase) },
    { accessor: 'transitBase', title: 'Transit Qty', sortable: true, width: 125, textAlign: 'right', render: (row) => number(row.transitBase) },
    { accessor: 'outstandingOrderBase', title: 'Outstanding Order Qty', sortable: true, width: 200, textAlign: 'right', render: (row) => number(row.outstandingOrderBase) },
    { accessor: 'stockPlusTransitBase', title: 'Stock + Transit', sortable: true, width: 150, textAlign: 'right', render: (row) => number(row.stockPlusTransitBase) },
    { accessor: 'totalExpectedStockBase', title: 'Total Expected Stock', sortable: true, width: 185, textAlign: 'right', render: (row) => <Text fz="sm" fw={500}>{formatNumber(row.totalExpectedStockBase)}</Text> },
    {
      accessor: 'effectiveMonthlySales',
      title: 'Expected Monthly Sales',
      sortable: true,
      width: 215,
      textAlign: 'right',
      render: (row) =>
        readOnly ? (
          <Group gap={6} justify="flex-end" wrap="nowrap">
            {row.expectedMonthlySalesManual !== null && <Badge size="xs" variant="light" color="violet">manual</Badge>}
            <Text fz="sm">{formatNumber(row.effectiveMonthlySales, 2)}</Text>
          </Group>
        ) : (
          <div data-line-sales={row.key}>
            <NumberInput
              value={row.expectedMonthlySalesManual ?? ''}
              // The computed value, greyed, is what stands while nothing is typed over it.
              placeholder={formatNumber(row.expectedMonthlySalesBase, 2)}
              min={0}
              decimalScale={2}
              allowNegative={false}
              thousandSeparator=","
              onChange={(next) => onChange(row.key, { expectedMonthlySalesManual: numberInputValue(next) })}
              aria-label={`Expected monthly sales of line ${row.lineNo}`}
              rightSectionWidth={row.expectedMonthlySalesManual === null ? undefined : 30}
              rightSection={
                row.expectedMonthlySalesManual === null ? undefined : (
                  <Tooltip label={`Back to the computed ${formatNumber(row.expectedMonthlySalesBase, 2)}`} withArrow>
                    <ActionIcon variant="subtle" size="sm" onClick={() => onChange(row.key, { expectedMonthlySalesManual: null })} aria-label={`Reset the monthly sales of line ${row.lineNo}`}>
                      <IconRestore size={14} />
                    </ActionIcon>
                  </Tooltip>
                )
              }
            />
            {row.expectedMonthlySalesManual !== null && (
              <Group gap={4} justify="flex-end" mt={2} wrap="nowrap">
                <Badge size="xs" variant="light" color="violet">manual</Badge>
                <Text fz={10} c="dimmed">computed {formatNumber(row.expectedMonthlySalesBase, 2)}</Text>
              </Group>
            )}
          </div>
        ),
    },
    { accessor: 'leadTime', title: 'Lead Time (Month)', width: 175, textAlign: 'right', render: () => number(leadTimeMonths, Number.isInteger(leadTimeMonths) ? 0 : 2) },
    { accessor: 'expectedRequirementBase', title: 'Expected Requirement', sortable: true, width: 195, textAlign: 'right', render: (row) => number(row.expectedRequirementBase, 2) },
    {
      accessor: 'shortageBase',
      title: 'Shortage Qty',
      sortable: true,
      width: 140,
      textAlign: 'right',
      render: (row) => <Text fz="sm" fw={row.shortageBase > 0 ? 700 : 400} c={row.shortageBase > 0 ? 'red' : undefined} data-line-shortage={row.key}>{formatNumber(row.shortageBase)}</Text>,
    },
    {
      accessor: 'coverageMonths',
      title: 'Coverage',
      sortable: true,
      width: 120,
      textAlign: 'right',
      render: (row) =>
        row.coverageMonths === null ? (
          <Tooltip label="Nothing sells: months of coverage have no meaning" withArrow><Text fz="sm" c="dimmed">—</Text></Tooltip>
        ) : (
          <Text fz="sm" fw={row.coverageMonths < leadTimeMonths ? 700 : 400} c={row.coverageMonths < leadTimeMonths ? 'red' : undefined}>{formatNumber(row.coverageMonths, 2)}</Text>
        ),
    },
    {
      accessor: 'requiredQty',
      title: 'Required Qty',
      sortable: true,
      width: 215,
      textAlign: 'right',
      render: (row) => {
        const unit = unitLabel(row.purchaseUnitName, row.purchasePackingFormula)
        if (readOnly) return <Text fz="sm" fw={500}>{formatNumber(row.requiredQty)} {unit}</Text>
        const offSuggestion = row.requiredQty !== row.suggestedRequiredQty
        return (
          <Group gap={4} wrap="nowrap" data-line-required={row.key}>
            <NumberInput
              // A typed zero shows as an empty box over a "0" placeholder: a box that snaps back to
              // "0" when cleared turns the next "17" into "170".
              value={row.requiredQty === 0 && row.requiredManual ? '' : row.requiredQty}
              placeholder="0"
              min={0}
              step={1}
              allowDecimal={false}
              allowNegative={false}
              thousandSeparator=","
              onChange={(next) => onChange(row.key, { requiredQty: numberInputValue(next) ?? 0, requiredManual: true })}
              aria-label={`Required quantity of line ${row.lineNo}`}
              rightSection={<Text fz="xs" c="dimmed" pr={6} style={{ whiteSpace: 'nowrap' }}>{unit}</Text>}
              rightSectionWidth={Math.min(110, 18 + unit.length * 7)}
              rightSectionPointerEvents="none"
              flex={1}
            />
            <Tooltip label={offSuggestion ? `Reset to suggested (${formatNumber(row.suggestedRequiredQty)})` : 'This is the suggested quantity'} withArrow>
              <ActionIcon variant="subtle" size="sm" disabled={!offSuggestion} onClick={() => onChange(row.key, { requiredQty: row.suggestedRequiredQty, requiredManual: false })} aria-label={`Reset line ${row.lineNo} to the suggested quantity`}>
                <IconRestore size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )
      },
    },
    {
      accessor: 'pcPerContainer',
      title: 'PC per Container',
      sortable: true,
      width: 165,
      textAlign: 'right',
      render: (row) =>
        readOnly ? (
          number(row.pcPerContainer)
        ) : (
          <NumberInput
            value={row.pcPerContainer ?? ''}
            placeholder="None"
            min={1}
            step={1}
            allowDecimal={false}
            allowNegative={false}
            thousandSeparator=","
            onChange={(next) => {
              const parsed = numberInputValue(next)
              onChange(row.key, { pcPerContainer: parsed !== null && parsed > 0 ? parsed : null })
            }}
            aria-label={`PC per container of line ${row.lineNo}`}
          />
        ),
    },
    { accessor: 'containerRequirement', title: 'Container Requirement', sortable: true, width: 200, textAlign: 'right', render: (row) => <Text fz="sm" data-line-containers={row.key}>{formatNumber(row.containerRequirement, 2)}</Text> },
    { accessor: 'minQuantity', title: 'Min', sortable: true, width: 80, textAlign: 'right', render: (row) => number(row.minQuantity) },
    { accessor: 'maxQuantity', title: 'Max', sortable: true, width: 80, textAlign: 'right', render: (row) => number(row.maxQuantity) },
    { accessor: 'lastCost', title: 'Last cost', sortable: true, width: 120, textAlign: 'right', render: (row) => number(row.lastCost, 2) },
    {
      accessor: 'notes',
      title: 'Notes',
      sortable: true,
      width: 200,
      render: (row) =>
        readOnly ? (
          <Text fz="sm" c="dimmed">{row.notes || '—'}</Text>
        ) : (
          <TextInput value={row.notes} placeholder="Optional" maxLength={300} onChange={(event) => onChange(row.key, { notes: event.currentTarget.value })} aria-label={`Notes of line ${row.lineNo}`} />
        ),
    },
    ...(readOnly
      ? []
      : [
          {
            accessor: 'remove',
            title: '',
            width: 56,
            textAlign: 'center',
            render: (row) => (
              <Tooltip label="Remove line" withArrow>
                <ActionIcon variant="subtle" color="red" onClick={() => onRemove(row.key)} aria-label={`Remove line ${row.lineNo}`}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            ),
          } as DataTableColumn<Row>,
        ]),
  ]

  return (
    <div className="shortage-lines" data-shortage-lines>
      <DataTable<Row>
        records={records}
        columns={columns}
        idAccessor="key"
        sortStatus={sortStatus}
        onSortStatusChange={sortBy}
        minHeight={lines.length === 0 ? 180 : 0}
        noRecordsText={readOnly ? 'This plan has no lines.' : 'No lines yet. "Load items" brings in the items that are short.'}
        rowClassName={(row) => (row.error ? 'app-grid__row--danger' : undefined)}
      />
    </div>
  )
}
