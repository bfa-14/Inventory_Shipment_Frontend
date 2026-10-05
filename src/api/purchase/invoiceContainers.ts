import { request } from '../http'
import type {
  AutoPlanDto,
  CreatedContainerDto,
  CreateContainersFromPlanRequest,
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
  /** The item's pieces in a full container (its Container unit); null when it has none. */
  pcsPerContainer: number | null
  /** The invoice's pieces / the item's pieces per container, in % (script 50); null without a Container unit. */
  shareOfContainerPct: number | null
  /** Draft or Confirmed only. */
  canUnlink: boolean
}

/**
 * What the invoice can do with containers now, and why not (script 47). The rules: 1 a purchase invoice, draft or
 * posted; 2 created from a purchase order; 3 one item (a draft); 4 shipped in containers; 5 its order approved or
 * closed; 6 pieces not in a container; 7 the order lines still allow pieces; 8 at most maxAddQty in a new container;
 * 9 the reader's permissions. The reasons are the server's sentences - the add and the link refuse with the same.
 */
export interface InvoiceContainerStateDto {
  canAddContainers: boolean
  reason: string | null
  /** 1-9; null when every rule holds. */
  failedRule: number | null
  /** A draft with "Shipped in containers" off that may turn it on (the save of the invoice). */
  canTurnOnShipped: boolean
  notInContainerQty: number
  /** What the order lines still allow: ordered - invoiced outside containers - loaded in containers. */
  orderLinesAvailableQty: number
  /** The most a new container may take. */
  maxAddQty: number
  pcsPerContainer: number | null
  canLink: boolean
  linkReason: string | null
}

export interface InvoiceContainerSummaryDto {
  items: InvoiceContainerItemDto[]
  containers: InvoiceLinkedContainerDto[]
  /** Set on every answer of the API. */
  state: InvoiceContainerStateDto | null
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
