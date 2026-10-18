import type { ContainerShipState, ContainerShipStep } from '../../api/logistics/containers'
import { SINGLE_PLACE_STAGES, type MovementStage } from '../../api/masterdata/movementTypes'
import { portLabel, type PortLookupDto } from '../../api/masterdata/ports'

/**
 * A container's next step (script 80): the one button of its page and the first entry of its row's "…" menu. The server
 * says which step it is (`shipStep`) and why it cannot be taken now (`shipStepBlockedReason`); this file only words it,
 * so the page and the list can never disagree.
 */

/** What the label and the dialogs read of a container: a list row and the container page both carry it. */
export interface ShipStepContainer extends ContainerShipState {
  id: number
  containerRef: string
  status: number
}

export interface ShipAction {
  /** Null = the journey is over (received, closed, cancelled): the action is shown disabled. */
  step: ContainerShipStep | null
  label: string
  /** Why it cannot be taken now; null when it can. */
  disabledReason: string | null
  /** The movement it starts or completes. */
  movementId: number | null
}

/** A draft ships only with someone who may confirm it: the shipment confirms it first. */
export const DRAFT_NEEDS_CONFIRM = 'This container is a draft: someone who may confirm containers must confirm it first.'

/** A stay happens at one place - a port call, customs clearance, a border crossing: its To is its From. */
export function isStay(stage: string | null | undefined): boolean {
  return stage != null && SINGLE_PLACE_STAGES.includes(stage as MovementStage)
}

/** "Arrived at Dar es Salaam…" for a leg that moves, "Complete Customs clearance…" for a stay. */
export function completeLabel(stage: string | null | undefined, typeName: string | null | undefined, toName: string | null | undefined): string {
  return isStay(stage) || !toName ? `Complete ${typeName ?? 'movement'}…` : `Arrived at ${toName}…`
}

/**
 * The container's next step as a button: "Start shipment…" (never moved), "Start Inland transport…" (its next planned
 * movement), "Arrived at Dar es Salaam…" / "Complete Customs clearance…" (a movement in progress carries it), "Next leg…"
 * (its last movement is completed). Null when the API does not say (an older one).
 */
export function shipActionOf(container: ShipStepContainer, options: { canConfirm: boolean }): ShipAction | null {
  if (container.shipStep === undefined && container.movementCount === undefined) return null
  const step = container.shipStep ?? null
  const blocked = container.shipStepBlockedReason ?? null
  switch (step) {
    case 'Complete':
      return {
        step,
        label: completeLabel(container.activeMovementStage, container.activeMovementTypeName, container.activeMovementToName),
        disabledReason: blocked,
        movementId: container.activeMovementId ?? null,
      }
    case 'Start':
      return {
        step,
        label: `Start ${container.plannedMovementTypeName ?? 'movement'}…`,
        disabledReason: blocked,
        movementId: container.plannedMovementId ?? null,
      }
    case 'Ship':
      return {
        step,
        label: 'Start shipment…',
        disabledReason: blocked ?? (container.status === 1 && !options.canConfirm ? DRAFT_NEEDS_CONFIRM : null),
        movementId: null,
      }
    case 'NextLeg':
      return { step, label: 'Next leg…', disabledReason: blocked, movementId: null }
    default:
      return {
        step: null,
        label: (container.movementCount ?? 0) === 0 ? 'Start shipment…' : 'Next leg…',
        disabledReason: blocked ?? 'This container cannot move on now.',
        movementId: null,
      }
  }
}

/**
 * Why a ticked container cannot go on a new shipment (the selection bar's "Start shipment…"), null when it can: the
 * refusals the server would give after the click, said before it.
 */
export function shipRefusal(container: ShipStepContainer & { containerNo?: string | null }, canConfirm: boolean): string | null {
  if (container.status >= 6) return `${container.containerRef} is already received, closed or cancelled.`
  if (container.activeMovementId) return `${container.containerRef} is travelling with ${container.activeMovementNo ?? 'a movement'}: complete it first.`
  if (container.plannedMovementId)
    return `${container.containerRef} already has its next movement planned (${container.plannedMovementNo ?? 'planned'}): start that one.`
  if (container.status === 1 && !canConfirm) return `${container.containerRef} is a draft: someone who may confirm containers must confirm it first.`
  return null
}

/** The order the place pickers group by: sea ports, then border posts, then inland places (then anything else). */
const KIND_ORDER = ['Sea', 'Border', 'Inland', 'Air']
const KIND_LABELS: Record<string, string> = { Sea: 'Sea ports', Border: 'Border posts', Inland: 'Inland places', Air: 'Airports' }

type Option = { value: string; label: string }

/**
 * The places of a picker grouped Sea / Border / Inland, so a border post is never taken for the sea port of the same
 * town. Inactive places are left out, except the ones already chosen (`keep`).
 */
export function placeOptionGroups(ports: PortLookupDto[], keep: (string | null | undefined)[] = []): { group: string; items: Option[] }[] {
  const kinds = new Map<string, Option[]>()
  for (const p of ports) {
    if (!p.isActive && !keep.includes(String(p.id))) continue
    const list = kinds.get(p.kind) ?? []
    list.push({ value: String(p.id), label: `${p.portCode} - ${portLabel(p)}` })
    kinds.set(p.kind, list)
  }
  const rank = (kind: string) => {
    const index = KIND_ORDER.indexOf(kind)
    return index === -1 ? KIND_ORDER.length : index
  }
  return [...kinds]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([kind, items]) => ({ group: KIND_LABELS[kind] ?? kind, items }))
}

/** "From" is locked to where the container is: the hint under it. */
export const FROM_LOCKED_HINT = 'A container leaves from where it is.'
