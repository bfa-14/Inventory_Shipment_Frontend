import type {
  TransferAbilityKey,
  TransferDisplayStatus,
  TransferOrderDto,
  TransferPostingDto,
  TransferServerAbility,
} from '../../api/inventory/transfers'
import { PERMISSIONS } from '../../navigation'

/**
 * WHAT CAN BE DONE ON A TRANSFER ORDER, AND WHY NOT - computed once, read by every button (the orderAbilities.ts
 * pattern of the purchase orders).
 *
 * TWO SOURCES, NEVER MIXED UP (rule G7):
 *  - THE READER'S PERMISSIONS HIDE. A button the reader may never use is not on screen.
 *  - THE SERVER'S RULES DISABLE. Every action of the loaded order comes with `abilities.{action}` - allowed, or the
 *    very sentence the action would be refused with (fn_TransferOrder_Blocks) - and a posting with canReverse /
 *    canChangeEta and their reasons. The button stays on screen, disabled, and says that sentence. Nothing here
 *    re-decides a rule the server already answered.
 *
 * ONE RULE OF THE PAGE'S OWN: unsaved changes. A posting action answers with the order as the server holds it, which
 * would throw away what is being typed, so every action that changes the order is disabled with "Save your changes
 * first." while the page holds unsaved changes (and on a draft never saved, which has nothing to act on yet).
 *
 * WHICH ACTIONS, BY STORED STATUS (2.6.3): a draft - Save, Delete, Import lines from Excel…, Release (or, when the TRO
 * type needs approval, Send for approval… and Approve & release); waiting for approval - Approve, Reject…, Withdraw; a
 * released order - Dispatch…, Receive…, Dispatch and receive…, Nothing more will be sent…, Back to draft…, Cancel
 * order…, Create return…; always - Export to Excel. Outside its status an action is hidden, like a missing permission:
 * it is not a later step to announce.
 *
 * Everything comes from the LOADED order, the reader's permissions and the page's own state - never from the route.
 */
export interface TransferAbility {
  /** False hides the control: the reader lacks the permission, or the action does not belong to this status. */
  visible: boolean
  /** Null when it can be pressed; otherwise the tooltip (the phone menu's line) of the disabled control. */
  blockedBy: string | null
  /** The action the page marks filled: the phone's big button (DocumentActionBar), the order's next step. */
  primary: boolean
  /** Below 768 px a button beside the primary: Receive… on a partly dispatched order with goods on the way. */
  pinnedOnPhone: boolean
  /** Below 768 px never the big button while disabled: Cancel order… goes into the menu with its reason. */
  menuWhenDisabled: boolean
}

export interface TransferAbilities {
  /* A draft. */
  /** Save (the draft's lines, warehouses and header). */
  save: TransferAbility
  /** The draft's lines, From / To and order date can be typed into (the server's Edit answer). */
  editLines: TransferAbility
  remove: TransferAbility
  importLines: TransferAbility
  /** Hidden when the TRO type needs approval: Send for approval… and, for approvers, Approve & release take its place. */
  release: TransferAbility
  sendForApproval: TransferAbility
  /** A draft released at once by an approver ("Approved directly"); the approve route, from a draft. */
  approveAndRelease: TransferAbility

  /* Waiting for approval. */
  approve: TransferAbility
  reject: TransferAbility
  withdraw: TransferAbility

  /* Released. */
  dispatch: TransferAbility
  receive: TransferAbility
  /** Needs dispatch AND receive (the API asks for both). */
  dispatchAndReceive: TransferAbility
  nothingMoreSent: TransferAbility
  backToDraft: TransferAbility
  cancel: TransferAbility
  createReturn: TransferAbility

  /* Once no longer a draft: rule T9. */
  /** "Save details" (PUT …/details): Expected arrival, Reference and Notes of a released order; the notes later on. */
  saveDetails: TransferAbility
  /** Expected arrival and Reference No.: read-only, with the reason, on a received, closed or cancelled order. */
  editExpectedArrival: TransferAbility
  /** The Notes box of an order that is no longer a draft. */
  editNotes: TransferAbility

  /* Always. */
  exportToExcel: TransferAbility
  /** "Add document…" and the Documents card's edits: the create permission, any status, once saved. */
  addDocument: TransferAbility
}

export interface TransferAbilityContext {
  /** The page holds changes not saved yet (a draft's lines and header, or a released order's details). */
  dirty?: boolean
  /**
   * A NEW order (no `order` yet): the TRO type's "Needs approval before release" (Configuration › Document Types).
   * A loaded order carries its own (`order.needsApproval`), which wins.
   */
  needsApproval?: boolean
  /** The draft's From as the page holds it: the import validates the file against it. */
  fromWarehouseId?: number | null
}

/** The sentence of every action disabled by unsaved changes. */
export const SAVE_FIRST = 'Save your changes first.'

/** Import lines from Excel… before a From is chosen: the server's own words for a missing From (2.3.6.4). */
export const CHOOSE_FROM_FIRST = 'Choose the warehouse the goods leave from.'

/** "Add document…" on a draft never saved (the Documents card says it too). */
export const SAVE_TO_ATTACH = 'Save the draft first to attach documents.'

const HIDDEN: TransferAbility = { visible: false, blockedBy: null, primary: false, pinnedOnPhone: false, menuWhenDisabled: false }

function ability(
  visible: boolean,
  reasons: (string | null)[] = [],
  extra: Partial<Pick<TransferAbility, 'primary' | 'pinnedOnPhone' | 'menuWhenDisabled'>> = {},
): TransferAbility {
  if (!visible) return HIDDEN
  return {
    visible: true,
    blockedBy: reasons.find((r) => r !== null && r !== '') ?? null,
    primary: extra.primary ?? false,
    pinnedOnPhone: extra.pinnedOnPhone ?? false,
    menuWhenDisabled: extra.menuWhenDisabled ?? false,
  }
}

/** The server's refusal of one action, or null when it allows it. */
function refusal(server: TransferServerAbility | undefined): string | null {
  if (!server || server.allowed) return null
  // Never a button disabled for no reason anybody can read: the server always gives one, this is the safety net.
  return server.reason ?? 'Not possible on this order now: reload the page.'
}

/**
 * @param order the loaded order; null for a NEW draft not saved yet
 * @param hasPermission the reader's permissions (useAuth)
 */
export function transferAbilities(
  order: TransferOrderDto | null,
  hasPermission: (permission: string) => boolean,
  context: TransferAbilityContext = {},
): TransferAbilities {
  const can = (permission: string) => hasPermission(permission)
  const saved = order !== null
  const status = order?.status ?? 'Draft'
  const shown: TransferDisplayStatus = order?.displayStatus ?? 'Draft'
  const draft = status === 'Draft'
  const waiting = status === 'PendingApproval'
  const released = status === 'Released'
  const needsApproval = order ? order.needsApproval : context.needsApproval === true
  const dirty = context.dirty === true
  // The page's From while it is being typed, else the saved order's.
  const fromId = context.fromWarehouseId !== undefined ? context.fromWarehouseId : (order?.from.id ?? null)

  const server = (key: TransferAbilityKey) => refusal(order?.abilities[key])
  // Nothing to act on yet (a new draft), or typed changes the answer would throw away.
  const unsaved = !saved || dirty ? SAVE_FIRST : null

  const canCreate = can(PERMISSIONS.transfersCreate)
  const canRelease = can(PERMISSIONS.transfersRelease)
  const canApprove = can(PERMISSIONS.transfersApprove)
  const canDispatch = can(PERMISSIONS.transfersDispatch)
  const canReceive = can(PERMISSIONS.transfersReceive)

  /* THE DRAFT'S NEXT STEP. Save while there is something to save; else the posting the type and the reader allow: an
     approver approves and releases at once, anybody else sends for approval, and without approval the order is
     released. */
  const saveIsNext = !saved || dirty
  const releaseShown = draft && canRelease && !needsApproval
  const approveAndReleaseShown = draft && canApprove && needsApproval
  const sendShown = draft && canRelease && needsApproval

  /* A RELEASED ORDER'S NEXT STEP follows what it shows: dispatch while there is something to dispatch, receive what is
     on the way, and once everything has arrived (or nothing more will be sent) the return is what is left. */
  const dispatchIsNext = shown === 'Released' || shown === 'PartlyDispatched'
  const receiveIsNext = shown === 'Dispatched' || shown === 'PartlyReceived'
  const onTheWay = (order?.totals.onTheWayBase ?? 0) > 0

  return {
    save: ability(draft && canCreate, [server('edit')], { primary: saveIsNext }),
    editLines: ability(draft && canCreate, [server('edit')]),
    remove: ability(draft && saved && can(PERMISSIONS.transfersDelete), [server('delete')]),
    importLines: ability(draft && canCreate, [server('edit'), fromId === null ? CHOOSE_FROM_FIRST : null]),
    release: ability(releaseShown, [unsaved, server('release')], { primary: !saveIsNext }),
    sendForApproval: ability(sendShown, [unsaved, server('sendForApproval')], {
      primary: !saveIsNext && !approveAndReleaseShown,
    }),
    approveAndRelease: ability(approveAndReleaseShown, [unsaved, server('approve')], { primary: !saveIsNext }),

    approve: ability(waiting && canApprove, [unsaved, server('approve')], { primary: true }),
    reject: ability(waiting && canApprove, [unsaved, server('reject')]),
    withdraw: ability(waiting && canRelease, [unsaved, server('withdraw')]),

    dispatch: ability(released && canDispatch, [unsaved, server('dispatch')], { primary: dispatchIsNext }),
    receive: ability(released && canReceive, [unsaved, server('receive')], {
      primary: receiveIsNext,
      pinnedOnPhone: shown === 'PartlyDispatched' && onTheWay,
    }),
    dispatchAndReceive: ability(released && canDispatch && canReceive, [unsaved, server('dispatchAndReceive')]),
    nothingMoreSent: ability(released && can(PERMISSIONS.transfersClose), [unsaved, server('nothingMoreSent')]),
    backToDraft: ability(released && canRelease, [unsaved, server('backToDraft')]),
    cancel: ability(released && can(PERMISSIONS.transfersCancel), [unsaved, server('cancel')], { menuWhenDisabled: true }),
    createReturn: ability(released && canCreate, [unsaved, server('createReturn')], {
      primary: shown === 'Received' || shown === 'Closed',
    }),

    saveDetails: ability(saved && !draft && canCreate, [server('updateDetails')]),
    editExpectedArrival: ability(saved && !draft && canCreate, [server('editExpectedArrival')]),
    editNotes: ability(saved && !draft && canCreate, [server('updateDetails')]),

    exportToExcel: ability(saved && can(PERMISSIONS.transfersView)),
    addDocument: ability(canCreate, [saved ? null : SAVE_TO_ATTACH]),
  }
}

export interface TransferPostingAbilities {
  /** "Reverse…": the reverse permission; disabled with the server's reason (a receipt first, stock gone, reversed). */
  reverse: TransferAbility
  /** "Change ETA…" of a dispatch: the dispatch permission; disabled once nothing is on the way. */
  changeEta: TransferAbility
  /** "Print dispatch note" of a dispatch: whoever may view the order. */
  printDispatchNote: TransferAbility
}

/**
 * The row actions of one dispatch or receipt ("Dispatches and receipts" card). A receipt has no ETA and no dispatch
 * note, so those two are a dispatch's only.
 *
 * @param dirty the page holds unsaved changes: a reversal or a new ETA answers with the order as the server holds it
 */
export function transferPostingAbilities(
  posting: TransferPostingDto,
  hasPermission: (permission: string) => boolean,
  dirty = false,
): TransferPostingAbilities {
  const isDispatch = posting.kind === 'Dispatch'
  const unsaved = dirty ? SAVE_FIRST : null
  return {
    reverse: ability(hasPermission(PERMISSIONS.transfersReverse), [
      unsaved,
      posting.canReverse ? null : (posting.reverseBlockedReason ?? `${posting.documentNumber} cannot be reversed.`),
    ]),
    changeEta: ability(isDispatch && hasPermission(PERMISSIONS.transfersDispatch), [
      unsaved,
      posting.canChangeEta ? null : (posting.changeEtaBlockedReason ?? 'Only a dispatch with goods on the way can change its ETA.'),
    ]),
    printDispatchNote: ability(isDispatch && hasPermission(PERMISSIONS.transfersView)),
  }
}
