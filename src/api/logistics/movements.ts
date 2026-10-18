import { fetchBlob, request } from '../http'
import type { MovementReceiptResultDto } from '../purchase/goodsReceipts'
import type { PagedResult } from '../types'
import { saveBlob, toQueryString, type ContainerReceiptRef } from './containers'

/**
 * Shipment movements (`api/logistics/movements`, MOV-yyyy-nnnnnn): one leg of the route carrying
 * one or more containers. Starting and completing a movement moves the containers' status, dates and
 * location by the stage of its type. Reading needs containers.view, the rest
 * containers.movements.manage. Every action answers with the movement re-read.
 *
 * COMPLETING A DELIVERY-STAGE MOVEMENT creates a DRAFT goods receipt for each eligible container (status 2-5, no open
 * receipt), after the completion is committed: the answer carries what happened per container (`goodsReceipts`), and
 * a failure there is a warning, never a failed completion. Cancelling a completed Delivery deletes the automatic
 * drafts it created (edited ones too); a draft made by hand is kept.
 */
const BASE = '/api/logistics/movements'

/** 1 Planned, 2 In progress, 3 Completed, 4 Cancelled. */
export type MovementStatusCode = 1 | 2 | 3 | 4

export const MOVEMENT_STATUSES: { value: MovementStatusCode; label: string; colour: string }[] = [
  { value: 1, label: 'Planned', colour: 'gray' },
  { value: 2, label: 'In Progress', colour: 'blue' },
  { value: 3, label: 'Completed', colour: 'green' },
  { value: 4, label: 'Cancelled', colour: 'red' },
]

export function movementStatusColour(status: number): string {
  return MOVEMENT_STATUSES.find((s) => s.value === status)?.colour ?? 'gray'
}

export interface MovementFlags {
  status: MovementStatusCode
  statusName: string
  canEdit: boolean
  canStart: boolean
  canComplete: boolean
  canCancel: boolean
  canDelete: boolean
  /**
   * (script 80) A planned movement: the refusal Start would give now (no container, a draft, a container travelling, its
   * previous leg not completed, not at the From); null when it can start. Optional: an older API sends none.
   */
  startBlockedReason?: string | null
  /** The earliest start date: the latest end of its containers' previous movements (refused before it, 70018). */
  startNotBefore?: string | null
  /** The movement that ended on that date, and where: "MOV-2026-000046 reached Dar es Salaam". */
  startNotBeforeMovementNo?: string | null
  startNotBeforePlaceName?: string | null
}

export interface MovementListDto extends MovementFlags {
  id: number
  movementNo: string
  movementTypeId: number
  typeCode: string
  typeName: string
  stage: string
  fromPlaceId: number
  fromCode: string
  fromName: string
  fromKind: string
  toPlaceId: number
  toCode: string
  toName: string
  toKind: string
  plannedDate: string | null
  startDate: string | null
  eta: string | null
  endDate: string | null
  carrierPartyId: number | null
  carrierName: string | null
  vehicleOrVessel: string | null
  voyageNo: string | null
  reference: string | null
  containerCount: number
  /** "KTG-2026-0006 +1" */
  containerRefs: string | null
  chargesPostedBase: number | null
  attachmentCount: number
  durationDays: number | null
  /** Planned or in progress and the ETA is behind us. */
  isLate: boolean
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  rowVersion: string
}

export interface MovementContainerDto extends MovementContainerReceiptInfo {
  containerId: number
  containerRef: string
  containerNo: string | null
  containerTypeCode: string
  containerStatus: number
  containerStatusName: string
  currentLocation: string | null
  totalAllocatedBase: number
  totalOilQty: number
  itemSummary: string | null
  supplierName: string | null
  chargesBase: number | null
  draftChargesBase: number | null
  attachmentCount: number
  containerRowVersion: string
}

/**
 * What a movement says about a container's goods receipt: the open one (draft or posted) and the container's own
 * warehouse, which an automatic draft proposes when it is active and in the container's branch.
 */
export interface MovementContainerReceiptInfo extends ContainerReceiptRef {
  /** The container's "Warehouse (offloading destination)". */
  warehouseCode?: string | null
  /** The warehouse is active, belongs to the container's branch and has no warehouse under it: the automatic draft takes it. */
  warehouseInBranch?: boolean | null
  /** Why the automatic draft will not take it ("LUB, the container's, has warehouses under it"); null when it will. */
  warehouseNote?: string | null
  /** The open receipt is a DRAFT made by the completion of THIS movement: cancelling the movement deletes it (rule 22). */
  autoDraftOfThisMovement?: boolean
  /** Set when the draft was changed after it was created (null when never edited): who and when, for the cancel dialog. */
  goodsReceiptUpdatedAtUtc?: string | null
  goodsReceiptUpdatedByName?: string | null
}

export interface MovementChargeDto {
  id: number
  containerId: number
  containerRef: string
  groupId: string | null
  chargeTypeId: number
  chargeCode: string
  chargeName: string
  description: string | null
  providerName: string | null
  reference: string | null
  chargeDate: string
  currencyCode: string
  amount: number
  amountBase: number
  allocationMethod: string
  includeInLandedCost: boolean
  /** 1 Draft, 2 Posted, 3 Cancelled. */
  status: number
  rowVersion: string
}

export interface MovementAttachmentDto {
  id: number
  containerId: number
  containerRef: string
  chargeId: number | null
  attachmentTypeId: number | null
  category: string | null
  subType: string | null
  fileId: number
  fileName: string
  contentType: string
  sizeBytes: number
  note: string | null
  documentDate: string | null
  groupId: string | null
  createdAtUtc: string
  createdByName: string | null
}

export interface MovementDto extends MovementFlags {
  id: number
  documentTypeId: number
  movementNo: string
  movementTypeId: number
  typeCode: string
  typeName: string
  stage: string
  fromPlaceId: number
  fromCode: string
  fromName: string
  fromCountry: string | null
  fromKind: string
  toPlaceId: number
  toCode: string
  toName: string
  toCountry: string | null
  toKind: string
  plannedDate: string | null
  startDate: string | null
  eta: string | null
  endDate: string | null
  cancelReason: string | null
  carrierPartyId: number | null
  carrierName: string | null
  vehicleOrVessel: string | null
  voyageNo: string | null
  reference: string | null
  notes: string | null
  startedAtUtc: string | null
  startedByName: string | null
  completedAtUtc: string | null
  completedByName: string | null
  cancelledAtUtc: string | null
  cancelledByName: string | null
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  updatedByName: string | null
  rowVersion: string
  isLate: boolean
  /**
   * (79) The goods receipt type's "Create goods receipts when a Delivery is completed" (Configuration › Document Types):
   * false, completing a Delivery drafts none - they are made by hand with Receive goods… on each container. Missing (an
   * older API) = true.
   */
  goodsReceiptsAutomatic?: boolean
  containers: MovementContainerDto[]
  charges: MovementChargeDto[]
  attachments: MovementAttachmentDto[]
  /**
   * Only on the answer to Complete of a Delivery-stage movement: per container, the draft goods receipt created, or
   * why none was (it already has one, not confirmed...).
   */
  goodsReceipts?: MovementReceiptResultDto[] | null
  /** The same, in one sentence: "Draft goods receipts created: KTG-2026-0031 (warehouse to choose). Not created: …". */
  goodsReceiptsMessage?: string | null
  /**
   * The drafts that could not be created (the movement IS completed): the whole call failed ("…were not created: {reason}.
   * Use Receive goods… on each container."), or one container's row ("{ref}: the draft goods receipt was not created…").
   */
  warnings?: string[]
}

/** (script 80) A planned movement a container can join: after its latest movement and at its place (`GET join-candidates`). */
export interface MovementJoinCandidateDto {
  id: number
  movementNo: string
  movementTypeId: number
  typeCode: string
  typeName: string
  stage: string
  fromPlaceId: number
  fromCode: string
  fromName: string
  toPlaceId: number
  toCode: string
  toName: string
  plannedDate: string | null
  eta: string | null
  status: MovementStatusCode
  carrierPartyId: number | null
  carrierName: string | null
  vehicleOrVessel: string | null
  containerCount: number
  /** "KTG-2026-0006 +1" */
  containerRefs: string | null
  /** What the save says of the container there: "Not moved yet - port of loading: Chennai.", "Draft: confirm it…". */
  note: string | null
  rowVersion: string
}

export interface SaveMovementRequest {
  movementTypeId: number
  fromPlaceId: number
  toPlaceId: number
  plannedDate: string | null
  /** Only while in progress; ignored on a planned movement. */
  startDate: string | null
  eta: string | null
  carrierPartyId: number | null
  vehicleOrVessel: string | null
  voyageNo: string | null
  reference: string | null
  notes: string | null
  containerIds: number[]
  rowVersion?: string | null
}

export interface MovementQuery {
  search?: string
  status?: MovementStatusCode
  movementTypeId?: number
  placeId?: number
  containerId?: number
  carrierPartyId?: number
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/**
 * One movement for the chosen containers: drafts confirmed, the movement created (default SEA, from
 * their common port of loading to their common port of destination) and started unless startNow is
 * false; vessel, voyage, B/L and ETA copied to the containers when updateContainers.
 */
export interface ShipContainersRequest {
  containerIds: number[]
  /** Null = SEA. */
  movementTypeId?: number | null
  /**
   * Null = where the containers are (script 80): the place they are all at once one of them moved, else (Sea, none moved)
   * their common port of loading.
   */
  fromPlaceId?: number | null
  /** Null = the common port of destination (Sea, none moved), the From for a stay (Port, Customs, Border). */
  toPlaceId?: number | null
  /** Null = today (the planned date when startNow is false). */
  startDate?: string | null
  eta?: string | null
  carrierPartyId?: number | null
  vehicleOrVessel?: string | null
  voyageNo?: string | null
  /** Booking, waybill… */
  reference?: string | null
  blNo?: string | null
  blDate?: string | null
  notes?: string | null
  startNow: boolean
  /** Honoured only with containers.confirm; the server refuses drafts by name otherwise. */
  confirmDrafts: boolean
  updateContainers: boolean
}

/** The movement created for the chosen containers. */
export interface ShippedMovementDto {
  id: number
  movementNo: string
  status: MovementStatusCode
  startDate: string | null
  plannedDate: string | null
  eta: string | null
  containerCount: number
  rowVersion: string
}

/**
 * The containers a movement can take (`GET container-candidates`, script 46), for the From on the page - saved or
 * not: the ones at that place (the end of their previous movement) and the ones that never moved. A container
 * starts a movement where its previous movement ends; the server refuses the others on Save (409
 * CONTAINER_NOT_AT_FROM) and refuses to Start while a previous movement is not completed (409 PREVIOUS_MOVEMENT_OPEN).
 */
export interface MovementContainerCandidateQuery {
  /** Undefined = a new movement. */
  movementId?: number
  fromPlaceId: number
  /** The To and the type on the page (script 49): an Origin-stage movement takes only containers that never moved. */
  toPlaceId?: number
  movementTypeId?: number
  search?: string
  purchaseOrderId?: number
  supplierId?: number
  status?: number
  /** Also the ones the save would refuse: canAdd false, with the reason. */
  includeBlocked?: boolean
  page?: number
  /** At most 5,000 (script 78). */
  pageSize?: number
}

export interface MovementContainerCandidateDto {
  id: number
  containerRef: string
  containerNo: string | null
  sealNo: string | null
  containerTypeCode: string
  /** Summaries: "PO-BR-002-000038 +1". */
  orderNumbers: string | null
  supplierNames: string | null
  itemSummary: string | null
  pieces: number
  status: number
  statusName: string
  eta: string | null
  /** Where its previous movement ends, or the port of loading of one that never moved (script 49). */
  placeName: string | null
  previousMovementNo: string | null
  portOfLoadingName: string | null
  canAdd: boolean
  /** Why it cannot be added: "At Beira (end of MOV-…), not at Durban.", "Not confirmed yet.", "Travelling with movement MOV-…". */
  reason: string | null
  /** On the ones that can: "Not moved yet - port of loading: Shanghai.", "On its way here with MOV-…", "Draft: confirm it…". */
  note: string | null
}

/** What the place rules judge a container against: the movement (null = new) and its From, To and type on the page. */
export interface MovementPlaceQuery {
  movementId: number | null
  fromPlaceId: number
  toPlaceId: number | null
  movementTypeId: number | null
}

export type ContainerMatchResult = 'Ready' | 'AlreadyOnMovement' | 'NotFound' | 'Ambiguous' | 'Blocked' | 'Duplicate'

/** One number of the list matched for a movement (`POST match-containers`); the container columns are null when none or two matched. */
export interface MovementContainerMatchDto {
  /** The position in the numbers sent, from 1 (empty ones get no row). */
  rowNo: number
  inputNumber: string
  result: ContainerMatchResult
  containerId: number | null
  containerRef: string | null
  containerNo: string | null
  containerTypeCode: string | null
  status: number | null
  statusName: string | null
  orderNumbers: string | null
  supplierNames: string | null
  itemSummary: string | null
  pieces: number | null
  placeName: string | null
  previousMovementNo: string | null
  portOfLoadingName: string | null
  /** AlreadyOnMovement: set when the saved container no longer passes the checks for this From. */
  reason: string | null
  note: string | null
}

export const movementsApi = {
  list: (query: MovementQuery, signal?: AbortSignal) =>
    request<PagedResult<MovementListDto>>(`${BASE}${toQueryString(query)}`, { signal }),

  get: (id: number, signal?: AbortSignal) => request<MovementDto>(`${BASE}/${id}`, { signal }),

  create: (payload: SaveMovementRequest) => request<MovementDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveMovementRequest) =>
    request<MovementDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  /**
   * date = start date (default today). 409 CONTAINER_BUSY when a container travels with another movement,
   * START_BEFORE_PREVIOUS_LEG before its previous leg ended; 400 for a date in the future (script 80).
   */
  start: (id: number, date: string | null, rowVersion: string | null) =>
    request<MovementDto>(`${BASE}/${id}/start`, { method: 'POST', body: { date, rowVersion } }),

  /**
   * date = end date (default today). On a Delivery-stage movement the answer also carries `goodsReceipts` (the drafts
   * created and the containers skipped), `goodsReceiptsMessage` and, when creating them failed, `warnings`.
   */
  complete: (id: number, date: string | null, rowVersion: string | null) =>
    request<MovementDto>(`${BASE}/${id}/complete`, { method: 'POST', body: { date, rowVersion } }),

  /** A completed Delivery: its automatic draft goods receipts are deleted with it. */
  cancel: (id: number, reason: string, rowVersion: string | null) =>
    request<MovementDto>(`${BASE}/${id}/cancel`, { method: 'POST', body: { reason, rowVersion } }),

  /** Planned only. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  /** (script 80) The planned movements the container can join, newest first ("Add to a movement…"). */
  joinCandidates: (containerId: number, signal?: AbortSignal) =>
    request<MovementJoinCandidateDto[]>(`${BASE}/join-candidates${toQueryString({ containerId })}`, { signal }),

  /** 409 CONTAINER_BUSY names a container travelling with another movement; nothing is created then. */
  shipContainers: (payload: ShipContainersRequest) =>
    request<ShippedMovementDto>(`${BASE}/ship-containers`, { method: 'POST', body: payload }),

  /** 400 VALIDATION "Choose the From first." without fromPlaceId. */
  containerCandidates: (query: MovementContainerCandidateQuery, signal?: AbortSignal) =>
    request<PagedResult<MovementContainerCandidateDto>>(`${BASE}/container-candidates${toQueryString(query)}`, { signal }),

  /** Numbers or refs in the order of the file; nothing is saved. 400 without a number or above 10,000 of them (matchAll sends more in parts). */
  matchContainers: (query: MovementPlaceQuery, numbers: string[], signal?: AbortSignal) =>
    request<MovementContainerMatchDto[]>(`${BASE}/match-containers`, { method: 'POST', body: { ...query, numbers }, signal }),

  exportToExcel: async (query: MovementQuery) =>
    saveBlob(await fetchBlob(`${BASE}/export${toQueryString({ ...query, page: undefined, pageSize: undefined })}`), 'Movements.xlsx'),
}
