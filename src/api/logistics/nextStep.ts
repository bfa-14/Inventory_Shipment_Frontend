import { request } from '../http'
import type { MovementReceiptResultDto } from '../purchase/goodsReceipts'
import type { ContainerNextStepKind, NextLegProposalSource } from './containers'

/**
 * THE NEXT STEP OF A CONTAINER (script 81, shipment phase 2): one "Next step…" for one container or 300, already filled
 * in. The server says what each container's step is, proposes its next leg (the usual one from where it is, else its own
 * ports, else the stage order) and groups many containers by step. Applying a step never goes around a movement: a
 * Complete or a Start is the movement's own (a completed Delivery still drafts its goods receipts after the commit), a
 * new leg is saved and started with the movement procedures, so every rule of phase 1 holds.
 *
 * Reading one container's step needs containers.view; the preview and applying need containers.movements.manage (a
 * draft is confirmed first only with containers.confirm).
 */
const BASE = '/api/logistics/containers'

/** The steps a group can apply: Receive goods… has its own dialogs. */
export type ApplicableNextStepKind = 'Complete' | 'StartPlanned' | 'Ship' | 'NextLeg'

/** The next step of one container (GET …/{id}/next-step, and one row per container of the preview). */
export interface ContainerNextStepDto {
  containerId: number
  /** False for an id that names no container ("Not found"). */
  found: boolean
  containerRef: string | null
  containerNo: string | null
  status: number | null
  statusName: string | null
  /** Null for an unknown id. */
  kind: ContainerNextStepKind | null
  /** Why the step cannot be taken at all ("Received into Lubumbashi Warehouse: the journey is over."). */
  blockedReason: string | null
  /** A draft: confirmed first (with containers.confirm), the blue alert. */
  isDraft: boolean
  /** False: the yellow "no container number" alert. */
  hasContainerNo: boolean
  /** Never moved, with dispatch / arrival dates typed by hand: the movements' dates will replace them (orange alert). */
  hasTypedDates: boolean

  /* where it is */
  movementCount: number | null
  placeId: number | null
  placeName: string | null
  placeKind: string | null
  placeSince: string | null
  /** The stage of its last leg; null when it never moved. */
  lastStage: string | null
  lastMovementId: number | null
  lastMovementNo: string | null
  lastMovementEndDate: string | null

  /* the movement of the step (Complete: the one in progress; StartPlanned: the planned one) */
  movementId: number | null
  movementNo: string | null
  /** Sent back with the step: a movement changed since is refused (409). */
  movementRowVersion: string | null
  movementStatus: number | null
  movementTypeId: number | null
  movementTypeCode: string | null
  movementTypeName: string | null
  movementStage: string | null
  movementFromPlaceId: number | null
  movementFromName: string | null
  movementToPlaceId: number | null
  movementToName: string | null
  movementPlannedDate: string | null
  movementStartDate: string | null
  movementEta: string | null
  /** How many containers the movement carries: "All 12 containers of MOV-… arrive too". */
  movementContainerCount: number | null
  /** The earliest date of the step: Complete its start, StartPlanned the end of the previous leg. */
  movementNotBefore: string | null

  /* its goods receipt (Receive, OpenReceipt) */
  goodsReceiptId: number | null
  goodsReceiptNumber: string | null
  goodsReceiptStatus: number | null

  /* the proposed new leg (Ship, NextLeg) */
  proposedTypeId: number | null
  proposedTypeCode: string | null
  proposedTypeName: string | null
  proposedStage: string | null
  proposedFromPlaceId: number | null
  proposedFromName: string | null
  /** Null on a leg that moves: "Choose the To". */
  proposedToPlaceId: number | null
  proposedToName: string | null
  proposalSource: NextLegProposalSource | null
  /** With History: how many earlier legs it is based on. */
  proposalLegs: number | null
  proposedIsStay: boolean | null
  /** The bulk dialog's default: one movement per container for a truck leg. */
  proposedOnePerContainer: boolean | null

  /* the leg proposed after the movement it completes (the "Then" box; never after a Delivery) */
  thenTypeId: number | null
  thenTypeCode: string | null
  thenTypeName: string | null
  thenStage: string | null
  thenFromPlaceId: number | null
  thenFromName: string | null
  thenToPlaceId: number | null
  thenToName: string | null
  thenSource: NextLegProposalSource | null
  thenLegs: number | null
  thenIsStay: boolean | null
  /** Ticked by default: a stay at the arrival place, or the leg after Customs / Border. */
  thenDefault: boolean

  /* the shipping details a new leg starts from */
  vesselName: string | null
  voyageNo: string | null
  shippingLine: string | null
  blNo: string | null
  blDate: string | null
  truckNo: string | null
  containerEta: string | null
  orderNumbers: string | null
  supplierNames: string | null

  /* the preview */
  /** The "Cannot move on" heading it falls under; null when it can move on. */
  blockGroup: string | null
  canMove: boolean
  /** Its group in the preview's groups: an opaque key. */
  groupKey: string | null
}

/** Ticked containers that move on together: the same step, movement, type, From and To. */
export interface NextStepGroupDto {
  groupKey: string
  kind: ApplicableNextStepKind
  /** Complete / StartPlanned: the movement; null for a new leg ("new"). */
  movementId: number | null
  movementNo: string | null
  movementRowVersion: string | null
  /** The movement's type, or the proposed one for a new leg. */
  movementTypeId: number | null
  movementTypeCode: string | null
  movementTypeName: string | null
  movementStage: string | null
  fromPlaceId: number | null
  fromName: string | null
  toPlaceId: number | null
  toName: string | null
  isNewLeg: boolean
  isStay: boolean
  movementStartDate: string | null
  movementPlannedDate: string | null
  movementEta: string | null
  /** The ticked containers of the group. */
  containers: number
  /** How many the movement carries: more than `containers` on a Complete means the others arrive too. */
  movementContainerCount: number | null
  /** The earliest date for every container of the group. */
  notBefore: string | null
  placeName: string | null
  proposalSource: NextLegProposalSource | null
  proposalLegs: number | null
  /** The default of "One movement for the group" / "One per container". */
  onePerContainer: boolean
  drafts: number
  withoutContainerNo: number
  withTypedDates: number
  orderCount: number | null
  supplierCount: number | null
  orderNumbers: string | null
  supplierNames: string | null
  /** "Then start the suggested next leg on the same day" (Complete groups): how many get a next leg after it. */
  thenContainers: number
  /** Every container of the group gets the same next leg: the fields below describe it. */
  thenSame: boolean
  thenTypeId: number | null
  thenTypeName: string | null
  thenStage: string | null
  thenFromPlaceId: number | null
  thenFromName: string | null
  thenToPlaceId: number | null
  thenToName: string | null
  thenIsStay: boolean | null
  thenSource: NextLegProposalSource | null
  thenLegs: number | null
  thenDefault: boolean
}

/** The ticked containers that cannot move on, by reason ("Received, closed or cancelled (12)"). */
export interface NextStepBlockedDto {
  blockGroup: string
  containers: number
  /** The first five refs. */
  containerRefs: string | null
}

export interface NextStepPreviewDto {
  containers: ContainerNextStepDto[]
  groups: NextStepGroupDto[]
  blocked: NextStepBlockedDto[]
}

/** One container's truck no. (or vessel) and ETA when a group goes one movement per container. */
export interface NextStepLegContainerRequest {
  containerId: number
  vehicleOrVessel?: string | null
  eta?: string | null
}

/** "Then start Customs clearance at Kasumbalesa on the same day": the leg made once the containers arrived. */
export interface NextStepThenRequest {
  /** False = plan it only. */
  startNow: boolean
  /** Null = the completion's date. */
  date?: string | null
  /** Null = the proposed type. */
  movementTypeId?: number | null
  /** Null = the proposed To (a stay: the place). */
  toPlaceId?: number | null
  /** Null = the proposal's default. */
  onePerContainer?: boolean | null
}

/**
 * One step for a group of containers. Complete / StartPlanned: the movement and its row version from the preview, the
 * date the end / start date. Ship / NextLeg: a new leg from where the containers are; type and To left out = the
 * proposal's; startNow false plans it for the date.
 */
export interface NextStepGroupRequest {
  /** Echoed on the result. */
  key?: string | null
  kind: ApplicableNextStepKind
  movementId?: number | null
  rowVersion?: string | null
  containerIds: number[]
  movementTypeId?: number | null
  fromPlaceId?: number | null
  toPlaceId?: number | null
  startNow?: boolean
  /** 'YYYY-MM-DD'; null = today. */
  date?: string | null
  eta?: string | null
  carrierPartyId?: number | null
  vehicleOrVessel?: string | null
  voyageNo?: string | null
  reference?: string | null
  blNo?: string | null
  blDate?: string | null
  notes?: string | null
  onePerContainer?: boolean
  perContainer?: NextStepLegContainerRequest[] | null
  copyToContainers?: boolean
  then?: NextStepThenRequest | null
}

export interface NextStepMovementDto {
  id: number
  movementNo: string
  status: number
  statusName: string
  /** One per container: its container. */
  containerId: number | null
  containerRef: string | null
}

/** The result of one group, in the order of the request: 200 whatever the groups gave. */
export interface NextStepGroupResultDto {
  key: string | null
  kind: string
  ok: boolean
  /** The refusal's code (CONTAINER_BUSY, START_BEFORE_PREVIOUS_LEG, CONCURRENCY, NEXT_STEP_CHANGED…). */
  code: string | null
  /** What happened ("KTG-2026-0031: arrived at Dar es Salaam on 17/10/2026 (MOV-2026-000046). Now At Port."), or why not. */
  message: string
  containerIds: number[]
  /** The movement completed or started, or the new legs created. */
  movements: NextStepMovementDto[]
  /** The legs the "Then" box started (or planned). */
  thenMovements: NextStepMovementDto[]
  /** A completed Delivery: the draft goods receipts made after the commit. */
  goodsReceipts: MovementReceiptResultDto[] | null
  goodsReceiptsMessage: string | null
  /** Beside a step that was applied: a draft goods receipt not made, a Then leg refused ("Arrival recorded; …"). */
  warnings: string[]
}

export const nextStepApi = {
  /** One container's next step, the movement it concerns (with its row version), the proposal and the Then leg. */
  get: (containerId: number, signal?: AbortSignal) => request<ContainerNextStepDto>(`${BASE}/${containerId}/next-step`, { signal }),

  /** 1 to 5,000 ticked containers: one row each, the groups that move on together, the ones that cannot. Saves nothing. */
  preview: (containerIds: number[], signal?: AbortSignal) =>
    request<NextStepPreviewDto>(`${BASE}/next-step/preview`, { method: 'POST', body: { containerIds }, signal }),

  /** Each group on its own, all or nothing inside: one result per group, in order. */
  apply: (groups: NextStepGroupRequest[]) =>
    request<NextStepGroupResultDto[]>(`${BASE}/next-step`, { method: 'POST', body: { groups } }),
}
