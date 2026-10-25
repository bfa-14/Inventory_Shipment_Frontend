import { documentFilesApi, saveBlob } from '../documentFiles'
import { fetchBlob, postForm, request } from '../http'
import type { ImportValidationResult } from '../sales/invoiceImport'

/**
 * Transfer orders (script 90): stock moved from one warehouse (From) to another (To), of any branch, without changing
 * its cost.
 *
 * THREE DOCUMENTS, ONE PAGE. The ORDER (TRO) says what should move; a DISPATCH (TRD, numbered by the source branch)
 * takes pieces out of From onto the hidden "On the way" warehouse of the destination branch; a TRANSFER RECEIPT (TRR,
 * numbered by the destination branch) takes them from there into To, each receipt line pointing at the dispatch line
 * it receives. Dispatches and receipts are "postings" of the order: they have no page of their own and are posted
 * directly from the order's dialogs (no draft posting).
 *
 * STORED AND SHOWN STATUSES. The order stores Draft, Waiting for approval (PendingApproval), Released or Cancelled; a
 * released order SHOWS how far its postings went (Released, Partly dispatched, Dispatched, Partly received, Closed,
 * Received), worked out on the server from the counters (components/transfers/transferStatus.ts has the words and
 * the colours).
 *
 * QUANTITIES ARE PIECES wherever a name ends in `Base`; Ordered is also kept in the line's own unit (`quantity`).
 * VALUES (`…ValueBase`, `unitCostBase`, `lossUnitCostBase`) are null, never 0, for a reader who may not see stock
 * values: the server strips them, and a page shows nothing (or "—") for a null.
 *
 * EVERY RULE IS THE SERVER'S. Each action of the order comes with `abilities.{action}`: allowed, or the sentence the
 * action would be refused with (inventory.fn_TransferOrder_Blocks); each posting with canReverse / canChangeEta and
 * their reasons. components/transfers/transferAbilities.ts turns them, with the reader's permissions, into the
 * buttons. Every write answers with the whole order again (`order`), so the page replaces its copy.
 */
const BASE = '/api/inventory/transfers'

/* ── statuses, kinds, reasons ───────────────────────────────────────────────────────────────── */

/** What the order stores (inventory.TransferOrders.Status 1 / 4 / 2 / 3). "Nothing more will be sent" is a stamp. */
export type TransferOrderStatus = 'Draft' | 'PendingApproval' | 'Released' | 'Cancelled'

/** What the order shows: a released order's progress replaces "Released" (fn_TransferOrder_State, rule T7). */
export type TransferDisplayStatus =
  | 'Draft'
  | 'PendingApproval'
  | 'Released'
  | 'PartlyDispatched'
  | 'Dispatched'
  | 'PartlyReceived'
  | 'Received'
  | 'Closed'
  | 'Cancelled'

/** The list's Status filter: a shown status, or Open = released and neither Received nor Closed. */
export type TransferStatusFilter = TransferDisplayStatus | 'Open'

export type TransferPostingKind = 'Dispatch' | 'Receipt'

/** A posting is never edited: posted, or reversed in place (its reversal rows under its own number). */
export type TransferPostingStatus = 'Posted' | 'Reversed'

/** Why pieces dispatched will not arrive ("Nothing more will arrive"): written off from On the way at the average. */
export type TransferLossReasonCode = 'DAMAGED' | 'MISSING' | 'DISPATCHCOUNT' | 'OTHER'

export const TRANSFER_LOSS_REASONS: readonly { value: TransferLossReasonCode; label: string }[] = [
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'MISSING', label: 'Missing / stolen' },
  { value: 'DISPATCHCOUNT', label: 'Wrongly counted at dispatch' },
  // A note is required with it (the server refuses OTHER without one).
  { value: 'OTHER', label: 'Other' },
]

export function transferLossReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return TRANSFER_LOSS_REASONS.find((r) => r.value === code)?.label ?? code
}

/* ── the list ───────────────────────────────────────────────────────────────────────────────── */

/** A warehouse as a transfer names it: "LKS-01 - Likasi Warehouse", its branch dimmed below. */
export interface TransferWarehouseRefDto {
  id: number
  code: string
  name: string
  branchCode: string | null
  /** The order's page reads them (the header's From / To); the list sends the code only. */
  branchId?: number | null
  branchName?: string | null
}

/** The On the way warehouse a dispatch put its goods in: "OTW-BR-002 - On the way to BR-002 (transfers)". */
export interface TransferTransitWarehouseDto {
  id: number
  code: string
  name: string
}

export interface TransferOrderListItemDto {
  id: number
  /** Null on a draft whose type numbers at release ("Assigned on release"). */
  documentNumber: string | null
  /** The order date (yyyy-MM-dd). */
  documentDate: string
  /** The numbering branch: From's. */
  branchId?: number
  branchCode: string | null
  from: TransferWarehouseRefDto
  to: TransferWarehouseRefDto
  status: TransferOrderStatus
  displayStatus: TransferDisplayStatus
  /** Something to dispatch after the Expected arrival, or a dispatch with pieces on the way after its ETA (UTC today). */
  isLate: boolean
  itemCount: number
  orderedBase: number
  dispatchedBase: number
  receivedBase: number
  onTheWayBase: number
  toDispatchBase: number
  notSentBase: number
  /** Written off as lost on the way: the orange "{n} lost" badge. */
  lostBase: number
  expectedArrival: string | null
  referenceNo: string | null
  /** A return: the order it sends back ("Return of TRO-…"). */
  returnOfOrderId: number | null
  returnOfNumber: string | null
  createdAtUtc: string
  createdByName: string | null
}

/** The summary row: over every order matching the filters, not only the page. */
export interface TransferOrderTotalsDto {
  orders: number
  onTheWayBase: number
  lateOrders: number
  waitingForApproval: number
}

export interface TransferOrderListResult {
  items: TransferOrderListItemDto[]
  totalCount: number
  page: number
  pageSize: number
  totals: TransferOrderTotalsDto
}

/** The columns the search sorts by (inventory.usp_TransferOrder_Search's @SortColumn). */
export type TransferOrderSortColumn =
  | 'DocumentNumber'
  | 'DocumentDate'
  | 'FromWarehouse'
  | 'ToWarehouse'
  | 'Status'
  | 'OrderedBase'
  | 'OnTheWayBase'
  | 'ExpectedArrival'
  | 'CreatedAtUtc'

export interface TransferOrderQuery {
  /** Number, reference, From / To code or name, an item code on a line, the number of one of its dispatches or receipts. */
  search?: string
  status?: TransferStatusFilter
  /** From's OR To's branch. */
  branchId?: number
  fromWarehouseId?: number
  toWarehouseId?: number
  onTheWayOnly?: boolean
  lateOnly?: boolean
  /** The approvers' list (the menu count). */
  waitingForApproval?: boolean
  dateFrom?: string
  dateTo?: string
  itemId?: number
  sortColumn?: TransferOrderSortColumn
  sortDirection?: 'ASC' | 'DESC'
  page?: number
  /** At most 200. */
  pageSize?: number
}

/* ── the order ──────────────────────────────────────────────────────────────────────────────── */

export interface TransferOrderTotalsLineDto {
  orderedBase: number
  dispatchedBase: number
  receivedBase: number
  onTheWayBase: number
  toDispatchBase: number
  notSentBase: number
  lostBase: number
  itemCount: number
  /** Posted dispatches with pieces on the way after their ETA. */
  lateDispatches: number
}

/** The approval's stamps: who asked, who decided. All null on an order released without approval. */
export interface TransferApprovalDto {
  requestedAtUtc: string | null
  requestedByName: string | null
  /** Null when released without approval. */
  approvedAtUtc: string | null
  approvedByName: string | null
  /** Approve & release of a draft ("Approved directly"). */
  approvedDirectly: boolean
  /** Shown on the draft until it is sent again: "Rejected by {name} on {date}: {reason}". */
  rejectedAtUtc: string | null
  rejectedByName: string | null
  rejectReason: string | null
}

/** Who did something and when; `reason` where the action asks for one (Nothing more will be sent, Cancel order). */
export interface TransferStampDto {
  atUtc: string
  byName: string | null
  reason?: string | null
}

/** The order a return sends back, or a return of this order. */
export interface TransferOrderLinkDto {
  id: number
  documentNumber: string | null
  displayStatus?: TransferDisplayStatus
  status?: TransferOrderStatus
  documentDate?: string
}

/** One action of the order as the server judges it now: allowed, or the sentence it would be refused with. */
export interface TransferServerAbility {
  allowed: boolean
  reason: string | null
}

/** The actions the order answers for (inventory.fn_TransferOrder_Blocks); `editExpectedArrival` is the header's field. */
export type TransferAbilityKey =
  | 'edit'
  | 'delete'
  | 'release'
  | 'sendForApproval'
  | 'approve'
  | 'reject'
  | 'withdraw'
  | 'backToDraft'
  | 'dispatch'
  | 'receive'
  | 'dispatchAndReceive'
  | 'nothingMoreSent'
  | 'cancel'
  | 'createReturn'
  | 'updateDetails'
  | 'editExpectedArrival'

export type TransferOrderAbilitiesDto = Record<TransferAbilityKey, TransferServerAbility>

const ABILITY_KEYS: readonly TransferAbilityKey[] = [
  'edit',
  'delete',
  'release',
  'sendForApproval',
  'approve',
  'reject',
  'withdraw',
  'backToDraft',
  'dispatch',
  'receive',
  'dispatchAndReceive',
  'nothingMoreSent',
  'cancel',
  'createReturn',
  'updateDetails',
  'editExpectedArrival',
]

export interface TransferOrderLineDto {
  id: number
  lineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  itemIsActive: boolean
  itemUnitId: number
  unitName: string
  isBaseUnit: boolean
  /** Ordered, in the line's unit ("2 BOX"); orderedBase is the same in pcs ("= 24 pcs"). */
  quantity: number
  packingFormula: number
  orderedBase: number
  dispatchedBase: number
  receivedBase: number
  lostBase: number
  notSentBase: number
  /** Ordered − Dispatched − Not sent, never below 0. */
  toDispatchBase: number
  /** Dispatched − Received − Lost. Never a grid column: the totals row and the postings say it. */
  onTheWayBase: number
  notes: string | null
  /** At From: on hand, what the other released orders still take from it, and on hand less that (never below 0). */
  onHandFromBase: number
  committedFromBase: number
  availableFromBase: number
  /** At To: on hand, and what released orders (this one left out) bring to it. */
  onHandToBase: number
  incomingToBase: number
}

export interface TransferPostingLineDto {
  id: number
  postingId?: number
  /** A dispatch line takes its order line's number; a receipt numbers its lines 1..n. */
  lineNumber: number
  transferOrderLineId: number
  orderLineNumber: number
  itemId: number
  itemCode: string
  itemName: string
  /** Dispatch: pieces sent; receipt: pieces received (0 on a line that only writes off). */
  quantityBase: number
  /** Receipt lines: written off as lost. */
  lostBase: number
  lossReasonCode: TransferLossReasonCode | null
  lossNote: string | null
  /** Dispatch lines: received + lost by posted receipts. */
  settledBase: number
  /** Dispatch lines: quantity − settled while the dispatch is posted, 0 once it is reversed. */
  onTheWayBase: number
  /** Receipt lines: the dispatch line received, and its dispatch's number. */
  dispatchLineId: number | null
  dispatchNumber: string | null
  /** The average frozen at dispatch (information: a transfer moves no cost). Null without the value permission. */
  unitCostBase: number | null
  /** The average a loss was written off at. Null without the value permission, or without a loss. */
  lossUnitCostBase: number | null
}

/** A reversal: "Reversed on {date} by {name}: {reason}". */
export interface TransferReversalDto {
  /** The date the reversal counts on (yyyy-MM-dd). */
  date: string
  atUtc: string
  byName: string | null
  reason: string
}

export interface TransferPostingDto {
  id: number
  kind: TransferPostingKind
  /** TRD or TRR. */
  documentTypeCode?: string
  documentNumber: string
  postingDate: string
  /** Dispatches only (required there); null on a receipt. */
  eta: string | null
  /** Waybill / truck (dispatch), delivery note (receipt). */
  referenceNo: string | null
  notes: string | null
  status: TransferPostingStatus
  /** Dispatches: the On the way warehouse of the destination branch. */
  transitWarehouse: TransferTransitWarehouseDto | null
  /** The numbering branch: From's for a dispatch, To's for a receipt. */
  branchCode: string | null
  /** "Dispatch and receive": the receipt points at its dispatch ("Posted together with {number}"). */
  postedWithId: number | null
  postedWithNumber: string | null
  totalQuantityBase: number
  totalLostBase: number
  /** Dispatches: pieces still on the way. */
  onTheWayBase: number
  /** A posted dispatch with pieces on the way after its ETA. */
  isLate: boolean
  /** Null without the value permission. */
  valueBase: number | null
  lostValueBase: number | null
  postedAtUtc: string
  postedByName: string | null
  reversed: TransferReversalDto | null
  canReverse: boolean
  reverseBlockedReason: string | null
  canChangeEta: boolean
  changeEtaBlockedReason: string | null
  lines: TransferPostingLineDto[]
}

export interface TransferOrderAuditDto {
  id: number
  /** The dispatch or receipt the entry is about, if any. */
  postingId: number | null
  action: string
  details: string | null
  userId?: number | null
  userName: string | null
  atUtc: string
}

export interface TransferOrderDto {
  id: number
  /** Null while not numbered yet: "Assigned on the first save", or "Assigned on release" when numberOnPost. */
  documentNumber: string | null
  documentDate: string
  /** From's branch (kept up to date while a draft); it numbers the order. */
  branchId: number
  branchCode: string | null
  from: TransferWarehouseRefDto
  to: TransferWarehouseRefDto
  expectedArrival: string | null
  referenceNo: string | null
  notes: string | null
  status: TransferOrderStatus
  displayStatus: TransferDisplayStatus
  isLate: boolean
  /** The TRO type's "Needs approval before release" (Configuration › Document Types). */
  needsApproval: boolean
  /** The TRO type numbers at release instead of the first save. */
  numberOnPost: boolean
  totals: TransferOrderTotalsLineDto
  /** Σ on the way × the cost frozen at dispatch. Null without the value permission. */
  onTheWayValueBase: number | null
  approval: TransferApprovalDto
  released: TransferStampDto | null
  /** "Nothing more will be sent" (the Closed stamp), with its reason. */
  notSent: TransferStampDto | null
  cancelled: TransferStampDto | null
  /** A return: the order it sends back. */
  returnOf: TransferOrderLinkDto | null
  /** The returns of this order. */
  returns: TransferOrderLinkDto[]
  abilities: TransferOrderAbilitiesDto
  lines: TransferOrderLineDto[]
  /** Dispatches and receipts, in the order they were posted (the card shows them newest first). */
  postings: TransferPostingDto[]
  /** Newest first. */
  audit: TransferOrderAuditDto[]
  createdAtUtc: string
  createdByName: string | null
  updatedAtUtc: string | null
  updatedByName: string | null
  /** Base64 ROWVERSION of the ORDER: every action, the postings' included, sends it back. */
  rowVersion: string
}

/* ── requests ───────────────────────────────────────────────────────────────────────────────── */

export interface TransferOrderLineRequest {
  lineNumber: number
  itemId: number
  itemUnitId: number
  /** Ordered in the unit: a whole number above 0. */
  quantity: number
  notes: string | null
}

/** Creates or replaces a DRAFT, lines and all (lines may be empty on a draft). */
export interface SaveTransferOrderRequest {
  documentDate: string
  fromWarehouseId: number
  toWarehouseId: number
  expectedArrival: string | null
  referenceNo: string | null
  notes: string | null
  /** Null on a new order. */
  rowVersion: string | null
  lines: TransferOrderLineRequest[]
}

/** "Save details" of a released order: what rule T9 still lets change (on a received, closed or cancelled one: the notes). */
export interface UpdateTransferDetailsRequest {
  expectedArrival: string | null
  referenceNo: string | null
  notes: string | null
  rowVersion: string | null
}

export interface DispatchTransferLineRequest {
  transferOrderLineId: number
  /** Pieces leaving From; lines at 0 may be left out. */
  quantityBase: number
}

/** A dispatch, or "Dispatch and receive" (its `eta` is then ignored: the goods arrive the same date). */
export interface DispatchTransferRequest {
  rowVersion: string | null
  date: string
  eta: string | null
  /** "Waybill / truck". */
  referenceNo: string | null
  notes: string | null
  lines: DispatchTransferLineRequest[]
}

export interface ReceiveTransferLineRequest {
  dispatchLineId: number
  receivedBase: number
  /** The rest of the line's on-the-way pieces is written off as lost (with a reason; a note for Other). */
  nothingMoreWillArrive: boolean
  lossReasonCode: TransferLossReasonCode | null
  lossNote: string | null
}

export interface ReceiveTransferRequest {
  rowVersion: string | null
  date: string
  /** "Delivery note no." */
  referenceNo: string | null
  notes: string | null
  lines: ReceiveTransferLineRequest[]
}

export interface ReverseTransferPostingRequest {
  /** The ORDER's row version. */
  rowVersion: string | null
  reason: string
  /** Null = today; not in the future, not before the posting. */
  date: string | null
}

export interface ChangeTransferEtaRequest {
  /** The ORDER's row version. */
  rowVersion: string | null
  eta: string
}

/* ── answers ────────────────────────────────────────────────────────────────────────────────── */

/** Release, approval, back to draft, nothing more, cancel, reverse, ETA: the order again and what to tell the reader. */
export interface TransferActionResult {
  order: TransferOrderDto
  /** "TRO-BR-003-000012 released." - shown as it comes. */
  message: string
  /** Release / Approve: released orders from From needing more than it holds, one sentence each (orange). */
  warnings: string[]
  /** Send for approval: the approvers could not be emailed (orange); the order is sent for approval all the same. */
  emailWarning: string | null
}

/** A dispatch or receipt just posted. */
export interface TransferPostedRef {
  id: number
  kind: TransferPostingKind
  documentNumber: string
}

/** Dispatch, receive, dispatch and receive: the order again and the postings made (a dispatch, then its receipt). */
export interface TransferPostedResult {
  order: TransferOrderDto
  postings: TransferPostedRef[]
  /** "TRD-BR-003-000004 posted: 40 pcs left LKS-01." */
  message: string
}

/** Where an item stands at From and at To, for the lines of a draft (information only: nothing is reserved). */
export interface TransferAvailabilityDto {
  itemId: number
  onHandFromBase: number
  /** What the other released orders from From still take. */
  committedFromBase: number
  /** On hand − committed, never below 0: "Available at {From}". */
  availableFromBase: number
  onHandToBase: number
  /** On the way to To, and still to dispatch to it, on released orders: "Stock at {To}" says it beside on hand. */
  incomingToBase: number
}

export interface TransferAvailabilityQuery {
  fromWarehouseId: number
  toWarehouseId: number
  itemIds: number[]
  /** The order being edited: its own lines are not "promised to other orders". */
  excludeOrderId?: number | null
}

export interface TransferWaitingDto {
  waitingForApproval: number
}

/* ── the calls ──────────────────────────────────────────────────────────────────────────────── */

function toQueryString(query: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === false) continue
    const text = String(value).trim()
    if (text) params.set(key, text)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** A calendar date as yyyy-MM-dd, whether the API adds a midnight time or not. */
function dateOnly<T extends string | null | undefined>(value: T): T {
  return (typeof value === 'string' ? value.slice(0, 10) : value) as T
}

/**
 * Every action present: a key the answer lacks counts as allowed, so the click gets the server's own refusal sentence
 * rather than a button disabled for no reason anybody can read.
 */
function normaliseAbilities(abilities: Partial<TransferOrderAbilitiesDto> | null | undefined): TransferOrderAbilitiesDto {
  const out = {} as TransferOrderAbilitiesDto
  for (const key of ABILITY_KEYS) {
    const given = abilities?.[key]
    out[key] = { allowed: given?.allowed !== false, reason: given?.allowed === false ? (given.reason ?? null) : null }
  }
  return out
}

function normaliseRow(row: TransferOrderListItemDto): TransferOrderListItemDto {
  return { ...row, documentDate: dateOnly(row.documentDate), expectedArrival: dateOnly(row.expectedArrival ?? null) }
}

function normalisePosting(posting: TransferPostingDto): TransferPostingDto {
  return {
    ...posting,
    postingDate: dateOnly(posting.postingDate),
    eta: dateOnly(posting.eta ?? null),
    transitWarehouse: posting.transitWarehouse ?? null,
    postedWithId: posting.postedWithId ?? null,
    postedWithNumber: posting.postedWithNumber ?? null,
    valueBase: posting.valueBase ?? null,
    lostValueBase: posting.lostValueBase ?? null,
    reversed: posting.reversed ? { ...posting.reversed, date: dateOnly(posting.reversed.date) } : null,
    reverseBlockedReason: posting.reverseBlockedReason ?? null,
    changeEtaBlockedReason: posting.changeEtaBlockedReason ?? null,
    lines: (posting.lines ?? []).map((line) => ({
      ...line,
      unitCostBase: line.unitCostBase ?? null,
      lossUnitCostBase: line.lossUnitCostBase ?? null,
    })),
  }
}

/** An order released without approval: nobody asked, nobody decided. */
const NO_APPROVAL: TransferApprovalDto = {
  requestedAtUtc: null,
  requestedByName: null,
  approvedAtUtc: null,
  approvedByName: null,
  approvedDirectly: false,
  rejectedAtUtc: null,
  rejectedByName: null,
  rejectReason: null,
}

/** The order with its dates as calendar dates, every list present and every action answered. */
function normaliseOrder(order: TransferOrderDto): TransferOrderDto {
  return {
    ...order,
    documentDate: dateOnly(order.documentDate),
    expectedArrival: dateOnly(order.expectedArrival ?? null),
    onTheWayValueBase: order.onTheWayValueBase ?? null,
    approval: { ...NO_APPROVAL, ...(order.approval as Partial<TransferApprovalDto> | null | undefined) },
    released: order.released ?? null,
    notSent: order.notSent ?? null,
    cancelled: order.cancelled ?? null,
    returnOf: order.returnOf ?? null,
    returns: order.returns ?? [],
    abilities: normaliseAbilities(order.abilities),
    lines: order.lines ?? [],
    postings: (order.postings ?? []).map(normalisePosting),
    audit: order.audit ?? [],
  }
}

function normaliseAction(result: TransferActionResult): TransferActionResult {
  return { ...result, order: normaliseOrder(result.order), warnings: result.warnings ?? [], emailWarning: result.emailWarning ?? null }
}

function normalisePosted(result: TransferPostedResult): TransferPostedResult {
  return { ...result, order: normaliseOrder(result.order), postings: result.postings ?? [] }
}

export const transfersApi = {
  /** Paged, with the totals row over every order matching the filters. */
  list: async (query: TransferOrderQuery = {}, signal?: AbortSignal): Promise<TransferOrderListResult> => {
    const result = await request<TransferOrderListResult>(`${BASE}${toQueryString(query)}`, { signal })
    return {
      ...result,
      items: (result.items ?? []).map(normaliseRow),
      totals: result.totals ?? { orders: result.totalCount ?? 0, onTheWayBase: 0, lateOrders: 0, waitingForApproval: 0 },
    }
  },

  /** How many orders wait for approval: the menu count (0 for a reader who may not approve). */
  waiting: async (signal?: AbortSignal): Promise<number> => {
    const answer = await request<TransferWaitingDto>(`${BASE}/waiting`, { signal })
    const count = answer?.waitingForApproval
    return typeof count === 'number' && Number.isFinite(count) ? count : 0
  },

  /** Available at From and stock at To for the items of a draft (re-asked when an item, From or To changes). */
  availability: async (query: TransferAvailabilityQuery, signal?: AbortSignal): Promise<TransferAvailabilityDto[]> => {
    if (query.itemIds.length === 0) return []
    const qs = toQueryString({
      fromWarehouseId: query.fromWarehouseId,
      toWarehouseId: query.toWarehouseId,
      itemIds: [...new Set(query.itemIds)].join(','),
      excludeOrderId: query.excludeOrderId ?? undefined,
    })
    return (await request<TransferAvailabilityDto[]>(`${BASE}/availability${qs}`, { signal })) ?? []
  },

  get: async (id: number, signal?: AbortSignal) => normaliseOrder(await request<TransferOrderDto>(`${BASE}/${id}`, { signal })),

  /** A new draft (201): its number is given now unless the TRO type numbers at release. */
  create: async (payload: SaveTransferOrderRequest) =>
    normaliseOrder(await request<TransferOrderDto>(BASE, { method: 'POST', body: payload })),

  /** Replaces a draft, lines and all. */
  update: async (id: number, payload: SaveTransferOrderRequest) =>
    normaliseOrder(await request<TransferOrderDto>(`${BASE}/${id}`, { method: 'PUT', body: payload })),

  /** "Save details" once the order is no longer a draft (rule T9). */
  updateDetails: async (id: number, payload: UpdateTransferDetailsRequest) =>
    normaliseOrder(await request<TransferOrderDto>(`${BASE}/${id}/details`, { method: 'PUT', body: payload })),

  /** Drafts only; the number leaves a gap. */
  remove: (id: number, rowVersion: string | null) =>
    request<void>(`${BASE}/${id}${rowVersion ? `?rowVersion=${encodeURIComponent(rowVersion)}` : ''}`, { method: 'DELETE' }),

  /** Locks the lines and warehouses; the goods can then be dispatched. Answers `warnings` when From holds too little. */
  release: async (id: number, rowVersion: string | null) =>
    normaliseAction(await request<TransferActionResult>(`${BASE}/${id}/release`, { method: 'POST', body: { rowVersion } })),

  /** Waiting for approval, locked; the approvers are told (`emailWarning` when they could not be emailed). */
  sendForApproval: async (id: number, rowVersion: string | null) =>
    normaliseAction(await request<TransferActionResult>(`${BASE}/${id}/send-for-approval`, { method: 'POST', body: { rowVersion } })),

  /** Approve a waiting order, or Approve & release a draft: released either way. */
  approve: async (id: number, rowVersion: string | null) =>
    normaliseAction(await request<TransferActionResult>(`${BASE}/${id}/approve`, { method: 'POST', body: { rowVersion } })),

  /** Back to draft with the reason; the requester is emailed. */
  reject: async (id: number, rowVersion: string | null, reason: string) =>
    normaliseAction(await request<TransferActionResult>(`${BASE}/${id}/reject`, { method: 'POST', body: { rowVersion, reason } })),

  /** The requester takes the order back to draft. */
  withdraw: async (id: number, rowVersion: string | null) =>
    normaliseAction(await request<TransferActionResult>(`${BASE}/${id}/withdraw`, { method: 'POST', body: { rowVersion } })),

  /** A released order with no posting at all, reversed or not, back to draft with a reason. */
  backToDraft: async (id: number, rowVersion: string | null, reason: string) =>
    normaliseAction(await request<TransferActionResult>(`${BASE}/${id}/back-to-draft`, { method: 'POST', body: { rowVersion, reason } })),

  /** Pieces leave From for the On the way warehouse of To's branch (a TRD numbered by From's branch). */
  dispatch: async (id: number, payload: DispatchTransferRequest) =>
    normalisePosted(await request<TransferPostedResult>(`${BASE}/${id}/dispatch`, { method: 'POST', body: payload })),

  /** Pieces arrive into To from the dispatches on the way, the rest still coming or written off (a TRR numbered by To's branch). */
  receive: async (id: number, payload: ReceiveTransferRequest) =>
    normalisePosted(await request<TransferPostedResult>(`${BASE}/${id}/receive`, { method: 'POST', body: payload })),

  /** A dispatch and its receipt on one date, in one transaction (both or neither); `eta` is ignored. */
  dispatchAndReceive: async (id: number, payload: DispatchTransferRequest) =>
    normalisePosted(await request<TransferPostedResult>(`${BASE}/${id}/dispatch-and-receive`, { method: 'POST', body: payload })),

  /** What is left to dispatch becomes Not sent; goods on the way can still be received. Cannot be undone. */
  nothingMoreSent: async (id: number, rowVersion: string | null, reason: string) =>
    normaliseAction(await request<TransferActionResult>(`${BASE}/${id}/nothing-more-sent`, { method: 'POST', body: { rowVersion, reason } })),

  /** A released order with nothing dispatched: no stock moves, the number is kept. */
  cancel: async (id: number, rowVersion: string | null, reason: string) =>
    normaliseAction(await request<TransferActionResult>(`${BASE}/${id}/cancel`, { method: 'POST', body: { rowVersion, reason } })),

  /** One whole dispatch or receipt, in place (a receipt before its dispatch). */
  reversePosting: async (id: number, postingId: number, payload: ReverseTransferPostingRequest) =>
    normaliseAction(
      await request<TransferActionResult>(`${BASE}/${id}/postings/${postingId}/reverse`, { method: 'POST', body: payload }),
    ),

  /** A dispatch with goods on the way gets a new ETA (trucks are late). */
  changeEta: async (id: number, postingId: number, payload: ChangeTransferEtaRequest) =>
    normaliseAction(await request<TransferActionResult>(`${BASE}/${id}/postings/${postingId}/eta`, { method: 'POST', body: payload })),

  /** A new draft from To back to From with what was received and no earlier return takes back (201): open it. */
  createReturn: async (id: number) =>
    normaliseOrder(await request<TransferOrderDto>(`${BASE}/${id}/create-return`, { method: 'POST', body: {} })),

  /** Transfer_Order_Lines_Template.xlsx: Item Code / Barcode, Unit, Quantity, Notes. */
  downloadImportTemplate: async () =>
    saveBlob(await fetchBlob(`${BASE}/import-template`), 'Transfer_Order_Lines_Template.xlsx'),

  /**
   * Validates a lines file against the order's From (the sales import's rows and verdicts): a Warehouse or a Unit Price
   * cell is an Error row, a box barcode takes its unit. Nothing is saved: the page appends the usable rows.
   */
  importValidate: (file: File, fromWarehouseId: number, signal?: AbortSignal) => {
    const form = new FormData()
    form.append('file', file, file.name)
    form.append('fromWarehouseId', String(fromWarehouseId))
    return postForm<ImportValidationResult>(`${BASE}/import-validate`, form, signal)
  },

  /** TRO-{number}.xlsx: the order, its lines and its dispatches and receipts (values only with the permission). */
  exportToExcel: async (id: number, fileName: string) => saveBlob(await fetchBlob(`${BASE}/${id}/export`), fileName),

  /** The order's files with their type, date and note (kind TRO): any status, with the create permission. */
  files: documentFilesApi(BASE),
}
