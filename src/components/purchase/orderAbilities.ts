import type { ApprovalMeDto, ApprovalStateDto } from '../../api/purchase/approvals'
import type { PurchaseDocumentDto, PurchaseDocumentStatus } from '../../api/purchase/documents'
import { PERMISSIONS } from '../../navigation'

/**
 * WHAT CAN BE DONE ON A PURCHASE ORDER, AND WHY NOT — computed once, read by every button.
 *
 * A button the reader may never use is hidden (the permission is missing). A button the reader could
 * use on another order stays on screen, disabled, and says why: a draft has to be approved first, an
 * order waiting for approval waits, a cancelled order is finished. An approved order is never closed (script 77):
 * Saved, Partially posted and Posted are how far its invoices go, and each takes the next step its figures allow. Deciding this in each
 * button separately is how the same order came to show different buttons in different places.
 *
 * Everything here comes from the LOADED order and the permissions — never from the route, the query
 * string or how the page was reached.
 */
export interface OrderAbility {
  /** False hides the control: the reader lacks the permission. */
  visible: boolean
  /** Null when it can be pressed; otherwise the tooltip of the disabled control. */
  blockedBy: string | null
}

export interface OrderAbilities {
  /** The Containers card itself, with its list: containers.view. */
  showContainers: boolean
  addContainer: OrderAbility
  autoPlan: OrderAbility
  invoiceFromContainers: OrderAbility
  /** "Create Purchase Invoice": the order's remaining lines (an order with containers gives an invoice shipped in containers). */
  createInvoice: OrderAbility
  /**
   * "Receive goods…" (goods receipts, rule 14): the goods that arrived WITHOUT a container, on an approved order -
   * whatever its invoices, because goods may arrive before or after them. Its own reasons: never `notOpenReason`.
   */
  receiveGoods: OrderAbility

  /*
   * THE APPROVAL. Each of these belongs to ONE state of the order and is hidden in the others: they are
   * what that state is waiting for, not a later step to announce disabled. Who may approve is the
   * server's answer (GET …/approval, `approval` below), never the reader's roles; until that answer is
   * there, only the plain posting is offered, and the server refuses it with its own sentence if the
   * order needs approval after all.
   */
  /** Draft that needs approval: the request to the approvers (purchase.orders.post). */
  sendForApproval: OrderAbility
  /** Draft that needs approval, read by an in-app approver who may approve it at once (the server's canApproveDirect). */
  approveDirect: OrderAbility
  /** Draft that needs no approval: the plain posting (purchase.orders.post, and the right to save the draft first). */
  post: OrderAbility
  /** Waiting: the decision, for an approver in the app. */
  approve: OrderAbility
  reject: OrderAbility
  /** Waiting: the request again — new links, a new email — or taken back to a draft (purchase.orders.post). */
  resendApproval: OrderAbility
  withdrawApproval: OrderAbility
  /** Approved (Saved, Partially posted or Posted): the supplier email, again or for the first time (purchase.orders.post). */
  sendToSupplier: OrderAbility
}

/** The order's approval as the server answered it for this reader, and who the reader is. */
export interface OrderApprovalContext {
  state: ApprovalStateDto
  userId: number | null
}

/** Approved - Saved, Partially posted or Posted (the API's 'Posted'): the state in which an order takes containers and invoices. */
export function isApprovedOrder(status: PurchaseDocumentStatus): boolean {
  return status === 'Posted'
}

/**
 * Why an order that is not approved cannot take the next step — the same words on every
 * button. `draftReason` is the one sentence that differs: what the approval is needed for.
 */
export function notOpenReason(status: PurchaseDocumentStatus, draftReason: string): string | null {
  switch (status) {
    case 'Draft':
      return draftReason
    case 'PendingApproval':
      return 'This order is waiting for approval.'
    case 'Cancelled':
      return 'This order is cancelled.'
    default:
      return null
  }
}

/** Why "Receive goods…" cannot be used on this order (rule 14); null when it can. */
/** (script 95) The server's reason when an order's goods still to come all travel in containers: the button is hidden. */
export const ORDER_IN_CONTAINERS_TEXT = 'Everything still to receive travels in containers: it is received with its containers.'

export function receiveGoodsReason(order: PurchaseDocumentDto): string | null {
  switch (order.status) {
    case 'Draft':
      return 'Approve the order first: goods are received against an approved order.'
    case 'PendingApproval':
      return 'This order is waiting for approval.'
    case 'Cancelled':
      return 'This order is cancelled.'
    default:
      break
  }
  // THE SERVER'S ANSWER FIRST: it knows the containers and the draft receipts. The figures below are for an answer
  // without it.
  if (order.canReceive === false) return order.receiveBlockedReason ?? 'Nothing is left to receive on this order.'
  if (order.canReceive === true) return null

  let outstanding = 0
  let toReceive = 0
  let inContainers = 0
  let inDrafts = 0
  for (const line of order.lines) {
    const received = line.goodsReceivedBase ?? 0
    const short = line.goodsShortBase ?? 0
    outstanding += line.outstandingBase ?? Math.max(0, line.quantityBase - received - short)
    toReceive += line.toReceiveBase ?? 0
    inContainers += line.inContainersBase ?? 0
    inDrafts += line.inDraftReceiptsBase ?? 0
  }
  if (outstanding <= 0) return 'Everything ordered is already received.'
  if (toReceive > 0) return null
  if (inDrafts > 0) return 'The rest of this order is on draft goods receipts: post or delete them first.'
  if (inContainers > 0) return ORDER_IN_CONTAINERS_TEXT
  return null
}

function ability(visible: boolean, ...reasons: (string | null)[]): OrderAbility {
  return { visible, blockedBy: visible ? (reasons.find((r) => r !== null) ?? null) : null }
}

/**
 * @param invoiceCandidates container lines loaded and not yet invoiced (`containersApi.invoiceCandidates`)
 * @param approval the order's approval (`approvalsApi.get`); null while it loads or when it could not be read
 * @param canSaveDraft whether the reader may save this draft (the page saves unsaved changes before posting)
 */
export function orderAbilities(
  order: PurchaseDocumentDto,
  hasPermission: (permission: string) => boolean,
  invoiceCandidates: number,
  approval: OrderApprovalContext | null = null,
  canSaveDraft = false,
): OrderAbilities {
  const forContainers = notOpenReason(order.status, 'Approve the order first: containers are created from an approved order.')
  const forInvoices = notOpenReason(order.status, 'Approve the order first: invoices are created from an approved order.')
  const canCreateContainers = hasPermission(PERMISSIONS.containersCreate)
  const canCreateInvoices = hasPermission(PERMISSIONS.purchaseInvoicesCreate)
  const shipped = order.containerCount > 0
  const somethingToInvoice = order.lines.some((line) => (line.remainingBase ?? 0) > 0)

  const canPost = hasPermission(PERMISSIONS.purchaseOrdersPost)
  const state = approval?.state ?? null
  const draft = order.status === 'Draft'
  const waiting = order.status === 'PendingApproval'
  const approved = isApprovedOrder(order.status)
  const needsApproval = draft && state?.needsApproval === true
  const inAppApprover = waiting && state?.userCanApproveInApp === true
  // Self-approval off and the reader asked for it: another approver decides. The server says so too (403).
  const ownRequest =
    state !== null && !state.allowSelfApproval && state.requestedBy !== null && state.requestedBy === approval?.userId
      ? 'You sent this order for approval: another approver decides it.'
      : null

  return {
    showContainers: hasPermission(PERMISSIONS.containersView),
    addContainer: ability(canCreateContainers, forContainers),
    autoPlan: ability(canCreateContainers, forContainers),
    invoiceFromContainers: ability(
      canCreateInvoices,
      forInvoices,
      !shipped ? 'Nothing is loaded in containers yet: add a container first.' : null,
      invoiceCandidates === 0 ? 'Everything loaded in its containers is already invoiced.' : null,
    ),
    createInvoice: ability(
      canCreateInvoices,
      forInvoices,
      // Since script 43 an order with containers is invoiced directly too: the invoice is "shipped in containers".
      !somethingToInvoice ? 'Everything ordered is already invoiced.' : null,
    ),
    // (95) HIDDEN, not disabled, while everything still to come travels in containers: those goods are received from
    // their container once it is delivered (the container's Receive goods…), never from the order
    receiveGoods: ability(
      hasPermission(PERMISSIONS.goodsReceiptsCreate) && receiveGoodsReason(order) !== ORDER_IN_CONTAINERS_TEXT,
      receiveGoodsReason(order),
    ),

    sendForApproval: ability(needsApproval && canPost),
    approveDirect: ability(needsApproval && state?.canApproveDirect === true),
    post: ability(draft && !needsApproval && canPost && canSaveDraft),
    approve: ability(inAppApprover, ownRequest),
    reject: ability(inAppApprover, ownRequest),
    resendApproval: ability(waiting && canPost),
    withdrawApproval: ability(waiting && canPost),
    sendToSupplier: ability(approved && canPost),
  }
}

/** A NEW order's buttons: what the reader may create it as. */
export interface NewOrderAbilities {
  /** No approval required anywhere: create, then the usual posting. */
  createAndPost: OrderAbility
  /** Create and send for approval — or post at once when this order needs none (under the limit). */
  createAndSend: OrderAbility
  /** Create and approve at once: an in-app approver, with self-approval allowed. */
  createAndApprove: OrderAbility
}

/**
 * @param me the rules and the reader's rights (`useApprovalsMe`); null while they load — then only the
 *           request is offered, which is right either way: the server posts an order that needs no approval.
 */
export function newOrderAbilities(me: ApprovalMeDto | null, hasPermission: (permission: string) => boolean): NewOrderAbilities {
  const canCreateAndPost = hasPermission(PERMISSIONS.purchaseOrdersCreate) && hasPermission(PERMISSIONS.purchaseOrdersPost)
  return {
    createAndPost: ability(canCreateAndPost && me !== null && !me.requireApproval),
    createAndSend: ability(canCreateAndPost && me?.requireApproval !== false),
    createAndApprove: ability(canCreateAndPost && me?.requireApproval === true && me.canApproveInApp && me.allowSelfApproval),
  }
}
