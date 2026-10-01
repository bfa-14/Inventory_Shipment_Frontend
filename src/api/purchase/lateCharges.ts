import { request } from '../http'
import type { ChargeAllocationMethod } from './chargeTypes'
import type { LandedCostAdjustmentStatus } from './landedCostAdjustments'

/**
 * Late charges of a POSTED local purchase invoice: the freight bill that arrives after the goods,
 * entered from the invoice itself.
 *
 * THEY ARE LANDED COST ADJUSTMENTS. Each one goes into the invoice's open draft adjustment (created
 * on the first); "Post late charges" posts that adjustment. An imported invoice (from containers)
 * and an invoice that is not posted answer 409.
 */
const base = (invoiceId: number) => `/api/purchase/documents/${invoiceId}/late-charges`

/** The open draft adjustment: what "Post late charges" will post. */
export interface LateChargeDraftDto {
  id: number
  number: string
  date: string
  /** Sent back with the post, so charges added meanwhile by somebody else are not posted unseen. */
  rowVersion: string
  /** The charges that reach the item cost, in the base currency. */
  totalBase: number
}

export interface LateChargeDto {
  /** A DRAFT adjustment's charges are rewritten on every save, so their ids change with it: use the latest list. */
  id: number
  adjustmentId: number
  adjustmentNumber: string
  status: LandedCostAdjustmentStatus
  postedAtUtc: string | null
  lineNumber: number
  chargeTypeId: number
  chargeTypeCode: string
  chargeTypeName: string
  description: string | null
  providerPartyId: number | null
  providerName: string | null
  reference: string | null
  /** The adjustment's date. */
  chargeDate: string
  currencyId: number
  currencyCode: string
  rateType: number
  exchangeRate: number
  amount: number
  amountBase: number
  allocationMethod: ChargeAllocationMethod
  includeInLandedCost: boolean
  notes: string | null
  allocatedBase: number | null
  canEdit: boolean
}

export interface LateChargesDto {
  draftAdjustment: LateChargeDraftDto | null
  /** Every adjustment's charges, the newest adjustment first. */
  charges: LateChargeDto[]
}

export interface SaveLateChargeRequest {
  chargeTypeId: number
  description: string | null
  providerPartyId: number | null
  reference: string | null
  /** Becomes the draft adjustment's date, and the date the rate is read at when none is sent. */
  chargeDate: string
  currencyId: number | null
  rateType: number
  exchangeRate: number | null
  amount: number
  /** Value, Quantity, Weight or Volume — a late charge has no manual split. */
  allocationMethod: ChargeAllocationMethod
  /** The charge type's flag; the server refuses a different one. */
  includeInLandedCost: boolean
  notes: string | null
}

/** One invoice line as the posting moved it. */
export interface LateChargePostedLineDto {
  lineNo: number
  itemCode: string
  itemName: string
  warehouseCode: string
  landedCostBefore: number
  landedCostAfter: number
  /** Still in stock: it raised the item's average cost. */
  inventoryPortionBase: number
  /** Already sold: it went to the cost of goods sold. */
  cogsPortionBase: number
}

export interface LateChargesPostedDto {
  adjustmentId: number
  adjustmentNumber: string
  lines: LateChargePostedLineDto[]
}

export const lateChargesApi = {
  get: (invoiceId: number, signal?: AbortSignal) => request<LateChargesDto>(base(invoiceId), { signal }),

  add: (invoiceId: number, payload: SaveLateChargeRequest) =>
    request<LateChargesDto>(base(invoiceId), { method: 'POST', body: payload }),

  update: (invoiceId: number, chargeId: number, payload: SaveLateChargeRequest) =>
    request<LateChargesDto>(`${base(invoiceId)}/${chargeId}`, { method: 'PUT', body: payload }),

  remove: (invoiceId: number, chargeId: number) =>
    request<LateChargesDto>(`${base(invoiceId)}/${chargeId}`, { method: 'DELETE' }),

  post: (invoiceId: number, rowVersion: string | null) =>
    request<LateChargesPostedDto>(`${base(invoiceId)}/post`, { method: 'POST', body: { rowVersion } }),
}
