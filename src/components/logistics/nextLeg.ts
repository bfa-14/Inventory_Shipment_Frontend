import { MOVEMENT_STAGES, type MovementTypeLookupDto } from '../../api/masterdata/movementTypes'
import { dateLabel } from '../documents/documentKind'
import { todayDateOnly } from '../format'
import { isStay } from './shipStep'

/**
 * A NEW LEG AS THE NEXT STEP DIALOGS TYPE IT (script 81): the fields of the one-container dialog and of a group of the
 * bulk dialog ("Edit…"), and the rules both apply before the click. Kept apart from the components (Fast Refresh: a
 * component file exports components only).
 */

export type StartMode = 'start' | 'plan'

export interface LegValues {
  typeId: string | null
  /** Only for Loading at the supplier, whose From is free (its To is the port of loading). */
  fromId: string | null
  /** A stay (Port, Customs, Border) takes the place: To = From. */
  toId: string | null
  startMode: StartMode
  /** 'YYYY-MM-DD' */
  date: string | null
  eta: string | null
  carrierId: string | null
  vessel: string
  voyage: string
  reference: string
  blNo: string
  blDate: string | null
  notes: string
  /** Copy vessel, voyage, B/L and ETA (a truck leg: the truck no. and ETA) to the containers. */
  copyToContainers: boolean
}

/** The shipping details a container already has: what a Sea leg starts from, and a truck leg its truck no. */
export interface LegPrefill {
  vesselName?: string | null
  voyageNo?: string | null
  blNo?: string | null
  blDate?: string | null
  truckNo?: string | null
}

export const SEA = 'Sea'
export const ORIGIN = 'Origin'

/** A new leg filled with the proposal: its type and To, today, the container's vessel / voyage / B/L for a sea leg. */
export function initialLeg(proposal: { typeId: number | null; toPlaceId: number | null; stage: string | null; placeId: number | null }, prefill: LegPrefill): LegValues {
  const sea = proposal.stage === SEA
  return {
    typeId: proposal.typeId === null ? null : String(proposal.typeId),
    fromId: null,
    toId: isStay(proposal.stage) && proposal.placeId !== null ? String(proposal.placeId) : proposal.toPlaceId === null ? null : String(proposal.toPlaceId),
    startMode: 'start',
    date: todayDateOnly(),
    eta: null,
    carrierId: null,
    vessel: (sea ? prefill.vesselName : prefill.truckNo) ?? '',
    voyage: sea ? (prefill.voyageNo ?? '') : '',
    reference: '',
    blNo: sea ? (prefill.blNo ?? '') : '',
    blDate: sea ? (prefill.blDate?.slice(0, 10) ?? null) : null,
    notes: '',
    copyToContainers: true,
  }
}

/**
 * The leg after its type changed: the To proposed again - the proposal's own To when it is the proposed type again, the
 * place for a stay, the place (the port of loading) for Loading at the supplier, else to choose; the vessel / truck
 * field swaps between the container's vessel and its truck when the leg goes from sea to road or back.
 */
export function retypeLeg(
  values: LegValues,
  nextTypeId: string | null,
  types: MovementTypeLookupDto[],
  proposal: { typeId: number | null; toPlaceId: number | null; placeId: number | null },
  prefill: LegPrefill,
): LegValues {
  const before = types.find((t) => String(t.id) === values.typeId) ?? null
  const after = types.find((t) => String(t.id) === nextTypeId) ?? null
  const place = proposal.placeId === null ? null : String(proposal.placeId)
  const toId =
    after === null
      ? null
      : isStay(after.stage) || after.stage === ORIGIN
        ? place
        : proposal.typeId !== null && String(proposal.typeId) === nextTypeId
          ? proposal.toPlaceId === null
            ? null
            : String(proposal.toPlaceId)
          : null
  const wasSea = before?.stage === SEA
  const isSea = after?.stage === SEA
  const vessel = wasSea === isSea ? values.vessel : ((isSea ? prefill.vesselName : prefill.truckNo) ?? '')
  return {
    ...values,
    typeId: nextTypeId,
    toId,
    fromId: after?.stage === ORIGIN ? values.fromId : null,
    vessel,
    voyage: isSea ? values.voyage || (prefill.voyageNo ?? '') : values.voyage,
    blNo: isSea ? values.blNo || (prefill.blNo ?? '') : values.blNo,
    blDate: isSea ? (values.blDate ?? prefill.blDate?.slice(0, 10) ?? null) : values.blDate,
  }
}

/**
 * The movement types grouped by stage (Origin, Sea, Transit, Port, Border, Customs, Delivery), inactive ones left out.
 * Loading at the supplier only for containers that never moved: it leaves from the supplier, not from where they are.
 */
export function typeOptionGroups(types: MovementTypeLookupDto[], allowOrigin: boolean): { group: string; items: { value: string; label: string }[] }[] {
  return MOVEMENT_STAGES.map((stage) => ({
    group: stage.label,
    items: types
      .filter((t) => t.isActive && t.stage === stage.value && (allowOrigin || t.stage !== ORIGIN))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({ value: String(t.id), label: `${t.typeCode} - ${t.typeName}` })),
  })).filter((group) => group.items.length > 0)
}

/**
 * Why the date cannot be taken, null when it can. Starting now: not after today (dates are facts), not before the
 * containers got here (the end of their previous leg). Plan only takes any date.
 */
export function legDateProblem(values: Pick<LegValues, 'date' | 'startMode'>, notBefore: string | null, notBeforeMovementNo?: string | null): string | null {
  if (!values.date) return 'Choose the date.'
  if (values.startMode === 'plan') return null
  if (values.date > todayDateOnly()) return 'The start date cannot be in the future: choose Plan only for a later date.'
  const earliest = notBefore?.slice(0, 10) ?? null
  if (earliest && values.date < earliest)
    return `The leg cannot start before ${notBeforeMovementNo ?? 'the previous leg'} ended on ${dateLabel(earliest)}.`
  return null
}

/** Why the leg cannot be saved as typed (the type, the To of a leg that moves, the From of a loading), null when it can. */
export function legProblem(values: LegValues, types: MovementTypeLookupDto[]): string | null {
  const type = types.find((t) => String(t.id) === values.typeId) ?? null
  if (!type) return 'Choose the movement type.'
  if (type.stage === ORIGIN && !values.fromId) return 'Choose where from.'
  if (!isStay(type.stage) && !values.toId) return 'Choose where to.'
  return null
}
