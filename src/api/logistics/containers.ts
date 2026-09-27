import { fetchBlob, postForm, request } from '../http'
import type { PagedResult } from '../types'

/**
 * Containers — the import shipment between the purchase ORDER and the warehouse
 * (`api/logistics/containers`). A container is created from an approved order and loaded with its
 * lines in pieces; invoices are made from the containers; movements move it; its charges make the
 * real cost of every item. Every action answers with the whole container re-read, so the page never
 * patches what it sent.
 *
 * Permissions: containers.view / create / confirm / offload / cancel / close / delete,
 * containers.overcapacity to confirm a load above capacity, containers.attachments.manage for the
 * documents.
 */
const BASE = '/api/logistics/containers'

/** 1 Draft … 8 Cancelled. 3–5 are derived by the server from the movements; no request sets a status. */
export type ContainerStatusCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export const CONTAINER_STATUSES: { value: ContainerStatusCode; label: string; colour: string }[] = [
  { value: 1, label: 'Draft', colour: 'gray' },
  { value: 2, label: 'Confirmed', colour: 'blue' },
  { value: 3, label: 'In Transit', colour: 'indigo' },
  { value: 4, label: 'At Port', colour: 'orange' },
  { value: 5, label: 'Cleared', colour: 'teal' },
  { value: 6, label: 'Offloaded', colour: 'green' },
  { value: 7, label: 'Closed', colour: 'dark' },
  { value: 8, label: 'Cancelled', colour: 'red' },
]

export function containerStatusColour(status: number): string {
  return CONTAINER_STATUSES.find((s) => s.value === status)?.colour ?? 'gray'
}

export function containerStatusLabel(status: number): string {
  return CONTAINER_STATUSES.find((s) => s.value === status)?.label ?? String(status)
}

export type ShippingMethod = 'Sea' | 'Air' | 'Road'
export const SHIPPING_METHODS: ShippingMethod[] = ['Sea', 'Air', 'Road']

/** 0 none, 1 partly, 2 fully invoiced — by POSTED invoices. */
export const INVOICING_STATUSES = [
  { value: 0, label: 'Not invoiced', colour: 'gray' },
  { value: 1, label: 'Partly invoiced', colour: 'yellow' },
  { value: 2, label: 'Fully invoiced', colour: 'green' },
] as const

/** Where the FOB per unit of a line comes from, in order of authority. */
export type FobSource = 'Order' | 'Invoice' | 'Offload'

/** What the STATUS allows. Whether the reader may is a permission, checked beside it. */
export interface ContainerFlags {
  status: ContainerStatusCode
  statusName: string
  canEdit: boolean
  canConfirm: boolean
  /** Confirmed … Cleared AND every line covered by posted invoices. */
  canOffload: boolean
  canCancelOffload: boolean
  canClose: boolean
  canReopen: boolean
  canCancel: boolean
  canDelete: boolean
}

export interface ContainerListDto extends ContainerFlags {
  id: number
  containerRef: string
  containerNo: string | null
  containerTypeCode: string
  containerTypeName: string
  orderDate: string
  /** yyyyMM */
  orderMonthKey: number
  /** "Sep-2026" */
  orderMonth: string
  branchId: number
  branchCode: string
  branchName: string
  warehouseId: number | null
  warehouseCode: string | null
  warehouseName: string | null
  purchaseOrderId: number | null
  purchaseOrderNumber: string | null
  orderCount: number
  /** "PO-BR-002-000038 +1" */
  orderNumbers: string | null
  supplierCount: number
  /** "Hero MotoCorp +1" */
  supplierNames: string | null
  invoiceCount: number
  invoiceNumbers: string | null
  commercialInvoiceNos: string | null
  exporterReferences: string | null
  itemCount: number
  /** "Mixed - 3 items" when there are several. */
  itemSummary: string | null
  totalQtyBase: number
  invoicedQtyBase: number
  /** 0 none, 1 partly, 2 fully (posted invoices). */
  invoicingStatus: 0 | 1 | 2
  totalReceivedBase: number
  totalOilQty: number
  maxUnits: number | null
  utilizationPct: number | null
  blNo: string | null
  blDate: string | null
  dispatchDate: string | null
  eta: string | null
  actualPortArrival: string | null
  customsReleaseDate: string | null
  offloadedDate: string | null
  freeDays: number | null
  lastFreeDay: string | null
  daysAtPort: number | null
  /** At port or cleared, and the last free day is behind us. */
  isFreeTimeOver: boolean
  currentLocation: string | null
  statusNote: string | null
  currentMovementId: number | null
  currentMovementNo: string | null
  currentMovementStatus: number | null
  chargesPostedBase: number
  chargesDraftBase: number
  attachmentCount: number
  portOfLoadingName: string | null
  portOfDestinationName: string | null
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  rowVersion: string
}

/** One loaded line: an ORDER line, pieces, how far it is invoiced and what it really costs. */
export interface ContainerLineDto {
  id: number
  containerId: number
  lineNumber: number
  purchaseOrderId: number
  purchaseOrderNumber: string | null
  supplierId: number
  supplierCode: string
  supplierName: string
  poLineId: number
  poLineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  model: string | null
  brandName: string | null
  itemUnitId: number
  unitTypeName: string
  packingFormula: number
  poUnitTypeName: string
  poPackingFormula: number
  quantity: number
  quantityBase: number
  oilIncluded: boolean
  oilQtyPerUnit: number | null
  totalOilQty: number
  orderedBase: number
  loadedElsewhereBase: number
  invoicedPostedBase: number
  invoicedDraftBase: number
  availableToInvoiceBase: number
  invoiceNumbers: string | null
  /** Null until the offload. */
  receivedQuantityBase: number | null
  varianceReason: string | null
  notes: string | null
  unitFobBase: number | null
  fobSource: FobSource
  fobCostBase: number | null
  /** POSTED charges on the line (base currency). */
  chargesBase: number
  draftChargesBase: number
  chargesPerUnitBase: number | null
  landedCostBase: number | null
  /** Final once offloaded; an estimate before. */
  isLandedFinal: boolean
  weightKg: number | null
  volumeCbm: number | null
}

/** A purchase invoice covering lines of the container, with its part in this container. */
export interface ContainerInvoiceDto {
  purchaseDocumentId: number
  documentNumber: string | null
  documentDate: string
  /** The purchase document's status: 1 Draft, 2 Posted, 3 Cancelled, 4 Closed. */
  invoiceStatus: number
  /** 1 = on posting, 2 = on container offload. */
  receiptMode: number
  purchaseOrderId: number | null
  purchaseOrderNumber: string | null
  supplierId: number
  supplierCode: string
  supplierName: string
  currencyId: number
  currencyCode: string
  currencySymbol: string | null
  exchangeRate: number
  supplierReference: string | null
  exporterReference: string | null
  commercialInvoiceNo: string | null
  qtyInContainerBase: number
  amountInContainer: number
  amountInContainerBase: number
  totalAmount: number
  totalAmountBase: number
}

/** One leg of the container's route (a movement carrying it), oldest first. */
export interface ContainerMovementDto {
  movementId: number
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
  /** 1 Planned, 2 In progress, 3 Completed, 4 Cancelled. */
  status: number
  carrierPartyId: number | null
  carrierName: string | null
  vehicleOrVessel: string | null
  voyageNo: string | null
  reference: string | null
  notes: string | null
  containerCount: number
  chargesBase: number | null
  attachmentCount: number
}

/** A charge on the container. One charge typed for several containers is one row per container, same groupId. */
export interface ContainerChargeRowDto {
  id: number
  containerId: number
  movementId: number | null
  movementNo: string | null
  groupId: string | null
  groupSize: number
  chargeTypeId: number
  chargeCode: string
  chargeName: string
  description: string | null
  providerPartyId: number | null
  providerName: string | null
  reference: string | null
  chargeDate: string
  currencyId: number
  currencyCode: string
  rateType: number
  exchangeRate: number
  amount: number
  amountBase: number
  allocationMethod: string
  includeInLandedCost: boolean
  /** 1 Draft, 2 Posted, 3 Cancelled. */
  status: number
  appliedAtOffload: boolean
  adjustedAfterOffload: boolean
  allocatedBase: number | null
  attachmentCount: number
  notes: string | null
  postedAtUtc: string | null
  postedByName: string | null
  cancelledAtUtc: string | null
  cancelReason: string | null
  createdAtUtc: string
  createdByName: string | null
  rowVersion: string
}

/** How a charge is divided over the lines: the real cost of each item. */
export interface ContainerChargeAllocationDto {
  chargeId: number
  containerLineId: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  basis: number | null
  amountBase: number
  isManual: boolean
  perUnitBase: number | null
}

/** A document on the container: general, or linked to a movement and / or a charge. */
export interface ContainerAttachmentDto {
  id: number
  containerId: number
  movementId: number | null
  movementNo: string | null
  chargeId: number | null
  attachmentTypeId: number | null
  category: string | null
  subType: string | null
  /** The stored file — the same on every container the upload went to. */
  fileId: number
  fileName: string
  contentType: string
  sizeBytes: number
  note: string | null
  documentDate: string | null
  groupId: string | null
  /** How many OTHER containers hold the same file. */
  sharedWith: number
  createdAtUtc: string
  createdBy: number | null
  createdByName: string | null
}

export interface ContainerAuditDto {
  id: number
  action: string
  details: string | null
  userId: number | null
  userName: string | null
  atUtc: string
}

export interface ContainerSupplierDto {
  supplierId: number
  supplierCode: string
  supplierName: string
}

export interface ContainerDto extends ContainerFlags {
  id: number
  documentTypeId: number
  containerRef: string
  containerNo: string | null
  containerTypeId: number
  containerTypeCode: string
  containerTypeName: string
  typeMaxUnits: number | null
  maxWeightKg: number | null
  maxVolumeCbm: number | null
  sealNo: string | null
  customsSealNo: string | null
  description: string | null
  orderDate: string
  orderMonthKey: number
  orderMonth: string
  shippingMethod: ShippingMethod
  countryOfOrigin: string | null
  purchaseOrderId: number | null
  purchaseOrderNumber: string | null
  purchaseOrderSupplierId: number | null
  purchaseOrderSupplierName: string | null
  forwarderId: number | null
  forwarderName: string | null
  transporterId: number | null
  transporterName: string | null
  shippingLine: string | null
  vesselName: string | null
  voyageNo: string | null
  bookingNo: string | null
  portOfLoadingId: number | null
  portOfLoadingName: string | null
  portOfLoadingCountry: string | null
  portOfDestinationId: number | null
  portOfDestinationName: string | null
  portOfDestinationCountry: string | null
  finalDestinationId: number | null
  finalDestinationName: string | null
  dispatchDate: string | null
  eta: string | null
  freeDays: number | null
  lastFreeDay: string | null
  grossWeightKg: number | null
  volumeCbm: number | null
  packages: number | null
  blNo: string | null
  blDate: string | null
  blNotes: string | null
  maxUnits: number | null
  totalLines: number
  totalAllocatedBase: number
  totalReceivedBase: number
  totalOilQty: number
  utilizationPct: number | null
  remainingCapacityBase: number | null
  isOverCapacity: boolean
  branchId: number
  branchCode: string
  branchName: string
  warehouseId: number | null
  warehouseCode: string | null
  warehouseName: string | null
  truckNo: string | null
  waybillNo: string | null
  declarationNo: string | null
  feriNo: string | null
  actualPortArrival: string | null
  borderCrossingDate: string | null
  customsReleaseDate: string | null
  daysAtPort: number | null
  offloadedDate: string | null
  offloadedAtUtc: string | null
  offloadedByName: string | null
  statusNote: string | null
  currentLocation: string | null
  notes: string | null
  /** The milestone dates come from the movements (the container has travelled with one): read-only. */
  datesFromMovements: boolean
  hasMovements: boolean
  invoicedPostedBase: number
  invoicedDraftBase: number
  isFullyInvoiced: boolean
  chargesPostedBase: number
  chargesDraftBase: number
  chargesLandedPostedBase: number
  fobTotalBase: number | null
  landedTotalBase: number | null
  confirmedAtUtc: string | null
  confirmedByName: string | null
  closedAtUtc: string | null
  closedByName: string | null
  cancelledAtUtc: string | null
  cancelledByName: string | null
  cancelReason: string | null
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  updatedByName: string | null
  rowVersion: string
  isFreeTimeOver: boolean
  /** Draft … Offloaded. */
  canAddCharge: boolean
  /** Still travelling and something loaded is not in an invoice yet. */
  canInvoice: boolean
  suppliers: ContainerSupplierDto[]
  lines: ContainerLineDto[]
  invoices: ContainerInvoiceDto[]
  movements: ContainerMovementDto[]
  charges: ContainerChargeRowDto[]
  allocations: ContainerChargeAllocationDto[]
  /** Newest first. */
  attachments: ContainerAttachmentDto[]
  audit: ContainerAuditDto[]
}

/** An approved order line that can still be loaded. Quantities in base units (pieces). */
export interface AvailablePoLineDto {
  purchaseOrderId: number
  purchaseOrderNumber: string | null
  orderDate: string
  orderStatus: number
  supplierId: number
  supplierCode: string
  supplierName: string
  currencyId: number
  currencyCode: string
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  poLineId: number
  poLineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  model: string | null
  brandName: string | null
  itemUnitId: number
  unitTypeName: string
  packingFormula: number
  orderedQuantity: number
  orderedBase: number
  /** In invoices made straight from the order (no container). */
  invoicedDirectBase: number
  loadedElsewhereBase: number
  /** What the container being edited already holds. */
  loadedHereBase: number
  /** The ceiling for this container. */
  maxHereBase: number
  /** Still free to add (maxHere − loadedHere). */
  availableBase: number
  unitPrice: number
  discountPercent: number
  unitValueBase: number | null
  itemOilQtyPerUnit: number | null
  pcPerContainer: number | null
  weightKg: number | null
  volumeCbm: number | null
}

/** A container line that can still be invoiced. */
export interface InvoiceCandidateDto {
  containerLineId: number
  containerId: number
  containerRef: string
  containerNo: string | null
  containerStatus: number
  lineNumber: number
  purchaseOrderId: number
  purchaseOrderNumber: string | null
  orderStatus: number
  supplierId: number
  supplierName: string
  currencyId: number
  currencyCode: string
  poLineId: number
  poLineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  poItemUnitId: number
  poUnitTypeName: string
  poPackingFormula: number
  unitPrice: number
  discountPercent: number
  loadedBase: number
  invoicedPostedBase: number
  invoicedDraftBase: number
  availableBase: number
  orderLineRemainingBase: number
}

/** One line of the loading plan: an order line and the pieces loaded. */
export interface SaveContainerLine {
  poLineId: number
  /** Pieces (base units). */
  quantityBase: number
  oilIncluded: boolean
  /** Null = the item's value. */
  oilQtyPerUnit: number | null
  notes: string | null
}

export interface SaveContainerRequest {
  /** Required when creating; ignored on an update. */
  purchaseOrderId?: number | null
  containerNo: string | null
  containerTypeId: number
  sealNo: string | null
  customsSealNo: string | null
  description: string | null
  orderDate: string
  shippingMethod: ShippingMethod
  countryOfOrigin: string | null
  forwarderId: number | null
  transporterId: number | null
  shippingLine: string | null
  vesselName: string | null
  voyageNo: string | null
  bookingNo: string | null
  portOfLoadingId: number | null
  portOfDestinationId: number | null
  finalDestinationId: number | null
  dispatchDate: string | null
  eta: string | null
  freeDays: number | null
  grossWeightKg: number | null
  volumeCbm: number | null
  packages: number | null
  blNo: string | null
  blDate: string | null
  blNotes: string | null
  maxUnits: number | null
  branchId: number
  warehouseId: number | null
  truckNo: string | null
  waybillNo: string | null
  declarationNo: string | null
  feriNo: string | null
  actualPortArrival: string | null
  borderCrossingDate: string | null
  customsReleaseDate: string | null
  statusNote: string | null
  notes: string | null
  lines: SaveContainerLine[]
  /** The reader confirmed loading above capacity. Needs containers.overcapacity. */
  allowOverCapacity: boolean
  rowVersion: string | null
}

export interface OffloadLine {
  lineId: number
  receivedQuantityBase: number
  varianceReason: string | null
}

export interface OffloadRequest {
  lines: OffloadLine[]
  offloadedDate: string | null
  warehouseId: number | null
  rowVersion: string | null
}

export interface ContainerQuery {
  search?: string
  containerRef?: string
  containerNo?: string
  supplierId?: number
  purchaseDocumentId?: number
  purchaseOrderId?: number
  movementId?: number
  commercialInvoiceNo?: string
  itemId?: number
  blNo?: string
  status?: ContainerStatusCode
  portId?: number
  warehouseId?: number
  branchId?: number
  /** yyyyMM */
  orderMonthKey?: number
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface AvailablePoLineQuery {
  purchaseOrderId?: number
  supplierId?: number
  search?: string
  /** The container being edited: what it holds counts apart. */
  containerId?: number
}

export interface InvoiceCandidateQuery {
  purchaseOrderId?: number
  containerId?: number
  includeAll?: boolean
}

/* ── tracking ─────────────────────────────────────────────────────────────────────────────── */

export interface TrackingContainerDto {
  id: number
  containerRef: string
  containerNo: string | null
  containerTypeCode: string
  status: ContainerStatusCode
  statusName: string
  currentLocation: string | null
  dispatchDate: string | null
  eta: string | null
  actualPortArrival: string | null
  customsReleaseDate: string | null
  offloadedDate: string | null
  lastFreeDay: string | null
  daysAtPort: number | null
  totalAllocatedBase: number
  totalOilQty: number
  itemSummary: string | null
  supplierName: string | null
  portOfLoadingName: string | null
  portOfDestinationName: string | null
  finalDestinationName: string | null
  warehouseName: string | null
}

export interface TrackingLegDto {
  containerId: number
  movementId: number
  movementNo: string
  seq: number
  typeCode: string
  typeName: string
  stage: string
  fromPlaceId: number
  fromCode: string
  fromName: string
  fromKind: string
  fromCountry: string | null
  toPlaceId: number
  toCode: string
  toName: string
  toKind: string
  toCountry: string | null
  plannedDate: string | null
  startDate: string | null
  eta: string | null
  endDate: string | null
  /** 1 planned, 2 in progress, 3 completed. */
  status: number
  carrierName: string | null
  vehicleOrVessel: string | null
  voyageNo: string | null
  /** 0–100: where the container stands on the leg. */
  progressPct: number
  isLate: boolean
}

export interface TrackingDto {
  containers: TrackingContainerDto[]
  legs: TrackingLegDto[]
}

/* ── attachments ──────────────────────────────────────────────────────────────────────────── */

export interface AttachmentUpload {
  file: File
  containerIds: number[]
  movementId?: number | null
  chargeId?: number | null
  attachmentTypeId?: number | null
  note?: string | null
  documentDate?: string | null
}

/** A record the upload created: one per container, the same fileId on all. */
export interface AttachmentCreatedDto {
  id: number
  containerId: number
  containerRef: string
  fileId: number
  movementId: number | null
  chargeId: number | null
}

export function toQueryString(query: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text) params.set(key, text)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const containersApi = {
  list: (query: ContainerQuery, signal?: AbortSignal) =>
    request<PagedResult<ContainerListDto>>(`${BASE}${toQueryString(query)}`, { signal }),

  get: (id: number, signal?: AbortSignal) => request<ContainerDto>(`${BASE}/${id}`, { signal }),

  /** From an approved order (purchaseOrderId). 409 OVER_CAPACITY carries the message to show. */
  create: (payload: SaveContainerRequest) => request<ContainerDto>(BASE, { method: 'POST', body: payload }),

  /** 409 OVER_CAPACITY (data.canOverride) above capacity; 409 LINE_INVOICED below what is invoiced. */
  update: (id: number, payload: SaveContainerRequest) =>
    request<ContainerDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  confirm: (id: number, rowVersion: string | null) =>
    request<ContainerDto>(`${BASE}/${id}/confirm`, { method: 'POST', body: { rowVersion } }),

  /** 409 NOT_FULLY_INVOICED, or INVALID_STATUS while a movement is in progress. */
  offload: (id: number, payload: OffloadRequest) =>
    request<ContainerDto>(`${BASE}/${id}/offload`, { method: 'POST', body: payload }),

  /** 409 COST_ADJUSTED once a charge was posted after the offload. */
  cancelOffload: (id: number, reason: string, rowVersion: string | null) =>
    request<ContainerDto>(`${BASE}/${id}/cancel-offload`, { method: 'POST', body: { reason, rowVersion } }),

  close: (id: number, rowVersion: string | null) =>
    request<ContainerDto>(`${BASE}/${id}/close`, { method: 'POST', body: { rowVersion } }),

  /** Closed → offloaded again. */
  reopen: (id: number, rowVersion: string | null) =>
    request<ContainerDto>(`${BASE}/${id}/reopen`, { method: 'POST', body: { rowVersion } }),

  cancel: (id: number, reason: string, rowVersion: string | null) =>
    request<ContainerDto>(`${BASE}/${id}/cancel`, { method: 'POST', body: { reason, rowVersion } }),

  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  exportToExcel: async (id: number, containerRef: string) =>
    saveBlob(await fetchBlob(`${BASE}/${id}/export`), `Container_${containerRef}.xlsx`),

  availablePoLines: (query: AvailablePoLineQuery, signal?: AbortSignal) =>
    request<AvailablePoLineDto[]>(`${BASE}/available-po-lines${toQueryString(query)}`, { signal }),

  invoiceCandidates: (query: InvoiceCandidateQuery, signal?: AbortSignal) =>
    request<InvoiceCandidateDto[]>(`${BASE}/invoice-candidates${toQueryString(query)}`, { signal }),

  tracking: (query: { containerId?: number; search?: string; offloadedDays?: number }, signal?: AbortSignal) =>
    request<TrackingDto>(`${BASE}/tracking${toQueryString(query)}`, { signal }),

  addAttachment: (upload: AttachmentUpload) => {
    const form = new FormData()
    form.append('file', upload.file, upload.file.name)
    for (const id of upload.containerIds) form.append('containerIds', String(id))
    if (upload.movementId) form.append('movementId', String(upload.movementId))
    if (upload.chargeId) form.append('chargeId', String(upload.chargeId))
    if (upload.attachmentTypeId) form.append('attachmentTypeId', String(upload.attachmentTypeId))
    if (upload.note) form.append('note', upload.note)
    if (upload.documentDate) form.append('documentDate', upload.documentDate)
    return postForm<AttachmentCreatedDto[]>(`${BASE}/attachments`, form)
  },

  attachmentBlob: (attachmentId: number) => fetchBlob(`${BASE}/attachments/${attachmentId}/download`),

  downloadAttachment: async (attachmentId: number, fileName: string) =>
    saveBlob(await fetchBlob(`${BASE}/attachments/${attachmentId}/download`), fileName),

  /** allShared = the file from every container holding it. */
  removeAttachment: (attachmentId: number, allShared: boolean) =>
    request<void>(`${BASE}/attachments/${attachmentId}?allShared=${allShared}`, { method: 'DELETE' }),
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
