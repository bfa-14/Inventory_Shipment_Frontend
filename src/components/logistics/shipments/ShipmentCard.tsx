import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { Anchor, Badge, Checkbox, Group, Paper, Stack, Text, Tooltip } from '@mantine/core'
import type { ShipmentCardDto } from '../../../api/logistics/shipments'
import { routes } from '../../../routes'
import { dateLabel } from '../../documents/documentKind'
import type { NextStepAction } from '../nextStep'
import { isStay } from '../shipStep'
import { itemsText } from './shipmentBoard'

/** What a card may link to: each link only with the page's own view permission (else the number is plain text). */
export interface CardLinks {
  movements: boolean
  orders: boolean
  receipts: boolean
}

interface ShipmentCardProps {
  card: ShipmentCardDto
  selected: boolean
  /** Absent on a received card: the Received column is read-only. */
  onToggle?(on: boolean): void
  /** The drawer: the route, the next step, "Open container". */
  onOpen(): void
  /** The container's next step as the reader may take it (null: hidden, the reader may not). */
  step: NextStepAction | null
  onStep(): void
  links: CardLinks
}

/** A click on the card's own controls (its box, its links, its step) is theirs: it does not open the drawer as well. */
function fromControl(event: MouseEvent): boolean {
  return (event.target as HTMLElement).closest('a, button, input, label') !== null
}

/** "MOV-2026-000046", linked to the movement (Back returns to the board) for a reader who may view movements. */
export function MovementRef({ id, no, canOpen }: { id: number | null | undefined; no: string | null | undefined; canOpen: boolean }) {
  if (!no) return null
  if (!canOpen || !id) return <Text span inherit>{no}</Text>
  return (
    <Anchor component={Link} to={`${routes.movement(id)}?from=shipments`} inherit>
      {no}
    </Anchor>
  )
}

/**
 * A group's words as the server gives them, with a ship's movement number linked like every MOV number of the board:
 * in "MOV-2026-000046 · MSC Aurora V.123 · Chennai → Dar es Salaam · ETA 20/10/2026" the movement opens with
 * ?from=shipments, for a reader who may view movements. Every other group reads as it comes.
 */
export function GroupLabel({ card, canOpenMovements }: { card: Pick<ShipmentCardDto, 'groupKey' | 'groupLabel' | 'activeMovementId' | 'activeMovementNo'>; canOpenMovements: boolean }) {
  const no = card.activeMovementNo
  if (!card.groupKey.startsWith('MOV|') || !card.activeMovementId || !no || !card.groupLabel.startsWith(no)) return <>{card.groupLabel}</>
  return (
    <>
      <MovementRef id={card.activeMovementId} no={no} canOpen={canOpenMovements} />
      {card.groupLabel.slice(no.length)}
    </>
  )
}

/** The order of the card: a link only when it is the container's own and only order (the Containers list's rule). */
export function OrderRef({ card, canOpen }: { card: ShipmentCardDto; canOpen: boolean }) {
  if (!card.orderNumbers) return null
  const own = card.purchaseOrderId && card.orderCount === 1 && card.orderNumbers === card.purchaseOrderNumber
  if (!canOpen || !own || !card.purchaseOrderId) return <Text span inherit>{card.orderNumbers}</Text>
  return (
    <Anchor component={Link} to={routes.purchaseOrder(card.purchaseOrderId)} inherit>
      {card.orderNumbers}
    </Anchor>
  )
}

/**
 * Where the card's container is now, in a line: the leg carrying it (its movement, truck or vessel, ETA - red when
 * late), the stay in progress, since when it stands at its place, when it was delivered or received, or that it is
 * followed by typed dates. Nothing when the group header says it already (a ship's containers: the group is the ship).
 */
export function WhereLine({ card, canOpenMovements }: { card: ShipmentCardDto; canOpenMovements: boolean }) {
  const where = whereOf(card, canOpenMovements)
  return where ? (
    <Text fz="xs" data-card-where>
      {where}
    </Text>
  ) : null
}

function whereOf(card: ShipmentCardDto, canOpenMovements: boolean): ReactNode {
  const eta = card.activeMovementEta ? (
    <Text span inherit c={card.isLate ? 'red.7' : undefined} fw={card.isLate ? 700 : undefined}>
      ETA {dateLabel(card.activeMovementEta)}
    </Text>
  ) : null
  if (card.phase === 'Received') return card.atPlaceSince ? `Received ${dateLabel(card.atPlaceSince)}` : 'Received'
  if (card.phase === 'Delivered') return card.atPlaceSince ? `Delivered ${dateLabel(card.atPlaceSince)}` : 'Delivered'
  if (card.activeMovementId) {
    const movement = <MovementRef id={card.activeMovementId} no={card.activeMovementNo} canOpen={canOpenMovements} />
    if (isStay(card.activeMovementStage)) {
      return (
        <>
          {movement} {card.activeMovementTypeName ?? ''}
          {card.atPlaceSince ? ` since ${dateLabel(card.atPlaceSince)}` : ''}
        </>
      )
    }
    // At sea the group is the ship (its number, vessel, route and ETA): the card says only what the group cannot.
    if (card.phase === 'AtSea' && card.groupKey.startsWith('MOV|')) return null
    return (
      <>
        {movement}
        {/* At the supplier the group is the port: the leg is named ("Loading at the supplier"). */}
        {card.phase === 'AtSupplier' && card.activeMovementTypeName ? ` ${card.activeMovementTypeName}` : ''}
        {card.activeMovementVehicleOrVessel ? ` · ${card.activeMovementVehicleOrVessel}` : ''}
        {eta ? ' · ' : ''}
        {eta}
      </>
    )
  }
  // In transit, at port or cleared by the dates typed on it (no leg yet): the server puts it in that column.
  if (card.followedByTypedDates) return 'Followed by typed dates'
  if ((card.movementCount ?? 0) === 0) return 'Not moved yet'
  return card.atPlaceSince ? `Since ${dateLabel(card.atPlaceSince)}` : null
}

/**
 * The badges of a card, in the order they matter: Late and Free time over (red: chase them), a draft, no container
 * number, Cleared (at the border or customs), the goods receipt (a draft waits; the number once received).
 */
export function CardBadges({ card, canViewReceipts }: { card: ShipmentCardDto; canViewReceipts: boolean }) {
  const receiptDraft = card.goodsReceiptStatus === 1 && card.goodsReceiptId ? card.goodsReceiptId : null
  const received = card.phase === 'Received' && card.goodsReceiptStatus === 2 && card.goodsReceiptId && card.goodsReceiptNumber
  const badges: ReactNode[] = []
  if (card.isLate) badges.push(<Badge key="late" size="xs" color="red" variant="filled">Late</Badge>)
  if (card.isFreeTimeOver)
    badges.push(
      <Tooltip key="free" label={card.lastFreeDay ? `Last free day ${dateLabel(card.lastFreeDay)}` : 'The free days at the port are over.'} withArrow>
        <Badge size="xs" color="red" variant="filled">
          Free time over
        </Badge>
      </Tooltip>,
    )
  if (card.status === 1) badges.push(<Badge key="draft" size="xs" color="gray" variant="light">Draft</Badge>)
  if (!card.containerNo) badges.push(<Badge key="no" size="xs" color="yellow" variant="light">No container no.</Badge>)
  if (card.phase === 'AtBorderCustoms' && card.status === 5) badges.push(<Badge key="cleared" size="xs" color="teal" variant="light">Cleared</Badge>)
  if (receiptDraft !== null)
    badges.push(
      canViewReceipts ? (
        <Badge key="grn" size="xs" color="violet" variant="light" component={Link} to={routes.goodsReceipt(receiptDraft)} style={{ cursor: 'pointer' }} data-card-grn-draft>
          GRN draft
        </Badge>
      ) : (
        <Badge key="grn" size="xs" color="violet" variant="light" data-card-grn-draft>
          GRN draft
        </Badge>
      ),
    )
  if (received)
    badges.push(
      canViewReceipts ? (
        <Badge key="grn" size="xs" color="green" variant="light" component={Link} to={routes.goodsReceipt(card.goodsReceiptId as number)} style={{ cursor: 'pointer' }}>
          {card.goodsReceiptNumber}
        </Badge>
      ) : (
        <Badge key="grn" size="xs" color="green" variant="light">
          {card.goodsReceiptNumber}
        </Badge>
      ),
    )
  if (badges.length === 0) return null
  return (
    <Group gap={4} wrap="wrap" data-card-badges>
      {badges}
    </Group>
  )
}

/** "Planned next: MOV-2026-000051 Inland transport → Kasumbalesa" (a stay: "at Kasumbalesa"). */
export function PlannedNext({ card, canOpenMovements }: { card: ShipmentCardDto; canOpenMovements: boolean }) {
  if (!card.plannedMovementId) return null
  const where = card.plannedMovementToName
    ? isStay(card.plannedMovementStage)
      ? ` at ${card.plannedMovementToName}`
      : ` → ${card.plannedMovementToName}`
    : ''
  return (
    <Text fz="xs" c="dimmed" data-card-planned>
      Planned next: <MovementRef id={card.plannedMovementId} no={card.plannedMovementNo} canOpen={canOpenMovements} /> {card.plannedMovementTypeName ?? ''}
      {where}
    </Text>
  )
}

/**
 * The card's next step: "Next step: Arrived at Dar es Salaam…", a link that opens phase 2's dialog. A step that cannot
 * be taken now reads dimmed with its reason under it, in words (a phone shows no tooltip) - the Containers list's Next
 * step column says it the same way.
 */
export function NextStepLink({ step, onStep, prefix = true }: { step: NextStepAction | null; onStep(): void; prefix?: boolean }) {
  if (!step) return null
  // Under a "Next step" column heading the label goes alone.
  const label = step.kind === 'Done' ? (prefix ? 'Next step: journey over' : 'Journey over') : prefix ? `Next step: ${step.label}` : step.label
  if (step.disabledReason) {
    return (
      <Stack gap={0} data-card-next-step={step.kind ?? ''} data-card-next-step-blocked>
        <Text fz="xs" c="dimmed" fw={600}>
          {label}
        </Text>
        <Text fz="xs" c="dimmed">
          {step.disabledReason}
        </Text>
      </Stack>
    )
  }
  return (
    <Anchor component="button" type="button" fz="xs" fw={600} ta="left" onClick={onStep} data-card-next-step={step.kind ?? ''}>
      {label}
    </Anchor>
  )
}

/**
 * ONE CONTAINER ON THE SHIPMENTS BOARD (script 82): its ref and number, type, what it carries, its supplier and order,
 * where it is (the leg, the stay, the place), the badges to chase (Late, Free time over, a draft, no number, Cleared, the
 * goods receipt), the planned next leg, and its next step in phase 2's words.
 *
 * Clicking the card opens the drawer (its route and its next step); its box, its links and its step answer on their own.
 * The ref is a button too, so the drawer is reached from the keyboard.
 */
export function ShipmentCard({ card, selected, onToggle, onOpen, step, onStep, links }: ShipmentCardProps) {
  return (
    <Paper
      withBorder
      radius="md"
      p={6}
      shadow={selected ? 'sm' : undefined}
      bg={selected ? 'var(--mantine-color-brand-0)' : undefined}
      style={{ cursor: 'pointer', borderColor: selected ? 'var(--mantine-color-brand-5)' : undefined }}
      onClick={(event: MouseEvent) => {
        if (!fromControl(event)) onOpen()
      }}
      data-shipment-card={card.containerRef}
      data-selected={selected || undefined}
    >
      <Stack gap={3}>
        <Group gap={6} wrap="nowrap" align="center" style={{ minWidth: 0 }}>
          {onToggle ? (
            <Checkbox size="xs" aria-label={`Select ${card.containerRef}`} checked={selected} onChange={(e) => onToggle(e.currentTarget.checked)} />
          ) : null}
          <Anchor component="button" type="button" fz={13} fw={700} c="dark" onClick={onOpen} style={{ overflowWrap: 'anywhere', textAlign: 'left' }}>
            {card.containerRef}
          </Anchor>
        </Group>
        <Text fz="xs" c="dimmed">
          {card.containerNo ? `${card.containerNo} · ` : ''}
          {card.containerTypeCode}
        </Text>
        <Text fz="xs">{itemsText(card)}</Text>
        {/* The supplier on one line (the whole name on hover), the order on its own: a number never breaks in two. */}
        {card.supplierNames ? (
          <Text fz="xs" c="dimmed" truncate="end" title={card.supplierNames}>
            {card.supplierNames}
          </Text>
        ) : null}
        {card.orderNumbers ? (
          <Text fz="xs" c="dimmed" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <OrderRef card={card} canOpen={links.orders} />
          </Text>
        ) : null}
        <WhereLine card={card} canOpenMovements={links.movements} />
        <CardBadges card={card} canViewReceipts={links.receipts} />
        <PlannedNext card={card} canOpenMovements={links.movements} />
        {card.phase === 'Received' ? null : <NextStepLink step={step} onStep={onStep} />}
      </Stack>
    </Paper>
  )
}
