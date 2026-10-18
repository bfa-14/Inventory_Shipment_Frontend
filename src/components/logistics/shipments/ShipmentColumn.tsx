import { ActionIcon, Button, Checkbox, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import type { ShipmentCardDto } from '../../../api/logistics/shipments'
import { formatNumber } from '../../format'
import type { NextStepAction } from '../nextStep'
import { ShipmentCard, type CardLinks } from './ShipmentCard'
import { CARDS_STEP, columnFigures, drawColumn, groupTitle, tickState, type BoardColumn } from './shipmentBoard'

interface ShipmentColumnProps {
  column: BoardColumn
  selected: ReadonlySet<number>
  /** Ticks (on) or unticks the containers. */
  onSelect(ids: number[], on: boolean): void
  onOpen(card: ShipmentCardDto): void
  stepOf(card: ShipmentCardDto): NextStepAction | null
  onStep(card: ShipmentCardDto): void
  links: CardLinks
  /** Whether the reader folded a group (kept across reloads). */
  isFolded(groupKey: string): boolean
  onFold(groupKey: string, folded: boolean): void
  /** How many cards the column draws (50, then 50 more at each "Show 50 more"). */
  limit: number
  onLimit(next: number): void
  /** The cards' own scroll on a wide screen (the headers stay in view); none on a phone, where the page scrolls. */
  bodyHeight?: string
}

/**
 * ONE COLUMN OF THE SHIPMENTS BOARD: its title with the containers and pieces it holds and "Select all (n)", then its
 * groups - a ship, a leg, a place, a warehouse - each folding on its own and with its own "Select all", then the cards.
 *
 * IT DRAWS 50 CARDS, then "Show 50 more": a column of 750 containers drew 750 cards of badges and links. Only the drawing
 * is cut: every group header is drawn, so a whole ship can be ticked before its cards are on screen, and the column's
 * "Select all" reaches every container in it. The Received column is read-only: no box, no next step.
 */
export function ShipmentColumn({
  column,
  selected,
  onSelect,
  onOpen,
  stepOf,
  onStep,
  links,
  isFolded,
  onFold,
  limit,
  onLimit,
  bodyHeight,
}: ShipmentColumnProps) {
  const readOnly = column.phase === 'Received'
  const { groups, drawn, hidden } = drawColumn(column, limit, isFolded)
  const all = tickState(column.selectable, selected)
  const ids = (cards: ShipmentCardDto[]) => cards.map((c) => c.id)

  const body = (
    <Stack gap="xs" data-shipment-column-body>
      {column.cards.length === 0 ? (
        <Text fz="xs" c="dimmed" ta="center" py="md">
          No container here.
        </Text>
      ) : null}
      {groups.map(({ group, cards, hidden: notDrawn }) => {
        const groupFolded = isFolded(group.key)
        const groupTick = tickState(group.cards, selected)
        return (
          <Stack key={group.key} gap={6} data-shipment-group={group.key}>
            <Group gap={4} wrap="nowrap" align="flex-start">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label={groupFolded ? `Show ${group.label}` : `Fold ${group.label}`}
                aria-expanded={!groupFolded}
                onClick={() => onFold(group.key, !groupFolded)}
              >
                {groupFolded ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
              </ActionIcon>
              <Text fz="xs" fw={700} style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }} data-shipment-group-title>
                {groupTitle(group)}
              </Text>
            </Group>
            {readOnly ? null : (
              <Checkbox
                size="xs"
                ml={4}
                label="Select all"
                aria-label={`Select all of ${group.label}`}
                checked={groupTick.all}
                indeterminate={groupTick.some}
                onChange={(e) => onSelect(ids(group.cards), e.currentTarget.checked)}
                data-shipment-group-select
              />
            )}
            {cards.map((card) => (
              <ShipmentCard
                key={card.id}
                card={card}
                selected={selected.has(card.id)}
                onToggle={readOnly ? undefined : (on) => onSelect([card.id], on)}
                onOpen={() => onOpen(card)}
                step={readOnly ? null : stepOf(card)}
                onStep={() => onStep(card)}
                links={links}
              />
            ))}
            {notDrawn > 0 ? (
              <Text fz="xs" c="dimmed" ml={4}>
                {formatNumber(notDrawn)} more in this group: Show {formatNumber(CARDS_STEP)} more below.
              </Text>
            ) : null}
          </Stack>
        )
      })}
      {hidden > 0 ? (
        <Stack gap={4} align="flex-start" data-shipment-more>
          <Text fz="xs" c="dimmed">
            Showing {formatNumber(drawn)} of {formatNumber(drawn + hidden)} containers.
          </Text>
          <Group gap={4}>
            <Button size="compact-xs" variant="light" onClick={() => onLimit(limit + CARDS_STEP)}>
              Show {formatNumber(Math.min(CARDS_STEP, hidden))} more
            </Button>
            <Button size="compact-xs" variant="subtle" onClick={() => onLimit(Number.POSITIVE_INFINITY)}>
              Show all
            </Button>
          </Group>
        </Stack>
      ) : null}
    </Stack>
  )

  return (
    <Paper withBorder radius="lg" p={6} bg="var(--mantine-color-gray-0)" data-shipment-column={column.phase}>
      <Stack gap={4} mb="xs" px={4} pt={2}>
        <Title order={6} data-shipment-column-title>
          {column.title}
        </Title>
        <Text fz="xs" c="dimmed" data-shipment-column-figures>
          {columnFigures(column)}
        </Text>
        {readOnly ? (
          <Text fz="xs" c="dimmed">
            Read-only: received in the last 30 days.
          </Text>
        ) : column.selectable.length > 0 ? (
          <Checkbox
            size="xs"
            label={`Select all (${formatNumber(column.selectable.length)})`}
            checked={all.all}
            indeterminate={all.some}
            onChange={(e) => onSelect(ids(column.selectable), e.currentTarget.checked)}
            data-shipment-column-select
          />
        ) : null}
      </Stack>
      {bodyHeight ? (
        // A plain scrolling box, not Mantine's ScrollArea: its content is laid out as a table, which kept long lines
        // from wrapping and cut them at the column's edge.
        <div style={{ maxHeight: bodyHeight, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'thin', paddingRight: 2 }}>{body}</div>
      ) : (
        body
      )}
    </Paper>
  )
}
