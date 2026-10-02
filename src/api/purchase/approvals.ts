import { request } from '../http'
import type { PurchaseDocumentStatus, SavePurchaseDocumentRequest } from './documents'

/**
 * Purchase order approval. WHO MAY APPROVE IS THE SERVER'S TO SAY (Settings > Purchase approval): the
 * page asks, and shows the answer - it never decides from the user's roles.
 */

/* ── Settings > Purchase approval (`purchase.approval.manage`) ─────────────────────────────── */

export interface ApprovalRulesDto {
  requireApproval: boolean
  /** Orders whose total in the base currency is not above this are posted without approval; 0 = every order. */
  approvalLimitBase: number
  baseCurrencyCode: string | null
  allowSelfApproval: boolean
  linkValidHours: number
  reminderHours: number
  notifyAppApprovers: boolean
  emailSupplierOnApproval: boolean
  copyToOwners: boolean
  copyToEmails: string | null
  updatedAtUtc: string | null
  updatedByName: string | null
  rowVersion: string
}

/** Every active user, with their approval rights (both false = not an approver). */
export interface ApprovalUserDto {
  userId: number
  fullName: string
  userName: string
  email: string | null
  roles: string | null
  isAdministrator: boolean
  canApproveInApp: boolean
  canApproveByEmail: boolean
}

export interface ApprovalSettingsDto {
  settings: ApprovalRulesDto
  users: ApprovalUserDto[]
}

export interface ApproverRights {
  userId: number
  canApproveInApp: boolean
  canApproveByEmail: boolean
}

export interface SaveApprovalSettingsRequest {
  requireApproval: boolean
  approvalLimitBase: number
  allowSelfApproval: boolean
  linkValidHours: number
  reminderHours: number
  notifyAppApprovers: boolean
  emailSupplierOnApproval: boolean
  copyToOwners: boolean
  copyToEmails: string | null
  /** Every user row of the page. */
  approvers: ApproverRights[]
  rowVersion: string | null
}

export const approvalSettingsApi = {
  get: (signal?: AbortSignal) => request<ApprovalSettingsDto>('/api/purchase/approval-settings', { signal }),

  /** 400 VALIDATION with the server's message; 409 when someone else saved meanwhile. */
  save: (payload: SaveApprovalSettingsRequest) =>
    request<ApprovalSettingsDto>('/api/purchase/approval-settings', { method: 'PUT', body: payload }),
}

/* ── for every signed-in user ──────────────────────────────────────────────────────────────── */

/** The rules and the reader's own rights, and how many orders wait for them (the menu badge). */
export interface ApprovalMeDto {
  canApproveInApp: boolean
  canApproveByEmail: boolean
  requireApproval: boolean
  allowSelfApproval: boolean
  approvalLimitBase: number
  baseCurrencyCode: string | null
  pendingCount: number
}

/** An order waiting that the reader can approve in the app. */
export interface PendingApprovalDto {
  id: number
  /** The number, or "draft #id" before the order has one. */
  reference: string
  supplierId: number
  supplierName: string
  orderDate: string
  currencyCode: string
  total: number
  totalBase: number
  lineCount: number
  requestedByName: string | null
  requestedAtUtc: string | null
  waitingHours: number | null
  rowVersion: string
}

/* ── one purchase order ────────────────────────────────────────────────────────────────────── */

/** The order's approval as the SIGNED-IN USER sees it: what they may do is in here, not in their roles. */
export interface ApprovalStateDto {
  status: PurchaseDocumentStatus
  needsApproval: boolean
  requireApproval: boolean
  approvalLimitBase: number
  baseCurrencyCode: string | null
  totalBase: number
  allowSelfApproval: boolean
  userCanApproveInApp: boolean
  canApproveDirect: boolean
  requestedBy: number | null
  requestedByName: string | null
  requestedAtUtc: string | null
  linksValidUntilUtc: string | null
  nextReminderAtUtc: string | null
  lastRejectedByName: string | null
  lastRejectedAtUtc: string | null
  lastRejectReason: string | null
  supplierEmail: string | null
  sentToSupplierAtUtc: string | null
  supplierNotEmailed: boolean
}

export interface ApprovalApproverDto {
  userId: number
  fullName: string
  email: string | null
  canApproveInApp: boolean
  canApproveByEmail: boolean
  linkExpiresAtUtc: string | null
}

/** One line of the order's approval history; `eventType` is the procedure's number (see APPROVAL_EVENTS). */
export interface ApprovalEventDto {
  id: number
  eventType: number
  eventName: string
  channel: number | null
  channelName: string | null
  userId: number | null
  userName: string | null
  recipients: string | null
  reason: string | null
  note: string | null
  atUtc: string
}

export interface PurchaseOrderApprovalDto {
  state: ApprovalStateDto
  approvers: ApprovalApproverDto[]
  history: ApprovalEventDto[]
}

/** Who an order was sent to and how — never a link. */
export interface ApprovalRecipientDto {
  fullName: string
  /** Email (a personal link) | App (approves in the application). */
  channel: string
}

export interface ApprovalRequestResultDto {
  approvers: ApprovalRecipientDto[]
  message: string
}

export interface ApprovalDecisionResultDto {
  id: number
  status: PurchaseDocumentStatus
  documentNumber: string | null
  rowVersion: string
  /** True sent, false not sent (no address), null nothing was to be sent. */
  supplierEmailed: boolean | null
  warnings: string[]
  message: string
}

export interface SendToSupplierRequest {
  /** One or several addresses separated by ";" or ",". */
  to: string
  cc: string | null
  message: string | null
}

export interface SendToSupplierResultDto {
  sent: boolean
  to: string
  message: string
}

export interface CreateAndSendResultDto {
  id: number
  status: PurchaseDocumentStatus
  documentNumber: string | null
  approvalRequested: boolean
  posted: boolean
  approvers: ApprovalRecipientDto[]
  message: string
}

export interface CreateAndApproveResultDto {
  id: number
  status: PurchaseDocumentStatus
  documentNumber: string | null
  approved: boolean
  posted: boolean
  /** As approve-now: true sent, false not sent (no address), null nothing was to be sent. */
  supplierEmailed: boolean | null
  /** As approve-now: what went wrong with the follow-up emails. */
  warnings: string[]
  message: string
}

const ORDERS = '/api/purchase/documents'

/**
 * Every call answers its refusal with the server's own sentence: 409 APPROVAL_NOT_NEEDED,
 * EMAIL_LINKS_NOT_SET, NO_APPROVER and CONCURRENCY, 403 SELF_APPROVAL and NOT_APPROVER, 400 VALIDATION.
 */
export const approvalsApi = {
  me: (signal?: AbortSignal) => request<ApprovalMeDto>('/api/purchase/approvals/me', { signal }),
  pending: (signal?: AbortSignal) => request<PendingApprovalDto[]>('/api/purchase/approvals/pending', { signal }),

  get: (id: number, signal?: AbortSignal) => request<PurchaseOrderApprovalDto>(`${ORDERS}/${id}/approval`, { signal }),

  sendForApproval: (id: number, rowVersion: string | null) =>
    request<ApprovalRequestResultDto>(`${ORDERS}/${id}/send-for-approval`, { method: 'POST', body: { rowVersion } }),
  resend: (id: number, rowVersion: string | null) =>
    request<ApprovalRequestResultDto>(`${ORDERS}/${id}/resend-approval`, { method: 'POST', body: { rowVersion } }),
  withdraw: (id: number, rowVersion: string | null, reason: string | null = null) =>
    request<ApprovalDecisionResultDto>(`${ORDERS}/${id}/withdraw-approval`, { method: 'POST', body: { reason, rowVersion } }),

  approve: (id: number, rowVersion: string | null) =>
    request<ApprovalDecisionResultDto>(`${ORDERS}/${id}/approve`, { method: 'POST', body: { rowVersion } }),
  /** The reason is required (400 without one). */
  reject: (id: number, reason: string, rowVersion: string | null) =>
    request<ApprovalDecisionResultDto>(`${ORDERS}/${id}/reject`, { method: 'POST', body: { reason, rowVersion } }),
  /** A draft that needs approval, approved at once by an in-app approver. */
  approveNow: (id: number, rowVersion: string | null) =>
    request<ApprovalDecisionResultDto>(`${ORDERS}/${id}/approve-now`, { method: 'POST', body: { rowVersion } }),

  sendToSupplier: (id: number, payload: SendToSupplierRequest) =>
    request<SendToSupplierResultDto>(`${ORDERS}/${id}/send-to-supplier`, { method: 'POST', body: payload }),

  /** The draft, then the request for approval — or the posting when none is needed. A refused request keeps the draft. */
  createAndSend: (payload: SavePurchaseDocumentRequest) =>
    request<CreateAndSendResultDto>(`${ORDERS}/create-and-send`, { method: 'POST', body: payload }),
  /** The draft approved at once (or posted when approval is not needed). A refusal keeps the draft. */
  createAndApprove: (payload: SavePurchaseDocumentRequest) =>
    request<CreateAndApproveResultDto>(`${ORDERS}/create-and-approve`, { method: 'POST', body: payload }),
}

/* ── the public approval page (no sign-in: the link's token is the proof) ──────────────────── */

export interface PublicApprovalOrderDto {
  documentNumber: string | null
  supplierName: string
  orderDate: string
  currencyCode: string
  decimalPlaces: number
  total: number
  lineCount: number
  requestedByName: string | null
  requestedAtUtc: string | null
  notes: string | null
}

export interface PublicApprovalLineDto {
  lineNo: number
  itemCode: string
  itemName: string
  unitName: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface PublicApprovalDto {
  order: PublicApprovalOrderDto
  lines: PublicApprovalLineDto[]
  approverName: string
  linkExpiresAtUtc: string
}

export interface PublicDecisionResultDto {
  status: PurchaseDocumentStatus
  documentNumber: string | null
  message: string
}

const PUBLIC = '/api/public/purchase-approval'

/** 410 LINK_NOT_USABLE, 403 NOT_APPROVER / SELF_APPROVAL with the server's sentence; 429 beyond 30 a minute. */
export const publicApprovalApi = {
  get: (token: string, signal?: AbortSignal) =>
    request<PublicApprovalDto>(`${PUBLIC}/${encodeURIComponent(token)}`, { auth: false, signal }),
  decide: (token: string, approve: boolean, reason: string | null) =>
    request<PublicDecisionResultDto>(`${PUBLIC}/${encodeURIComponent(token)}/decision`, {
      method: 'POST',
      auth: false,
      body: { approve, reason },
    }),
}
