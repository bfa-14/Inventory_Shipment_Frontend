import { fetchBlob, request } from '../http'
import { saveBlob, toQueryString } from './containers'

/**
 * Container charges (`api/logistics/container-charges`): freight, clearing, insurance… typed once for
 * one or several containers (one DRAFT per container, same groupId), divided over their lines — the
 * real cost of every item. Draft → Posted (locked) → Cancelled; one posted after the offload becomes a
 * cost adjustment ("after offload"). Permissions: containers.charges.view / create / post / cancel.
 */
const BASE = '/api/logistics/container-charges'

/** 1 Draft, 2 Posted, 3 Cancelled. */
export type ChargeStatusCode = 1 | 2 | 3

export const CHARGE_STATUSES: { value: ChargeStatusCode; label: string; colour: string }[] = [
  { value: 1, label: 'Draft', colour: 'gray' },
  { value: 2, label: 'Posted', colour: 'green' },
  { value: 3, label: 'Cancelled', colour: 'red' },
]

export function chargeStatusColour(status: number): string {
  return CHARGE_STATUSES.find((s) => s.value === status)?.colour ?? 'gray'
}

/**
 * Draft or posted, on a container that is not closed or cancelled: what "Apply to other containers"
 * needs — the charge DTO says it as canCopy; a container's charge row is judged with this.
 */
export function canCopyCharge(chargeStatus: number, containerStatus: number): boolean {
  return (chargeStatus === 1 || chargeStatus === 2) && containerStatus !== 7 && containerStatus !== 8
}

export type SplitRule = 'Same' | 'Equal' | 'Pieces' | 'Value'

export const SPLIT_RULES: { value: SplitRule; label: string }[] = [
  { value: 'Same', label: 'Same amount on each container' },
  { value: 'Equal', label: 'Equal parts' },
  { value: 'Pieces', label: 'By pieces' },
  { value: 'Value', label: 'By value' },
]

export type AllocationMethod = 'Value' | 'Quantity' | 'Weight' | 'Volume' | 'Manual'
export const ALLOCATION_METHODS: AllocationMethod[] = ['Value', 'Quantity', 'Weight', 'Volume', 'Manual']

export interface ChargeFlags {
  status: ChargeStatusCode
  statusName: string
  /** The container's status (1–8). */
  containerStatus: number
  canEdit: boolean
  canDelete: boolean
  canPost: boolean
  canCancel: boolean
  /** "Apply to other containers": draft or posted, and the container not closed or cancelled. */
  canCopy: boolean
}

export interface ContainerChargeListDto extends ChargeFlags {
  id: number
  containerId: number
  containerRef: string
  containerNo: string | null
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
  allocationMethod: AllocationMethod
  includeInLandedCost: boolean
  appliedAtOffload: boolean
  /** Posted (or cancelled) after the offload: a cost adjustment. */
  adjustedAfterOffload: boolean
  attachmentCount: number
  /* Supplier payments (script 47) - posted charges only, null otherwise. */
  paidAmount: number | null
  outstandingAmount: number | null
  /** Unpaid, Partial or Paid. */
  paymentStatus: string | null
  postedAtUtc: string | null
  createdAtUtc: string
  createdByName: string | null
  rowVersion: string
}

export interface ContainerChargePageDto {
  items: ContainerChargeListDto[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  /** Sum of amountBase over the WHOLE filter. */
  totalAmountBase: number
}

/** The charge's share of one container line: the real cost per item. */
export interface ContainerChargeShareDto {
  containerLineId: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  /** Received once offloaded, loaded before. */
  quantityBase: number
  basis: number | null
  amountBase: number
  isManual: boolean
  perUnitBase: number | null
}

export interface ContainerChargeAttachmentDto {
  id: number
  containerId: number
  movementId: number | null
  attachmentTypeId: number | null
  category: string | null
  subType: string | null
  fileId: number
  fileName: string
  contentType: string
  sizeBytes: number
  note: string | null
  documentDate: string | null
  createdAtUtc: string
  createdByName: string | null
}

/** The same charge on another container of the group — also what create answers with. */
export interface ChargeGroupMemberDto {
  id: number
  containerId: number
  containerRef: string
  containerNo: string | null
  groupId: string | null
  amount: number
  amountBase: number
  status: ChargeStatusCode
  statusName: string
  rowVersion: string
}

export interface ContainerChargeDto extends ChargeFlags {
  id: number
  containerId: number
  containerRef: string
  containerNo: string | null
  movementId: number | null
  movementNo: string | null
  groupId: string | null
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
  allocationMethod: AllocationMethod
  includeInLandedCost: boolean
  appliedAtOffload: boolean
  adjustedAfterOffload: boolean
  notes: string | null
  postedAtUtc: string | null
  postedByName: string | null
  cancelledAtUtc: string | null
  cancelledByName: string | null
  cancelReason: string | null
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  updatedByName: string | null
  rowVersion: string
  /** Every line of the container with this charge's share (0 when it took none). */
  allocations: ContainerChargeShareDto[]
  attachments: ContainerChargeAttachmentDto[]
  group: ChargeGroupMemberDto[]
}

export interface CreateContainerChargeRequest {
  containerIds: number[]
  movementId: number | null
  chargeTypeId: number
  description: string | null
  providerPartyId: number | null
  reference: string | null
  chargeDate: string
  /** Null = the base currency. */
  currencyId: number | null
  rateType: number | null
  /** Null = the rate of the charge date. */
  exchangeRate: number | null
  totalAmount: number
  splitRule: SplitRule
  /** Null = the charge type's method. */
  allocationMethod: AllocationMethod | null
  notes: string | null
}

export interface UpdateContainerChargeRequest {
  movementId: number | null
  chargeTypeId: number
  description: string | null
  providerPartyId: number | null
  reference: string | null
  chargeDate: string
  currencyId: number | null
  rateType: number | null
  exchangeRate: number | null
  amount: number
  allocationMethod: AllocationMethod | null
  notes: string | null
  /** Method Manual: the shares per container line; they must add up to the amount (base). */
  manual: { containerLineId: number; amountBase: number }[]
  rowVersion: string | null
}

export interface ContainerChargeQuery {
  search?: string
  containerId?: number
  movementId?: number
  chargeTypeId?: number
  providerPartyId?: number
  status?: ChargeStatusCode
  dateFrom?: string
  dateTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/** A container that can receive a copy of a charge (not closed, not cancelled). */
export interface ChargeCopyCandidateDto {
  containerId: number
  containerRef: string
  containerNo: string | null
  containerTypeCode: string
  status: number
  currentLocation: string | null
  purchaseOrderId: number | null
  purchaseOrderNumber: string | null
  totalAllocatedBase: number
  itemSummary: string | null
  /** The charge's own container. */
  isSource: boolean
  /** The charge's own container, or one already carrying a charge of its group. */
  hasThisCharge: boolean
}

/** Null values = the original's (a Manual original gives the charge type's method). */
export interface CopyContainerChargeRequest {
  containerIds: number[]
  /** Per container, in the charge's currency. */
  amount?: number | null
  chargeDate?: string | null
  allocationMethod?: Exclude<AllocationMethod, 'Manual'> | null
  /** Post the copies at once: needs containers.charges.post. */
  post: boolean
}

export interface CopiedContainerChargeDto {
  id: number
  containerId: number
  containerRef: string
  containerNo: string | null
  groupId: string | null
  amount: number
  amountBase: number
  allocationMethod: AllocationMethod
  status: ChargeStatusCode
  rowVersion: string
}

export const containerChargesApi = {
  list: (query: ContainerChargeQuery, signal?: AbortSignal) =>
    request<ContainerChargePageDto>(`${BASE}${toQueryString(query)}`, { signal }),

  get: (id: number, signal?: AbortSignal) => request<ContainerChargeDto>(`${BASE}/${id}`, { signal }),

  /** One draft per container; the created drafts. */
  create: (payload: CreateContainerChargeRequest) =>
    request<ChargeGroupMemberDto[]>(BASE, { method: 'POST', body: payload }),

  /** Drafts only (409 NOT_EDITABLE). */
  update: (id: number, payload: UpdateContainerChargeRequest) =>
    request<ContainerChargeDto>(`${BASE}/${id}`, { method: 'PUT', body: payload }),

  /** Several drafts, all or nothing. */
  postMany: (ids: number[]) => request<ContainerChargeDto[]>(`${BASE}/post`, { method: 'POST', body: { ids } }),

  post: (id: number, rowVersion: string | null) =>
    request<ContainerChargeDto>(`${BASE}/${id}/post`, { method: 'POST', body: { rowVersion } }),

  cancel: (id: number, reason: string, rowVersion: string | null) =>
    request<ContainerChargeDto>(`${BASE}/${id}/cancel`, { method: 'POST', body: { reason, rowVersion } }),

  remove: (id: number) => request<void>(`${BASE}/${id}`, { method: 'DELETE' }),

  copyCandidates: (id: number, query: { search?: string; sameOrder: boolean }, signal?: AbortSignal) =>
    request<ChargeCopyCandidateDto[]>(`${BASE}/${id}/copy-candidates${toQueryString(query)}`, { signal }),

  /** One draft per container in the charge's group (posted at once with post). 409 DUPLICATE names a container that has it. */
  copy: (id: number, payload: CopyContainerChargeRequest) =>
    request<CopiedContainerChargeDto[]>(`${BASE}/${id}/copy`, { method: 'POST', body: payload }),

  exportToExcel: async (query: ContainerChargeQuery) =>
    saveBlob(await fetchBlob(`${BASE}/export${toQueryString({ ...query, page: undefined, pageSize: undefined })}`), 'ContainerCharges.xlsx'),
}
