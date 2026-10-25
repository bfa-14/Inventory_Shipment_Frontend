import { ApiError } from '../../api/http'
import type {
  TransferAvailabilityDto,
  TransferFillOutcome,
  TransferOrderDto,
  TransferOrderLineDto,
} from '../../api/inventory/transfers'
import { formatNumber } from '../format'

/**
 * (91) THE DESTINATION'S STOCK LEVEL ON A TRANSFER ORDER'S LINES (script 91, 3.6.5): Min, Max and "Projected at {To}"
 * beside each line, and the source's own Min under "Available at {From}". One place for the figures a line carries and
 * for the sentences the grid, the Fill to Max dialog and the drawer say.
 *
 * THE FIGURES ARE THE SERVER'S (inventory.fn_StockPosition): Projected = On hand + On the way in + To come in − To go
 * out, released transfer orders only. The order's own answer (usp_TransferOrder_Get) gives each line where To and From
 * stand WITH this order ("after"). A draft being typed has no such answer: the page reads where they stand WITHOUT it
 * (`/availability`, "before") and adds what the form's lines of the item order, in pcs (rule S10) - the same sum the
 * server makes for a draft (Brings = Takes = Σ Ordered of the item's lines).
 *
 * RED MEANS "AFTER THIS ORDER" (rule L19): a line is red while To's Projected after the order is still below its Min,
 * so a filled line stops being red and a capped one stays red. From going below its own Min is orange, and red wins: a
 * cell red for another reason stays red and both reasons are joined.
 */
export interface TransferLineLevels {
  toHasLevel: boolean
  toMinBase: number | null
  toMaxBase: number | null
  /** To's Projected without this order; null while not known (a line just typed, the answer not back yet). */
  toProjectedBeforeBase: number | null
  /** "Projected at {To}" with this order; null while not known. */
  toProjectedAfterBase: number | null
  /** To stays below its Min after this order. */
  isBelowMin: boolean
  fromHasLevel: boolean
  fromMinBase: number | null
  fromProjectedBeforeBase: number | null
  fromAfterBase: number | null
  /** From goes below its own Min with this order. */
  fromBelowMinAfter: boolean
}

export const NO_LEVELS: TransferLineLevels = {
  toHasLevel: false,
  toMinBase: null,
  toMaxBase: null,
  toProjectedBeforeBase: null,
  toProjectedAfterBase: null,
  isBelowMin: false,
  fromHasLevel: false,
  fromMinBase: null,
  fromProjectedBeforeBase: null,
  fromAfterBase: null,
  fromBelowMinAfter: false,
}

/** A saved line's figures, as the server worked them out with the order as it is stored. */
export function levelsOfLine(line: TransferOrderLineDto): TransferLineLevels {
  return {
    toHasLevel: line.toHasLevel,
    toMinBase: line.toMinBase,
    toMaxBase: line.toMaxBase,
    toProjectedBeforeBase: line.toProjectedBeforeBase,
    toProjectedAfterBase: line.toProjectedAfterBase,
    isBelowMin: line.isBelowMin,
    fromHasLevel: line.fromHasLevel,
    fromMinBase: line.fromMinBase,
    fromProjectedBeforeBase: line.fromProjectedBeforeBase,
    fromAfterBase: line.fromAfterBase,
    fromBelowMinAfter: line.fromBelowMinAfter,
  }
}

/** Where To and From stand WITHOUT the draft (`/availability`): the "after" figures are the page's, from its lines. */
export function levelsBefore(answer: TransferAvailabilityDto): TransferLineLevels {
  return {
    ...NO_LEVELS,
    toHasLevel: answer.toHasLevel === true,
    toMinBase: answer.toMinBase ?? null,
    toMaxBase: answer.toMaxBase ?? null,
    toProjectedBeforeBase: answer.toProjectedBeforeBase ?? null,
    fromHasLevel: answer.fromHasLevel === true,
    fromMinBase: answer.fromMinBase ?? null,
    fromProjectedBeforeBase: answer.fromProjectedBeforeBase ?? null,
  }
}

type DraftLine = TransferLineLevels & { itemId: number | null; quantity: number; packingFormula: number }

/**
 * A draft's "after" figures from what its form orders now: per ITEM, Projected at To = before + Σ Ordered (pcs) of the
 * item's lines, From after = before − the same sum (S10). A line whose "before" is not known keeps none.
 */
export function withLevelsAfter<T extends DraftLine>(lines: T[]): T[] {
  const ordered = new Map<number, number>()
  for (const line of lines) {
    if (line.itemId === null) continue
    ordered.set(line.itemId, (ordered.get(line.itemId) ?? 0) + Math.max(0, line.quantity) * (line.packingFormula || 1))
  }
  return lines.map((line) => {
    if (line.itemId === null) return { ...line, ...NO_LEVELS }
    const pieces = ordered.get(line.itemId) ?? 0
    const toAfter = line.toProjectedBeforeBase === null ? null : line.toProjectedBeforeBase + pieces
    const fromAfter = line.fromProjectedBeforeBase === null ? null : line.fromProjectedBeforeBase - pieces
    return {
      ...line,
      toProjectedAfterBase: toAfter,
      isBelowMin: line.toHasLevel && line.toMinBase !== null && toAfter !== null && toAfter < line.toMinBase,
      fromAfterBase: fromAfter,
      fromBelowMinAfter:
        line.fromHasLevel && line.fromMinBase !== null && fromAfter !== null && fromAfter < line.fromMinBase,
    }
  })
}

/**
 * The three columns show while the order still moves something to To: a draft, an order waiting for approval, a
 * released one not yet Received or Closed. Afterwards, or on a cancelled order, there is nothing left to project.
 */
export function showsLevels(order: Pick<TransferOrderDto, 'status' | 'displayStatus'> | null): boolean {
  if (order === null) return true
  if (order.status === 'Draft' || order.status === 'PendingApproval') return true
  return order.status === 'Released' && order.displayStatus !== 'Received' && order.displayStatus !== 'Closed'
}

/* ── the sentences ──────────────────────────────────────────────────────────────────────────── */

/** The Min and Max columns' tooltip. */
export function minMaxHint(to: string): string {
  return `${to}'s Min / Max for the item (Stock levels per warehouse).`
}

/** The Projected column's tooltip. */
export function projectedHint(to: string): string {
  return `What ${to} will have once this order and the other released transfer orders have arrived: on hand + coming in − going out.`
}

/** A red Projected's tooltip (and its line on a phone). */
export function belowMinText(to: string, min: number | null): string {
  return `Still below ${to}'s Min of ${formatNumber(min)} with this order.`
}

/** An orange "Available at {From}": the source goes below its own Min. */
export function fromBelowMinText(from: string, after: number | null, min: number | null): string {
  return `${from} keeps ${formatNumber(after)} pcs after this order; its own Min is ${formatNumber(min)}.`
}

/** A red "Available at {From}" (script 90's rule), said beside the orange reason when both apply (red wins). */
export function shortText(from: string, available: number, toDispatch: number): string {
  return `${from} has ${formatNumber(available)} pcs available, less than the ${formatNumber(toDispatch)} pcs this line still has to dispatch.`
}

/** "Min 20 · Max 60 · Projected 60 at LUB-01": a line's levels on a phone. */
export function levelsPhoneLine(line: TransferLineLevels, to: string): string {
  const level = (value: number | null) => (line.toHasLevel && value !== null ? formatNumber(value) : '—')
  return `Min ${level(line.toMinBase)} · Max ${level(line.toMaxBase)} · Projected ${formatNumber(line.toProjectedAfterBase)} at ${to}`
}

/** "Min 20 / Max 60", "Min 5 / no Max", "No Min at LUB-01": a level in the Fill dialog's phone card. */
export function levelText(min: number | null, max: number | null, to: string): string {
  if (min === null) return `No Min at ${to}`
  return `Min ${formatNumber(min)} / ${max === null ? 'no Max' : `Max ${formatNumber(max)}`}`
}

/** A Fill to Max result that is not a fill, in the dialog's words (3.6.5). */
export function fillOutcomeText(outcome: TransferFillOutcome, from: string, to: string): string {
  switch (outcome) {
    case 'AtOrAboveMin':
      return 'At or above Min: left as it is'
    case 'NoLevel':
      return `No Min at ${to}: left as it is`
    case 'Inactive':
      return 'Inactive item: left as it is'
    case 'Covered':
      return 'Covered by its other lines: left as it is'
    case 'NothingAvailable':
      return `Nothing available at ${from}: left as it is`
    case 'OnOrder':
      return 'Already on the order: left as it is'
    case 'Filled':
      return 'Filled'
    default:
      // An outcome this build does not know reads as itself.
      return String(outcome)
  }
}

/** "{p} pcs also on purchase orders or in containers for {To} (not counted).": dimmed under a row of the preview. */
export function purchasesToComeText(pieces: number, to: string): string {
  return `${formatNumber(pieces)} pcs also on purchase orders or in containers for ${to} (not counted).`
}

/** "Fill 4 lines", "Add 1 item". */
export function countLabel(verb: string, count: number, noun: string): string {
  return `${verb} ${formatNumber(count)} ${noun}${count === 1 ? '' : 's'}`
}

/** What the drawer and the dialog say when someone else changed the order meanwhile (a 409 CONCURRENCY). */
export const STALE_ORDER = 'Someone else changed this transfer order. Reload the page.'

/** A refusal about someone else's change (409 CONCURRENCY): the page reads the order again. */
export function isStaleOrderError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'CONCURRENCY' || (error.status === 409 && /modified by another user/i.test(error.message)))
  )
}
