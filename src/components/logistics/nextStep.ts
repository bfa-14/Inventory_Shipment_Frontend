import type { ContainerNextStepFilter, ContainerNextStepKind, ContainerShipState, NextLegProposalSource } from '../../api/logistics/containers'
import type { ContainerNextStepDto, NextStepGroupDto } from '../../api/logistics/nextStep'
import type { MovementStage } from '../../api/masterdata/movementTypes'
import { formatNumber } from '../format'
import { isStay } from './shipStep'

/**
 * THE WORDS OF A CONTAINER'S NEXT STEP (script 81, shipment phase 2). The server says which step it is (`nextStepKind`,
 * `nextStepBlockedReason`, the movement in progress or planned, the proposed next leg); this file only words it, so the
 * container's button, its row's "…" menu, the list's Next step column and the dialogs can never disagree.
 */

/** What the label reads of a container: a list row and the container page both carry it. */
export interface NextStepContainer extends ContainerShipState {
  id: number
  containerRef: string
  status: number
}

/** A draft starts a leg only once confirmed: the reason a reader without containers.confirm reads. */
export const DRAFT_NOT_CONFIRMABLE = 'This container is a draft: someone who may confirm containers must confirm it first.'

/** The hint under "One movement for the group / One per container". */
export const ONE_PER_CONTAINER_HINT = 'One per container: each truck arrives on its own day.'

/* ── completing a leg: the words by the stage of its type ───────────────────────────────────── */

export interface CompleteWords {
  /** "Arrived at Dar es Salaam" - the button (with "…") and the dialog's title. */
  title: string
  /** "Arrival date". */
  dateLabel: string
  /** "Record arrival". */
  button: string
}

/**
 * "Arrived at {To}" (Sea, Transit), "Cleared customs at {place}", "Crossed the border at {place}", "Left the port of
 * {place}", "Loaded at the supplier", "Delivered to {To}". A stay happens at one place: its To is its place.
 */
export function completeWords(stage: string | null | undefined, toName: string | null | undefined): CompleteWords {
  const place = toName ?? 'its place'
  switch (stage as MovementStage | null | undefined) {
    case 'Customs':
      return { title: `Cleared customs at ${place}`, dateLabel: 'Clearance date', button: 'Record clearance' }
    case 'Border':
      return { title: `Crossed the border at ${place}`, dateLabel: 'Crossing date', button: 'Record crossing' }
    case 'Port':
      return { title: `Left the port of ${place}`, dateLabel: 'Departure date', button: 'Record departure' }
    case 'Origin':
      return { title: 'Loaded at the supplier', dateLabel: 'Loading date', button: 'Record loading' }
    case 'Delivery':
      return { title: `Delivered to ${place}`, dateLabel: 'Delivery date', button: 'Record delivery' }
    default:
      return { title: `Arrived at ${place}`, dateLabel: 'Arrival date', button: 'Record arrival' }
  }
}

/* ── a new leg ──────────────────────────────────────────────────────────────────────────────── */

/**
 * "Inland transport to Kasumbalesa" (a leg that moves), "Customs clearance at Kasumbalesa" (a stay), "Next leg from Dar
 * es Salaam" (nothing to suggest, or no To to suggest).
 */
export function newLegTitle(leg: {
  typeName: string | null | undefined
  stage: string | null | undefined
  isStay?: boolean | null
  toName: string | null | undefined
  placeName: string | null | undefined
}): string {
  const stay = leg.isStay ?? isStay(leg.stage)
  if (leg.typeName && stay) return `${leg.typeName} at ${leg.toName ?? leg.placeName ?? 'its place'}`
  if (leg.typeName && leg.toName) return `${leg.typeName} to ${leg.toName}`
  return leg.placeName ? `Next leg from ${leg.placeName}` : 'Next leg'
}

/** "Suggested: the usual next leg from Dar es Salaam (5 earlier legs)" - where the proposal came from. */
export function proposalSourceText(
  source: NextLegProposalSource | null | undefined,
  legs: number | null | undefined,
  placeName: string | null | undefined,
  hasTo: boolean,
): string {
  if (!hasTo || source === 'None' || !source) return 'Choose the To'
  switch (source) {
    case 'History':
      return `Suggested: the usual next leg from ${placeName ?? 'here'} (${formatNumber(legs ?? 0)} earlier leg${legs === 1 ? '' : 's'})`
    case 'Ports':
      return "Suggested from the container's ports"
    default:
      return 'Suggested from the stages'
  }
}

/** "Then start Customs clearance at Kasumbalesa on the same day" / "Then start Inland transport Dar es Salaam → Kasumbalesa …". */
export function thenLabel(then: {
  thenTypeName: string | null
  thenStage: string | null
  thenIsStay: boolean | null
  thenFromName: string | null
  thenToName: string | null
}): string {
  const stay = then.thenIsStay ?? isStay(then.thenStage)
  const type = then.thenTypeName ?? 'the next leg'
  if (stay) return `Then start ${type} at ${then.thenToName ?? then.thenFromName ?? 'the arrival place'} on the same day`
  if (then.thenToName) return `Then start ${type} ${then.thenFromName ?? ''} → ${then.thenToName} on the same day`.replace('  ', ' ')
  return `Then start ${type} from ${then.thenFromName ?? 'the arrival place'} on the same day`
}

/** A Then leg that moves needs its To: without one the server would only warn "choose the To". */
export function thenNeedsTo(then: { thenTypeId: number | null; thenIsStay: boolean | null; thenStage: string | null; thenToPlaceId: number | null }): boolean {
  return then.thenTypeId !== null && !(then.thenIsStay ?? isStay(then.thenStage)) && then.thenToPlaceId === null
}

/* ── the step of a container ────────────────────────────────────────────────────────────────── */

export interface NextStepAction {
  kind: ContainerNextStepKind | null
  /** "Inland transport to Kasumbalesa…", "Arrived at Dar es Salaam…", "Receive goods…". */
  label: string
  /** Why it cannot be taken now; null when it can. */
  disabledReason: string | null
}

/** True for the steps the Next step dialogs take (a movement); Receive goods… has its own dialogs. */
export function isMovementStep(kind: ContainerNextStepKind | null | undefined): kind is 'Complete' | 'StartPlanned' | 'Ship' | 'NextLeg' {
  return kind === 'Complete' || kind === 'StartPlanned' || kind === 'Ship' || kind === 'NextLeg'
}

/** The label of a container's next step, with its "…" (a dialog opens). Null when the API does not say (an older one). */
export function nextStepOf(container: NextStepContainer): NextStepAction | null {
  const kind = container.nextStepKind ?? null
  if (container.nextStepKind === undefined) return null
  const blocked = container.nextStepBlockedReason ?? null
  switch (kind) {
    case 'Complete':
      return {
        kind,
        label: `${completeWords(container.activeMovementStage, container.activeMovementToName).title}…`,
        disabledReason: blocked,
      }
    case 'StartPlanned':
      return { kind, label: `Start ${container.plannedMovementTypeName ?? 'the planned leg'}…`, disabledReason: blocked }
    case 'Ship':
      return { kind, label: 'Start shipment…', disabledReason: blocked }
    case 'NextLeg':
      return {
        kind,
        label: `${newLegTitle({
          typeName: container.proposedTypeName,
          stage: container.proposedStage,
          isStay: container.proposedIsStay,
          toName: container.proposedToName,
          placeName: container.placeName,
        })}…`,
        disabledReason: blocked,
      }
    case 'Receive':
      return { kind, label: 'Receive goods…', disabledReason: blocked }
    case 'OpenReceipt':
      return { kind, label: 'Open goods receipt (draft)', disabledReason: blocked }
    default:
      return { kind: 'Done', label: 'Next step…', disabledReason: blocked ?? 'This container cannot move on now.' }
  }
}

/** The list's Next step column: the label without its "…" (nothing opens from a cell). */
export function nextStepColumnText(container: NextStepContainer): string {
  const step = nextStepOf(container)
  if (!step) return ''
  if (step.kind === 'Done') return 'Journey over'
  return step.label.replace(/…$/, '')
}

/** The Next step filter of the Containers list: the logistics to-do list, worked out on the server. */
export const NEXT_STEP_FILTERS: { value: ContainerNextStepFilter; label: string }[] = [
  { value: 'Ship', label: 'Start shipment' },
  { value: 'StartPlanned', label: 'Start planned leg' },
  { value: 'Complete', label: 'Arrival due' },
  { value: 'NextLeg', label: 'Next leg to plan' },
  { value: 'Receive', label: 'Receive goods' },
]

/** "KTG-2026-0031: Received into …" unless the reason names the container already, with one full stop. */
export function withRef(ref: string, reason: string): string {
  const text = /[.)]$/.test(reason.trim()) ? reason.trim() : `${reason.trim()}.`
  return text.includes(ref) ? text : `${ref}: ${text}`
}

/**
 * Why a ticked container cannot move on with "Next step…" (the selection bar), null when it can: the refusals the
 * preview would give, said before the click.
 */
export function nextStepRefusal(container: NextStepContainer, canConfirm: boolean): string | null {
  const kind = container.nextStepKind
  if (kind === undefined) return null
  if (kind === 'Receive' || kind === 'OpenReceipt') return `${container.containerRef} is delivered: its goods are received next (Receive goods…).`
  if (!isMovementStep(kind)) return withRef(container.containerRef, container.nextStepBlockedReason ?? 'its journey is over')
  if (container.nextStepBlockedReason) return withRef(container.containerRef, container.nextStepBlockedReason)
  if (container.status === 1 && !canConfirm) return `${container.containerRef} is a draft: someone who may confirm containers must confirm it first.`
  return null
}

/* ── the groups of the bulk dialog ──────────────────────────────────────────────────────────── */

/** The step of a group, as the groups table reads it: "Arrived at Dar es Salaam", "Inland transport to Kasumbalesa". */
export function groupStepLabel(group: NextStepGroupDto): string {
  switch (group.kind) {
    case 'Complete':
      return completeWords(group.movementStage, group.toName).title
    case 'StartPlanned':
      return `Start ${group.movementTypeName ?? 'the planned leg'}`
    case 'Ship':
      return group.movementTypeName ? `Start shipment: ${group.movementTypeName}` : 'Start shipment'
    default:
      return newLegTitle({ typeName: group.movementTypeName, stage: group.movementStage, isStay: group.isStay, toName: group.toName, placeName: group.placeName ?? group.fromName })
  }
}

/** "Chennai → Dar es Salaam", "at Kasumbalesa", "Dar es Salaam → (choose the To)". */
export function groupRoute(group: { fromName: string | null; toName: string | null; isStay: boolean; isNewLeg: boolean; placeName?: string | null }): string {
  const from = group.fromName ?? group.placeName ?? '—'
  if (group.isStay) return `at ${group.toName ?? from}`
  return `${from} → ${group.toName ?? (group.isNewLeg ? 'choose the To' : '—')}`
}

/** "MOV-2026-000046 Sea freight: Chennai → Dar es Salaam, started 20/09/2026, ETA 12/10/2026." */
export function movementLine(step: Pick<ContainerNextStepDto, 'movementNo' | 'movementTypeName' | 'movementFromName' | 'movementToName' | 'movementFromPlaceId' | 'movementToPlaceId' | 'movementStartDate' | 'movementPlannedDate' | 'movementEta' | 'movementStatus'>, day: (value: string | null) => string): string {
  const route =
    step.movementFromPlaceId !== null && step.movementFromPlaceId === step.movementToPlaceId
      ? `at ${step.movementToName ?? ''}`
      : `${step.movementFromName ?? ''} → ${step.movementToName ?? ''}`
  const when =
    step.movementStatus === 2 && step.movementStartDate
      ? `, started ${day(step.movementStartDate)}`
      : step.movementPlannedDate
        ? `, planned for ${day(step.movementPlannedDate)}`
        : ''
  const eta = step.movementEta ? `, ETA ${day(step.movementEta)}` : ''
  return `${step.movementNo ?? ''} ${step.movementTypeName ?? ''}: ${route}${when}${eta}.`
}
