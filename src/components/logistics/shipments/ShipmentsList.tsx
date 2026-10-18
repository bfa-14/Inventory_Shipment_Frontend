import { useMemo } from 'react'
import { Link } from 'react-router'
import { Anchor, Paper, Stack, Text } from '@mantine/core'
import type { ShipmentCardDto, ShipmentPhase } from '../../../api/logistics/shipments'
import { routes } from '../../../routes'
import { formatNumber } from '../../format'
import { DataTable, type DataTableColumn } from '../../ui/DataTable'
import { useDataGrid, type GridColumnMeta } from '../../ui/grid/useDataGrid'
import { nextStepColumnText, type NextStepAction } from '../nextStep'
import { CardBadges, GroupLabel, NextStepLink, OrderRef, PlannedNext, type CardLinks } from './ShipmentCard'
import { isSelectableCard } from './shipmentBoard'

interface ShipmentsListProps {
  cards: ShipmentCardDto[]
  /** The server's column titles, by phase: the Stage column says what the board's header says. */
  titles: Partial<Record<ShipmentPhase, string>>
  /** The ticked cards, in board order. */
  selected: ShipmentCardDto[]
  onSelectedChange(next: ShipmentCardDto[]): void
  onOpen(card: ShipmentCardDto): void
  stepOf(card: ShipmentCardDto): NextStepAction | null
  onStep(card: ShipmentCardDto): void
  links: CardLinks
  fetching: boolean
  emptyText: string
  /** containers.view: the ref links to the container's page (plain text without it). */
  canOpenContainers: boolean
}

/** What the Badges cell says in words: its filter and its CSV. */
function badgesText(card: ShipmentCardDto): string {
  return [
    card.isLate ? 'Late' : null,
    card.isFreeTimeOver ? 'Free time over' : null,
    card.status === 1 ? 'Draft' : null,
    card.containerNo ? null : 'No container no.',
    card.phase === 'AtBorderCustoms' && card.status === 5 ? 'Cleared' : null,
    card.goodsReceiptStatus === 1 ? 'GRN draft' : null,
    card.plannedMovementNo ? `Planned next: ${card.plannedMovementNo}` : null,
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * THE BOARD AS ONE TABLE (script 82: "Board" / "List"), for 300 containers or more: the same rows, the same selection
 * and the same next step as the cards, in the application's grid - every column sorts and filters in the browser, the
 * page size goes to 500, and a click on a row opens the same drawer as a card.
 */
export function ShipmentsList({ cards, titles, selected, onSelectedChange, onOpen, stepOf, onStep, links, fetching, emptyText, canOpenContainers }: ShipmentsListProps) {
  // The Stage column reads the server's titles; everything else is what the row carries.
  const meta = useMemo<GridColumnMeta<ShipmentCardDto>[]>(
    () => [
      { accessor: 'containerRef', summary: 'count' },
      { accessor: 'containerNo', text: (r) => r.containerNo ?? '' },
      { accessor: 'phase', kind: 'list', value: (r) => r.groupOrder + 1000 * phaseRank(r.phase), text: (r) => titles[r.phase] ?? r.phase },
      { accessor: 'groupLabel', text: (r) => r.groupLabel },
      { accessor: 'nextStep', text: (r) => nextStepColumnText(r) },
      { accessor: 'badges', text: badgesText },
      { accessor: 'supplierNames', text: (r) => r.supplierNames ?? '' },
      { accessor: 'orderNumbers', text: (r) => r.orderNumbers ?? '' },
      { accessor: 'totalQtyBase', kind: 'number', summary: 'sum' },
    ],
    [titles],
  )
  const engine = useDataGrid({ rows: cards, columns: meta, storeKey: 'logistics.shipments', pageSize: 50 })

  const dash = (
    <Text fz="sm" c="dimmed">
      —
    </Text>
  )
  const columns: DataTableColumn<ShipmentCardDto>[] = [
    {
      accessor: 'containerRef',
      title: 'Container Ref.',
      width: 140,
      render: (row) =>
        canOpenContainers ? (
          <Anchor component={Link} to={routes.container(row.id)} fz="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
            {row.containerRef}
          </Anchor>
        ) : (
          <Text fz="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
            {row.containerRef}
          </Text>
        ),
    },
    { accessor: 'containerNo', title: 'Container No.', width: 135, render: (row) => (row.containerNo ? <Text fz="sm">{row.containerNo}</Text> : dash) },
    { accessor: 'phase', title: 'Stage', width: 150, render: (row) => <Text fz="sm">{titles[row.phase] ?? row.phase}</Text> },
    {
      accessor: 'groupLabel',
      title: 'Place or leg',
      width: 260,
      render: (row) => (
        <Text fz="sm" style={{ whiteSpace: 'normal' }}>
          <GroupLabel card={row} canOpenMovements={links.movements} />
        </Text>
      ),
    },
    {
      accessor: 'nextStep',
      title: 'Next step',
      width: 230,
      render: (row) => {
        if (row.phase === 'Received') return dash
        const step = stepOf(row)
        // Without the right to take it, the step is still said (as on the Containers list), only not offered.
        return step ? (
          <NextStepLink step={step} onStep={() => onStep(row)} prefix={false} />
        ) : (
          <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
            {nextStepColumnText(row) || '—'}
          </Text>
        )
      },
    },
    {
      accessor: 'badges',
      title: 'Badges',
      width: 220,
      render: (row) => (
        <Stack gap={2}>
          <CardBadges card={row} canViewReceipts={links.receipts} />
          <PlannedNext card={row} canOpenMovements={links.movements} />
        </Stack>
      ),
    },
    { accessor: 'supplierNames', title: 'Supplier', width: 180, render: (row) => (row.supplierNames ? <Text fz="sm">{row.supplierNames}</Text> : dash) },
    {
      accessor: 'orderNumbers',
      title: 'Order No.',
      width: 170,
      render: (row) =>
        row.orderNumbers ? (
          <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>
            <OrderRef card={row} canOpen={links.orders} />
          </Text>
        ) : (
          dash
        ),
    },
    { accessor: 'totalQtyBase', title: 'Qty', width: 80, textAlign: 'right', render: (row) => formatNumber(row.totalQtyBase) },
  ]

  return (
    <Paper radius="lg" withBorder data-shipments-list>
      <DataTable<ShipmentCardDto>
        storeKey="logistics.shipments"
        engine={engine}
        exportFileName="shipments"
        columns={columns}
        fetching={fetching}
        noRecordsText={emptyText}
        selectedRecords={selected}
        onSelectedRecordsChange={onSelectedChange}
        isRecordSelectable={(row) => isSelectableCard(row)}
        onRowClick={({ record }) => onOpen(record)}
      />
    </Paper>
  )
}

/** The columns' order, for sorting the Stage column left to right rather than by its words. */
function phaseRank(phase: ShipmentPhase): number {
  return ['AtSupplier', 'AtSea', 'AtPort', 'OnTheRoad', 'AtBorderCustoms', 'Delivered', 'Received'].indexOf(phase)
}
