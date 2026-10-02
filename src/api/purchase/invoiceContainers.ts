import { request } from '../http'
import type {
  AutoPlanDto,
  CreatedContainerDto,
  CreateContainersFromPlanRequest,
  ItemCapacity,
} from '../logistics/containers'

/**
 * A purchase invoice "shipped in containers": its goods enter the stock at the offload of the containers it is
 * linked to. The links are made, undone and completed from the invoice (script 43). The containers are the order's:
 * "Add container" and "Auto-plan" create them on the invoice's order and link them in the same transaction.
 */
const base = (invoiceId: number) => `/api/purchase/documents/${invoiceId}/containers`

/** One item of the invoice: what it needs in containers and what is linked. */
export interface InvoiceContainerItemDto {
  itemId: number
  itemCode: string
  itemName: string
  invoicedBase: number
  /** The item's Container unit; null when the item has none. */
  pcsPerContainer: number | null
  /** 2.5 = 2 full containers + half of one. */
  containersNeeded: number | null
  fullContainers: number | null
  partialPieces: number | null
  linkedBase: number
  containersLinked: number
  unlinkedBase: number
}

/** A container the invoice is linked to, per item. */
export interface InvoiceLinkedContainerDto {
  containerId: number
  containerRef: string
  containerNo: string | null
  status: number
  statusName: string
  itemId: number
  itemCode: string
  quantityBase: number
  maxUnits: number | null
  /** The invoice's pieces / the container's max units, in %. */
  shareOfContainerPct: number | null
  /** Draft or Confirmed only. */
  canUnlink: boolean
}

export interface InvoiceContainerSummaryDto {
  items: InvoiceContainerItemDto[]
  containers: InvoiceLinkedContainerDto[]
}

/** A container line of the invoice's order the invoice can be linked to (Draft or Confirmed, not fully invoiced). */
export interface InvoiceLinkCandidateDto {
  containerId: number
  containerRef: string
  containerNo: string | null
  containerStatus: number
  containerStatusName: string
  containerLineId: number
  containerLineNumber: number
  poLineId: number
  itemId: number
  itemCode: string
  itemName: string
  loadedBase: number
  invoicedBase: number
  availableBase: number
  /** The invoice's pieces of that order line outside containers. */
  unlinkedBase: number
}

/** "Add container" from the invoice: the order's Add Container fields and the invoice's pieces that go in. */
export interface AddInvoiceContainerRequest {
  rowVersion: string | null
  quantityBase: number
  itemId: number | null
  oilIncluded: boolean
  oilQtyPerUnit: number | null
  containerNo: string | null
  containerTypeId: number
  sealNo: string | null
  orderDate: string | null
  shippingMethod: string | null
  portOfLoadingId: number | null
  portOfDestinationId: number | null
  eta: string | null
  allowOverCapacity: boolean
}

export interface InvoiceAutoPlanRequest {
  containerTypeId: number
  mixRemainders: boolean
  capacities?: ItemCapacity[]
}

export type InvoiceContainersFromPlanRequest = Omit<CreateContainersFromPlanRequest, 'purchaseOrderId'> & {
  rowVersion: string | null
}

export interface InvoiceContainersCreatedDto {
  created: CreatedContainerDto[]
  summary: InvoiceContainerSummaryDto
}

export const invoiceContainersApi = {
  summary: (invoiceId: number, signal?: AbortSignal) => request<InvoiceContainerSummaryDto>(base(invoiceId), { signal }),

  candidates: (invoiceId: number, signal?: AbortSignal) =>
    request<InvoiceLinkCandidateDto[]>(`${base(invoiceId)}/candidates`, { signal }),

  link: (invoiceId: number, rowVersion: string | null, links: { containerLineId: number; quantityBase: number }[]) =>
    request<InvoiceContainerSummaryDto>(`${base(invoiceId)}/link`, { method: 'POST', body: { rowVersion, links } }),

  unlink: (invoiceId: number, containerId: number, rowVersion: string | null) =>
    request<InvoiceContainerSummaryDto>(
      `${base(invoiceId)}/${containerId}${rowVersion ? `?rowVersion=${encodeURIComponent(rowVersion)}` : ''}`,
      { method: 'DELETE' },
    ),

  add: (invoiceId: number, payload: AddInvoiceContainerRequest) =>
    request<InvoiceContainersCreatedDto>(`${base(invoiceId)}/add`, { method: 'POST', body: payload }),

  autoPlan: (invoiceId: number, payload: InvoiceAutoPlanRequest, signal?: AbortSignal) =>
    request<AutoPlanDto>(`${base(invoiceId)}/auto-plan`, { method: 'POST', body: payload, signal }),

  createFromPlan: (invoiceId: number, payload: InvoiceContainersFromPlanRequest) =>
    request<InvoiceContainersCreatedDto>(`${base(invoiceId)}/auto-plan/create`, { method: 'POST', body: payload }),
}
