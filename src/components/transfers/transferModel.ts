import type {
  TransferOrderDto,
  TransferOrderLineDto,
  TransferPostingDto,
  TransferWarehouseRefDto,
} from '../../api/inventory/transfers'
import type { ItemUnitDto, TrackingKind, WarehouseLookupDto } from '../../api/types'
import { formatNumber } from '../format'
import { NOT_ONE_OF_YOURS } from '../documents/lineWarehouses'
import { levelsOfLine, NO_LEVELS, type TransferLineLevels } from './transferLevels'
import { transferStatusLabel } from './transferStatus'

/**
 * THE TRANSFER ORDER PAGE'S OWN MODEL (script 90): the line being typed, the warehouses offered, and the sentences the
 * page and its dialogs say. Kept out of the components so they stay components (fast refresh), and so one sentence is
 * written once.
 */

/* ── names ──────────────────────────────────────────────────────────────────────────────────── */

/** {No} in the sentences: the order's number, else the server's own words for an order without one. */
export function orderLabel(order: Pick<TransferOrderDto, 'documentNumber'> | null): string {
  return order?.documentNumber ?? 'this transfer order'
}

/** "LKS-01 - Likasi Warehouse". */
export function warehouseText(ref: Pick<TransferWarehouseRefDto, 'code' | 'name'> | null | undefined): string {
  if (!ref) return '—'
  return ref.name ? `${ref.code} - ${ref.name}` : ref.code
}

/** The branch a warehouse belongs to, as the list and the header say it below the warehouse (dimmed). */
export function warehouseBranch(
  ref: Pick<TransferWarehouseRefDto, 'branchCode' | 'branchName'> | null | undefined,
): string | null {
  if (!ref) return null
  return ref.branchName ?? ref.branchCode ?? null
}

/** Today in UTC (yyyy-MM-dd): the day the server's Late is worked out on (rule T27). */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/** A stored reason followed by more of the sentence: its own full stop is dropped, the sentence adds one. */
export function withoutFullStop(text: string | null | undefined): string {
  return (text ?? '').trim().replace(/[.]+$/, '')
}

/** "TRD-BR-003-000004, TRD-BR-003-000005": a list of numbers in a sentence. */
export function numberList(numbers: string[]): string {
  return numbers.join(', ')
}

/* ── the warehouses offered (From and To) ───────────────────────────────────────────────────── */

export interface WarehouseOption {
  value: string
  label: string
}

export interface WarehouseGroup {
  group: string
  items: WarehouseOption[]
}

/** An On the way warehouse (script 90): the lookup never offers one unless asked; this is the guard all the same. */
const isTransit = (w: WarehouseLookupDto) => w.isTransit === true
const isLeaf = (w: WarehouseLookupDto) => w.childCount === 0

/**
 * The From and To pickers: every active warehouse AT THE BOTTOM OF THE TREE, of every branch, grouped by branch, the
 * order's branch first - never an On the way warehouse (rule T28).
 *
 * A WAREHOUSE THE ORDER HOLDS STAYS SHOWN when it is no longer allowed (made inactive, given warehouses under it since
 * the draft was saved), marked the way a document line's is (lineWarehouses.ts), so the field never goes blank and the
 * server's refusal points at something the reader can see. Only the order's own warehouses are kept.
 *
 * `usableOnly` (92, the FROM picker): only the leaves the reader may use (`canUse` of the lookup, missing = true), a
 * kept one they may not use marked "- not one of your warehouses" (the parent's and the inactive mark win). The order
 * is the source's document (A9): the To may be any warehouse, so its picker leaves this out.
 */
export function transferWarehouseChoices(
  warehouses: WarehouseLookupDto[],
  keep: (TransferWarehouseRefDto | null | undefined)[],
  firstBranchId: number | null,
  usableOnly = false,
): WarehouseGroup[] {
  const keptIds = new Set(keep.filter((k): k is TransferWarehouseRefDto => !!k).map((k) => k.id))
  const usable = (w: WarehouseLookupDto) => !usableOnly || w.canUse !== false
  const shown = warehouses
    .filter((w) => !isTransit(w) && ((w.isActive && isLeaf(w) && usable(w)) || keptIds.has(w.id)))
    .sort(
      (a, b) =>
        Number(b.branchId === firstBranchId) - Number(a.branchId === firstBranchId) ||
        a.branchName.localeCompare(b.branchName) ||
        a.warehouseCode.localeCompare(b.warehouseCode),
    )

  const groups = new Map<string, WarehouseOption[]>()
  for (const w of shown) {
    const group = `${w.branchCode} - ${w.branchName}`
    const base = `${w.warehouseCode} - ${w.warehouseName}`
    const label = !isLeaf(w)
      ? `${base} - has warehouses under it, choose one of those`
      : !w.isActive
        ? `${base} (inactive)`
        : usable(w)
          ? base
          : `${base} - ${NOT_ONE_OF_YOURS}`
    const list = groups.get(group) ?? []
    list.push({ value: String(w.id), label })
    groups.set(group, list)
  }
  const result: WarehouseGroup[] = [...groups.entries()].map(([group, items]) => ({ group, items }))

  // A kept warehouse the lookup does not return at all still shows by its own name.
  const missing = keep.filter(
    (k, index): k is TransferWarehouseRefDto =>
      !!k && !shown.some((w) => w.id === k.id) && keep.findIndex((m) => m?.id === k.id) === index,
  )
  if (missing.length > 0)
    result.unshift({ group: 'Current', items: missing.map((k) => ({ value: String(k.id), label: warehouseText(k) })) })
  return result
}

/** The code of a warehouse picked in the header, for the column titles and the dialogs ("Available at LKS-01"). */
export function warehouseCodeOf(
  id: string | number | null,
  warehouses: WarehouseLookupDto[],
  fallback: TransferWarehouseRefDto | null | undefined,
): string | null {
  if (id === null || id === '') return null
  const numeric = Number(id)
  const found = warehouses.find((w) => w.id === numeric)
  if (found) return found.warehouseCode
  return fallback && fallback.id === numeric ? fallback.code : null
}

/* ── a line as it is typed ──────────────────────────────────────────────────────────────────── */

/** A unit the line may take: the barcode is how a scanned box finds its own unit (decision D10). */
export type TransferUnitOption = Pick<ItemUnitDto, 'id' | 'unitTypeName' | 'packingFormula' | 'isBaseUnit'> & {
  barcode?: string | null
}

/**
 * One line of the order on the page. On a draft it is a form - an item, a unit, Ordered in that unit, notes - and
 * every reference is nullable while it is half typed; once released its counters are the server's (in pcs).
 *
 * (91) It also carries To's stock level and where To and From stand (`TransferLineLevels`, transferLevels.ts): the
 * server's on a saved line, the page's own sum on a draft being typed.
 */
export interface TransferLineForm extends TransferLineLevels {
  /** Stable across re-renders; not the id (a new line has none). */
  key: string
  /** The order line's id once saved: what the dispatch dialog's preselection points at. */
  id: number | null
  lineNumber: number
  itemId: number | null
  itemCode: string
  itemName: string
  itemUnitId: number | null
  unitName: string
  packingFormula: number
  /** Ordered, in the line's unit: a whole number above 0. */
  quantity: number
  notes: string
  /** What the Unit select offers; seeded with the line's own unit until the item's units arrive. */
  units: TransferUnitOption[]
  /* The server's counters, in pcs (0 on a draft: a draft has no posting, rule D3). */
  dispatchedBase: number
  receivedBase: number
  lostBase: number
  notSentBase: number
  onTheWayBase: number
  /* Where the item stands at From and at To: null while not known (a line just typed, the answer not back yet). */
  onHandFromBase: number | null
  committedFromBase: number | null
  availableFromBase: number | null
  onHandToBase: number | null
  incomingToBase: number | null
  /**
   * (93) What Dispatch… asks for the line: the item's tracking, from the order's Get, and from the item's own answer as
   * soon as an item is chosen on a line (a new line, or a saved one changed to another item).
   */
  trackingKind: TrackingKind | null
  requiresExpiry: boolean
  /** A "Line N: …" refusal about this line. */
  error?: string
}

let keySeed = 0
export const nextLineKey = () => `transfer-line-${++keySeed}`

export function emptyTransferLine(): TransferLineForm {
  return {
    key: nextLineKey(),
    id: null,
    lineNumber: 0,
    itemId: null,
    itemCode: '',
    itemName: '',
    itemUnitId: null,
    unitName: '',
    packingFormula: 1,
    quantity: 1,
    notes: '',
    units: [],
    dispatchedBase: 0,
    receivedBase: 0,
    lostBase: 0,
    notSentBase: 0,
    onTheWayBase: 0,
    onHandFromBase: null,
    committedFromBase: null,
    availableFromBase: null,
    onHandToBase: null,
    incomingToBase: null,
    ...NO_LEVELS,
    trackingKind: null,
    requiresExpiry: false,
  }
}

export function toTransferLineForm(line: TransferOrderLineDto): TransferLineForm {
  return {
    key: nextLineKey(),
    id: line.id,
    lineNumber: line.lineNumber,
    itemId: line.itemId,
    itemCode: line.itemCode,
    itemName: line.itemName,
    itemUnitId: line.itemUnitId,
    unitName: line.unitName,
    packingFormula: line.packingFormula || 1,
    quantity: line.quantity,
    notes: line.notes ?? '',
    units: [
      {
        id: line.itemUnitId,
        unitTypeName: line.unitName,
        packingFormula: line.packingFormula || 1,
        isBaseUnit: line.isBaseUnit,
      },
    ],
    dispatchedBase: line.dispatchedBase,
    receivedBase: line.receivedBase,
    lostBase: line.lostBase,
    notSentBase: line.notSentBase,
    onTheWayBase: line.onTheWayBase,
    onHandFromBase: line.onHandFromBase,
    committedFromBase: line.committedFromBase,
    availableFromBase: line.availableFromBase,
    onHandToBase: line.onHandToBase,
    incomingToBase: line.incomingToBase,
    ...levelsOfLine(line),
    trackingKind: line.trackingKind ?? null,
    requiresExpiry: line.requiresExpiry === true,
  }
}

/** Ordered in pcs: "2 BOX" of twelve is 24. */
export function orderedBaseOf(line: Pick<TransferLineForm, 'quantity' | 'packingFormula'>): number {
  return line.quantity * (line.packingFormula || 1)
}

/** Ordered − Dispatched − Not sent, never below 0 (rule T10). */
export function toDispatchOf(line: TransferLineForm): number {
  return Math.max(0, orderedBaseOf(line) - line.dispatchedBase - line.notSentBase)
}

/** The totals row (rule T11), in pcs. */
export interface TransferTotals {
  orderedBase: number
  dispatchedBase: number
  receivedBase: number
  onTheWayBase: number
  notSentBase: number
  lostBase: number
}

export function totalsOfLines(lines: TransferLineForm[]): TransferTotals {
  const totals: TransferTotals = {
    orderedBase: 0,
    dispatchedBase: 0,
    receivedBase: 0,
    onTheWayBase: 0,
    notSentBase: 0,
    lostBase: 0,
  }
  for (const line of lines) {
    totals.orderedBase += orderedBaseOf(line)
    totals.dispatchedBase += line.dispatchedBase
    totals.receivedBase += line.receivedBase
    totals.onTheWayBase += line.onTheWayBase
    totals.notSentBase += line.notSentBase
    totals.lostBase += line.lostBase
  }
  return totals
}

/** "12 on hand · 40 promised to other orders": the Available cell's tooltip, when other orders take some. */
export function availabilityTooltip(line: TransferLineForm): string | null {
  if (line.committedFromBase === null || line.committedFromBase <= 0) return null
  return `${formatNumber(line.onHandFromBase ?? 0)} on hand · ${formatNumber(line.committedFromBase)} promised to other orders`
}

/**
 * The unit a scanned term stands for (decision D10): the unit whose barcode IS the term - a box's barcode scans the
 * box - else the base unit.
 */
export function unitForScan(units: TransferUnitOption[], term: string): TransferUnitOption | undefined {
  const wanted = term.trim()
  const exact = units.find((u) => (u.barcode ?? '').trim() === wanted && wanted !== '')
  const loose =
    exact ?? units.find((u) => wanted !== '' && (u.barcode ?? '').trim().toLowerCase() === wanted.toLowerCase())
  return loose ?? units.find((u) => u.isBaseUnit) ?? units[0]
}

/* ── the sentences ──────────────────────────────────────────────────────────────────────────── */

/** Under From and To on a draft. */
export const WAREHOUSES_HINT = "The warehouses are the order's: every line leaves From and goes to To."

/** A draft of a type that needs approval, for a reader who cannot approve. */
export const NEEDS_APPROVAL_HINT = 'This order needs approval before release: Send for approval… tells the approvers.'

export const RELEASE_TEXT =
  'Its lines, quantities and warehouses are locked; the goods can then be dispatched. Release reserves no stock.'

export const SEND_FOR_APPROVAL_TEXT =
  'The users who may approve transfer orders are told in the application and by email. The order is locked until it is approved, rejected or withdrawn.'

export const APPROVE_TEXT = 'It is released: the goods can then be dispatched.'

export const REJECT_TEXT = 'It goes back to draft with your reason; the requester is told by email.'

export function backToDraftText(needsApproval: boolean): string {
  return `Its lines and warehouses can be changed again; it is released again afterwards${needsApproval ? ' (and approved again)' : ''}.`
}

export function nothingMoreSentText(toDispatchBase: number, onTheWayBase: number): string {
  return `The ${formatNumber(toDispatchBase)} pcs still to dispatch become Not sent. Ordered stays as it is; goods already on the way (${formatNumber(onTheWayBase)} pcs) can still be received. This cannot be undone.`
}

export const CANCEL_ORDER_TEXT = 'Nothing has been dispatched, so no stock moves. The order keeps its number.'

export function createReturnText(order: TransferOrderDto): string {
  return `A new draft transfer order from ${order.to.code} to ${order.from.code} is created with the pieces received that no earlier return takes back. This order does not change.`
}

/** What a reversal does (rule T23-T24), said in its dialog before the reason is typed. */
export function reverseText(posting: TransferPostingDto, order: TransferOrderDto): string {
  if (posting.kind === 'Dispatch') {
    const q = formatNumber(posting.totalQuantityBase)
    return `The ${q} pcs go back to ${order.from.code}; the order's dispatched quantity goes down by ${q} pcs.${
      order.notSent ? ' Nothing more will be sent on this order: they are added to Not sent.' : ''
    }`
  }
  return `The ${formatNumber(posting.totalQuantityBase)} pcs received leave ${order.to.code} and go back On the way${
    posting.totalLostBase > 0
      ? ` and the ${formatNumber(posting.totalLostBase)} pcs written off are put back On the way`
      : ''
  }.`
}

/** The closed order's notice (the "Nothing more will be sent" stamp). */
export function notSentNotice(order: TransferOrderDto, when: string): string {
  const stamp = order.notSent
  return `Nothing more will be sent (on ${when} by ${stamp?.byName ?? 'unknown'}): ${withoutFullStop(stamp?.reason)}. ${formatNumber(order.totals.notSentBase)} pcs not sent.`
}

/** "Returns: TRO-BR-002-000003 (Draft)": the label of one return of the order. */
export function returnLabel(link: {
  documentNumber: string | null
  id: number
  displayStatus?: TransferOrderDto['displayStatus']
}): string {
  const number = link.documentNumber ?? `#${link.id}`
  return link.displayStatus ? `${number} (${transferStatusLabel(link.displayStatus)})` : number
}
