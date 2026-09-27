import { fetchBlob, request } from '../http'
import type { PagedResult } from '../types'
import { saveBlob, toQueryString } from './containers'

/**
 * Shipment movements (`api/logistics/movements`, MOV-yyyy-nnnnnn): one leg of the route carrying
 * one or more containers. Starting and completing a movement moves the containers' status, dates and
 * location by the stage of its type. Reading needs containers.view, the rest
 * containers.movements.manage. Every action answers with the movement re-read.
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

export interface MovementContainerDto {
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
  containers: MovementContainerDto[]
  charges: MovementChargeDto[]
  attachments: MovementAttachmentDto[]
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

export const movementsApi = {
  list: (query: MovementQuery, signal?: AbortSignal) =>
    request<PagedResult<MovementListDto>>(`${BASE}${toQueryString(query)}`, { signal }),

  get: (id: number, signal?: AbortSignal) => request<MovementDto>(`${BASE}/${id}`, { signal }),

  create: (payload: SaveMovementRequest) => request<MovementDto>(BASE, { method: 'POST', body: payload }),

  update: (id: number, payload: SaveMovementRequest) =>
    request<MovementDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  /** date = start date (default today). 409 CONTAINER_BUSY when a container travels with another movement. */
  start: (id: number, date: string | null, rowVersion: string | null) =>
    request<MovementDto>(`${BASE}/${id}/start`, { method: 'POST', body: { date, rowVersion } }),

  /** date = end date (default today). */
  complete: (id: number, date: string | null, rowVersion: string | null) =>
    request<MovementDto>(`${BASE}/${id}/complete`, { method: 'POST', body: { date, rowVersion } }),

  cancel: (id: number, reason: string, rowVersion: string | null) =>
    request<MovementDto>(`${BASE}/${id}/cancel`, { method: 'POST', body: { reason, rowVersion } }),

  /** Planned only. */
  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  exportToExcel: async (query: MovementQuery) =>
    saveBlob(await fetchBlob(`${BASE}/export${toQueryString({ ...query, page: undefined, pageSize: undefined })}`), 'Movements.xlsx'),
}
