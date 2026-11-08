import { request } from '../http'

/**
 * (111) Shipment stages: the stages a container moves through ("Dispatched to Dar es Salaam", "At port Dar es Salaam",
 * "Dar es Salaam → Mokambo", "Offloaded in Lubumbashi"), kept by an administrator (`masterdata.shipmentstages.manage`),
 * and the way a container moves on - Update stage… and the import of the forwarder's list (`containers.movements.manage`;
 * an Offload stage also posts the goods receipt: Create and Post Goods Receipts). The server makes, starts and completes
 * the movements behind each stage with the movement procedures.
 */
const BASE = '/api/logistics/shipment-stages'

/** 1 Leg (starts a leg), 2 Arrive (completes the leg reaching its place), 3 Offload (and posts the goods receipt). */
export type ShipmentStageKind = 1 | 2 | 3

export const STAGE_KINDS: { value: ShipmentStageKind; label: string; explanation: string }[] = [
  { value: 1, label: 'Leg', explanation: 'Starts a leg from its From (empty: the port of loading) to its To.' },
  { value: 2, label: 'Arrival', explanation: 'Completes the leg that reaches its place.' },
  {
    value: 3,
    label: 'Offload',
    explanation: 'Completes the last leg (adds one to its place when needed) and posts the goods receipt for the full quantity.',
  },
]

export interface ShipmentStageDto {
  id: number
  stageName: string
  kind: ShipmentStageKind
  kindName: string
  movementTypeId: number | null
  movementTypeName: string | null
  movementTypeStage: string | null
  /** A leg's From; null = the container's port of loading (its first leg). */
  fromPlaceId: number | null
  fromPlaceName: string | null
  toPlaceId: number
  toPlaceName: string
  sortOrder: number
  isActive: boolean
  rowVersion: string
}

export interface SaveShipmentStageRequest {
  stageName: string
  kind: ShipmentStageKind
  movementTypeId: number | null
  fromPlaceId: number | null
  toPlaceId: number
  sortOrder: number
  isActive: boolean
  rowVersion?: string | null
}

export interface ShipmentStageCheckDto {
  stages: { stageId: number | null; stageName: string; stageKind: number | null; fitsStages: boolean; containers: number }[]
  notOnAStage: { containerId: number; containerRef: string; containerNo: string | null; containerStatus: number; legs: string | null }[]
}

export type ShipmentStageAction = 'StartLeg' | 'Complete' | 'CompleteThenDeliver' | 'Deliver' | 'Receive'

export interface ShipmentStagePreviewRowDto {
  containerId: number
  found: boolean
  containerRef: string | null
  containerNo: string | null
  containerStatus: number | null
  isDraft: boolean
  currentStageId: number | null
  currentStageName: string | null
  action: ShipmentStageAction | null
  canMove: boolean
  /** Already at the stage: skipped, not refused. */
  alreadyThere: boolean
  reason: string | null
  movementId: number | null
  movementNo: string | null
  movementContainerCount: number
  placeId: number | null
  placeName: string | null
  warehouseCode: string | null
  receiveWarning: string | null
}

export interface ShipmentStageMatchRowDto {
  rowNo: number
  inputNumber: string | null
  /** Null when not found, or found twice (matches > 1). */
  containerId: number | null
  containerRef: string | null
  containerNo: string | null
  matches: number
}

export interface ApplyShipmentStageItem {
  containerId: number
  stageId: number
  /** 'YYYY-MM-DD'. */
  date: string
  vehicleOrVessel?: string | null
  eta?: string | null
}

export interface ApplyShipmentStageItemResultDto {
  containerId: number
  containerRef: string | null
  stageName: string | null
  ok: boolean
  skipped: boolean
  message: string
  code: string | null
  movements: string[]
  goodsReceiptId: number | null
  goodsReceiptNumber: string | null
  /** Moved, but its goods receipt was not posted: "Its draft goods receipt was not posted: …". */
  warning: string | null
}

export interface ApplyShipmentStageResultDto {
  items: ApplyShipmentStageItemResultDto[]
  moved: number
  skipped: number
  refused: number
  /** "22 containers moved, 1 already there, 2 refused." */
  message: string
}

export const shipmentStagesApi = {
  list: (activeOnly = false) => request<ShipmentStageDto[]>(`${BASE}?activeOnly=${activeOnly}`),

  /** 409 DUPLICATE when the name is taken. */
  create: (payload: SaveShipmentStageRequest) => request<ShipmentStageDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveShipmentStageRequest) =>
    request<ShipmentStageDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  check: () => request<ShipmentStageCheckDto>(`${BASE}/check`),

  preview: (stageId: number, containerIds: number[]) =>
    request<ShipmentStagePreviewRowDto[]>(`${BASE}/preview`, { method: 'POST', body: { stageId, containerIds } }),

  match: (numbers: string[]) => request<ShipmentStageMatchRowDto[]>(`${BASE}/match`, { method: 'POST', body: { numbers } }),

  apply: (items: ApplyShipmentStageItem[]) =>
    request<ApplyShipmentStageResultDto>(`${BASE}/apply`, { method: 'POST', body: { items } }),
}

/** The colour of a stage badge: pending gray, travelling blue, at a place teal, offloaded green, off the stages orange. */
export function stageColour(kind: number | null | undefined, name?: string | null): string {
  if (name === 'Not on a stage') return 'orange'
  switch (kind) {
    case 1:
      return 'blue'
    case 2:
      return 'teal'
    case 3:
      return 'green'
    default:
      return 'gray'
  }
}
