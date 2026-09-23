import { fetchBlob, postForm, request } from '../http'
import type { PagedResult } from '../types'

/**
 * Containers — the import shipment between the purchase invoice and the warehouse
 * (`api/logistics/containers`). Every action answers with the whole container re-read, so the page
 * never patches what it sent: an event moves the derived status and the location, an offload writes
 * the received quantities.
 *
 * Permissions: containers.view / create / confirm / offload / cancel / close / delete, and
 * containers.overcapacity to confirm a load above the container's capacity.
 */
const BASE = '/api/logistics/containers'

/** 1 Draft … 8 Cancelled. 3–5 are derived by the server from the route dates; no request sets a status. */
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

export type ShippingMethod = 'Sea' | 'Air' | 'Road'
export const SHIPPING_METHODS: ShippingMethod[] = ['Sea', 'Air', 'Road']

/** The route events a reader records; "Offloaded" is written by the offload itself. */
export type ContainerEventType = 'Booked' | 'Dispatched' | 'PortArrival' | 'CustomsRelease' | 'BorderCrossing' | 'Note'

export const CONTAINER_EVENT_TYPES: { value: ContainerEventType; label: string }[] = [
  { value: 'Booked', label: 'Booked' },
  { value: 'Dispatched', label: 'Dispatched (left the port of loading)' },
  { value: 'PortArrival', label: 'Port arrival' },
  { value: 'CustomsRelease', label: 'Customs release' },
  { value: 'BorderCrossing', label: 'Border crossing' },
  { value: 'Note', label: 'Note' },
]

export function eventTypeLabel(eventType: string): string {
  if (eventType === 'Offloaded') return 'Offloaded'
  return CONTAINER_EVENT_TYPES.find((e) => e.value === eventType)?.label.replace(/ \(.*\)$/, '') ?? eventType
}

/** What the STATUS allows. Whether the reader may is a permission, checked beside it. */
export interface ContainerFlags {
  status: ContainerStatusCode
  statusName: string
  canEdit: boolean
  canConfirm: boolean
  canAddEvent: boolean
  canOffload: boolean
  canCancelOffload: boolean
  canClose: boolean
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
  supplierCount: number
  /** "Hero MotoCorp +1" */
  supplierNames: string | null
  invoiceCount: number
  invoiceNumbers: string | null
  commercialInvoiceNos: string | null
  itemCount: number
  /** "Mixed - 3 items" when there are several. */
  itemSummary: string | null
  totalQtyBase: number
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
  portOfLoadingName: string | null
  portOfDestinationName: string | null
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  rowVersion: string
}

export interface ContainerInvoiceDto {
  id: number
  purchaseDocumentId: number
  documentNumber: string | null
  documentDate: string
  /** The purchase document's status: 1 Draft, 2 Posted, 3 Cancelled, 4 Closed. */
  invoiceStatus: number
  /** 1 = on posting, 2 = on container offload. */
  receiptMode: number
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
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  totalQtyBase: number
  allocatedHereBase: number
  allocatedTotalBase: number
  remainingBase: number
  totalAmount: number
  totalAmountBase: number
  totalLandedCostBase: number
}

export interface ContainerLineDto {
  id: number
  lineNumber: number
  purchaseDocumentId: number
  invoiceNumber: string | null
  commercialInvoiceNo: string | null
  supplierName: string
  purchaseLineId: number
  invoiceLineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  model: string | null
  brandName: string | null
  itemUnitId: number
  unitTypeName: string
  packingFormula: number
  /** In the purchase line's unit. */
  quantity: number
  quantityBase: number
  oilIncluded: boolean
  oilQtyPerUnit: number | null
  totalOilQty: number
  /** Null until the offload. */
  receivedQuantityBase: number | null
  varianceReason: string | null
  notes: string | null
  invoiceQtyBase: number
  allocatedElsewhereBase: number
  /** The most this container may carry of the invoice line, in base units. */
  availableBase: number
  unitCostBase: number | null
  fobCostBase: number | null
  onHandBase: number
  warehouseId: number
  warehouseCode: string
  warehouseName: string
}

export interface ContainerEventDto {
  id: number
  eventType: string
  eventDate: string
  portId: number | null
  portName: string | null
  locationText: string | null
  notes: string | null
  createdAtUtc: string
  createdByName: string | null
}

export interface ContainerFileDto {
  id: number
  attachmentTypeId: number | null
  category: string | null
  subType: string | null
  fileName: string
  contentType: string
  sizeBytes: number
  note: string | null
  documentDate: string | null
  createdAtUtc: string
  createdByName: string | null
}

export interface ContainerAuditDto {
  action: string
  details: string | null
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
  suppliers: ContainerSupplierDto[]
  invoices: ContainerInvoiceDto[]
  lines: ContainerLineDto[]
  /** Newest first. */
  events: ContainerEventDto[]
  files: ContainerFileDto[]
  audit: ContainerAuditDto[]
}

export interface AvailableInvoiceDto {
  id: number
  documentNumber: string | null
  documentDate: string
  /** 1 Draft, 2 Posted. */
  status: number
  /** 1 = on posting, 2 = on container offload. */
  receiptMode: number
  supplierId: number
  supplierCode: string
  supplierName: string
  currencyId: number
  currencyCode: string
  currencySymbol: string | null
  supplierReference: string | null
  exporterReference: string | null
  commercialInvoiceNo: string | null
  warehouseId: number
  warehouseCode: string
  warehouseName: string
  totalQtyBase: number
  allocatedBase: number
  allocatedHereBase: number
  remainingBase: number
  totalAmount: number
  totalAmountBase: number
}

/**
 * A posted invoice received on posting is already in stock: the server lists it but refuses to load
 * it. The page offers only what can actually be loaded.
 */
export function isLoadable(invoice: { status: number; receiptMode: number }): boolean {
  return !(invoice.status === 2 && invoice.receiptMode === 1)
}

export interface AvailableInvoiceLineDto {
  purchaseLineId: number
  purchaseDocumentId: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  model: string | null
  itemUnitId: number
  unitTypeName: string
  packingFormula: number
  quantity: number
  quantityBase: number
  allocatedElsewhereBase: number
  allocatedHereBase: number
  availableBase: number
  oilQtyPerUnit: number | null
}

export interface SaveContainerLine {
  purchaseLineId: number
  /** In the purchase line's unit. */
  quantity: number
  oilIncluded: boolean
  /** Null = the item's value. */
  oilQtyPerUnit: number | null
  notes: string | null
}

export interface SaveContainerRequest {
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
  invoices: number[]
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

export interface AddEventRequest {
  eventType: ContainerEventType
  eventDate: string
  portId: number | null
  locationText: string | null
  notes: string | null
}

export interface ContainerQuery {
  search?: string
  containerRef?: string
  containerNo?: string
  supplierId?: number
  purchaseDocumentId?: number
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

export interface ContainerFileUpload {
  file: File
  attachmentTypeId: number | null
  note: string | null
  documentDate: string | null
}

function toQueryString(query: ContainerQuery): string {
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

  create: (payload: SaveContainerRequest) => request<ContainerDto>(BASE, { method: 'POST', body: payload }),

  /** 409 OVER_CAPACITY (data.canOverride) when above capacity without allowOverCapacity. */
  update: (id: number, payload: SaveContainerRequest) =>
    request<ContainerDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  confirm: (id: number, rowVersion: string | null) =>
    request<ContainerDto>(`${BASE}/${id}/confirm`, { method: 'POST', body: { rowVersion } }),

  addEvent: (id: number, payload: AddEventRequest) =>
    request<ContainerDto>(`${BASE}/${id}/events`, { method: 'POST', body: payload }),

  offload: (id: number, payload: OffloadRequest) =>
    request<ContainerDto>(`${BASE}/${id}/offload`, { method: 'POST', body: payload }),

  cancelOffload: (id: number, reason: string, rowVersion: string | null) =>
    request<ContainerDto>(`${BASE}/${id}/cancel-offload`, { method: 'POST', body: { reason, rowVersion } }),

  close: (id: number, rowVersion: string | null) =>
    request<ContainerDto>(`${BASE}/${id}/close`, { method: 'POST', body: { rowVersion } }),

  cancel: (id: number, reason: string, rowVersion: string | null) =>
    request<ContainerDto>(`${BASE}/${id}/cancel`, { method: 'POST', body: { reason, rowVersion } }),

  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  exportToExcel: async (id: number, containerRef: string) =>
    save(await fetchBlob(`${BASE}/${id}/export`), `Container_${containerRef}.xlsx`),

  availableInvoices: (query: { search?: string; supplierId?: number; containerId?: number }, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.supplierId !== undefined) params.set('supplierId', String(query.supplierId))
    if (query.containerId !== undefined) params.set('containerId', String(query.containerId))
    const qs = params.toString()
    return request<AvailableInvoiceDto[]>(`${BASE}/available-invoices${qs ? `?${qs}` : ''}`, { signal })
  },

  /** The loading grid of one invoice; containerId = the container being edited (its own load counts as available). */
  invoiceLines: (invoiceId: number, containerId?: number) =>
    request<AvailableInvoiceLineDto[]>(
      `${BASE}/available-invoices/${invoiceId}/lines${containerId !== undefined ? `?containerId=${containerId}` : ''}`,
    ),

  addFile: (id: number, upload: ContainerFileUpload) => {
    const form = new FormData()
    form.append('file', upload.file, upload.file.name)
    if (upload.attachmentTypeId !== null) form.append('attachmentTypeId', String(upload.attachmentTypeId))
    if (upload.note) form.append('note', upload.note)
    if (upload.documentDate) form.append('documentDate', upload.documentDate)
    return postForm<{ id: number }>(`${BASE}/${id}/files`, form)
  },

  fileBlob: (fileId: number) => fetchBlob(`${BASE}/files/${fileId}`),

  removeFile: (fileId: number) => request<void>(`${BASE}/files/${fileId}`, { method: 'DELETE' }),
}

function save(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
