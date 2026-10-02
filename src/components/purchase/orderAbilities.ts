import type { ApprovalMeDto, ApprovalStateDto } from '../../api/purchase/approvals'
import type { PurchaseDocumentDto, PurchaseDocumentStatus } from '../../api/purchase/documents'
import { PERMISSIONS } from '../../navigation'

/**
 * WHAT CAN BE DONE ON A PURCHASE ORDER, AND WHY NOT — computed once, read by every button.
 *
 * A button the reader may never use is hidden (the permission is missing). A button the reader could
 * use on another order stays on screen, disabled, and says why: a draft has to be approved first, an
 * order waiting for approval waits, a closed or cancelled order is finished. Deciding this in each
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
  closeOrder: OrderAbility

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
  /** Approved (open or closed): the supplier email, again or for the first time (purchase.orders.post). */
  sendToSupplier: OrderAbility
}

/** The order's approval as the server answered it for this reader, and who the reader is. */
export interface OrderApprovalContext {
  state: ApprovalStateDto
  userId: number | null
}

/** Approved and open: the only state in which an order takes containers, invoices or a close. */
export function isOpenOrder(status: PurchaseDocumentStatus): boolean {
  return status === 'Posted'
}

/**
 * Why an order that is not approved and open cannot take the next step — the same words on every
 * button. `draftReason` is the one sentence that differs: what the approval is needed for.
 */
export function notOpenReason(status: PurchaseDocumentStatus, draftReason: string): string | null {
  switch (status) {
    case 'Draft':
      return draftReason
    case 'PendingApproval':
      return 'This order is waiting for approval.'
    case 'Closed':
      return 'This order is closed.'
    case 'Cancelled':
      return 'This order is cancelled.'
    default:
      return null
  }
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
  const approved = order.status === 'Posted' || order.status === 'Closed'
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
    closeOrder: ability(
      hasPermission(PERMISSIONS.purchaseOrdersPost),
      notOpenReason(order.status, 'Approve the order first: only an open order can be closed.'),
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
