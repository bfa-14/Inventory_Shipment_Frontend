import { formatNumber } from '../format.ts'

/*
 * LATE CHARGES: a charge posted after the container's goods were received (the container Offloaded). Its post adjusts
 * the cost of goods already in the company's hands - the pieces still in stock take it in their average cost, the pieces
 * already sold in cost of sales (usp_ContainerCharge_ApplyCost) - and the container line's landed cost follows it. Two
 * readers: the post confirmations (the split before the click, from POST post-preview, script 118) and the container
 * page's Landed / unit (the late part of it, from the charges and their allocations it already has).
 */

/** The fields of a post preview the sentence reads (ChargePostPreviewDto). */
export interface LateChargePreview {
  containerRef: string
  chargeName: string
  afterReceipt: boolean
  receivedBase: number | null
  inStockBase: number | null
  toStockBase: number | null
  toCostOfSalesBase: number | null
  problem: string | null
}

/** The first refusal a post would give (the post is all or nothing), or null. */
export function postPreviewProblem(previews: readonly LateChargePreview[]): string | null {
  return previews.find((p) => p.problem)?.problem ?? null
}

function amount(value: number, currency: string | undefined): string {
  return `${formatNumber(Math.abs(value), 2)}${currency ? ` ${currency}` : ''}`
}

function pieces(n: number): string {
  return `${formatNumber(n)} ${n === 1 ? 'pc' : 'pcs'}`
}

/**
 * What a post confirmation says about the late charges among those being posted - null when none is late (the usual
 * sentence then). One charge: where its goods are and how its amount splits:
 *   "KTG-2026-0031's goods are received: 84 pcs, 80 of them still in stock. 2,800.00 USD goes to their average cost and
 *    140.00 USD to cost of sales (the pieces already sold)."
 * A deduction "comes off" instead. Several charges: their totals ("Of these, 3 are on goods already received: ...").
 */
export function lateChargeSentence(previews: readonly LateChargePreview[], currency?: string): string | null {
  const late = previews.filter((p) => p.afterReceipt && !p.problem)
  if (late.length === 0) return null

  const toStock = late.reduce((s, p) => s + (p.toStockBase ?? 0), 0)
  const toSales = late.reduce((s, p) => s + (p.toCostOfSalesBase ?? 0), 0)
  const SOLD = 'cost of sales (the pieces already sold)'
  let split: string
  if (toStock * toSales < 0) {
    // a charge and a deduction together pulling apart: each figure with its sign
    const signed = (v: number) => `${v < 0 ? '−' : '+'}${amount(v, currency)}`
    split = `${signed(toStock)} on their average cost and ${signed(toSales)} on ${SOLD}.`
  } else {
    const off = toStock + toSales < 0
    const verb = off ? 'comes off' : 'goes to'
    split =
      toStock !== 0 && toSales !== 0
        ? `${amount(toStock, currency)} ${verb} their average cost and ${amount(toSales, currency)} ${off ? 'off' : 'to'} ${SOLD}.`
        : toSales !== 0
          ? `${amount(toSales, currency)} ${verb} ${SOLD}.`
          : `${amount(toStock, currency)} ${verb} their average cost.`
  }

  if (late.length === 1 && previews.length === 1) {
    const p = late[0]
    const received = p.receivedBase ?? 0
    const inStock = p.inStockBase ?? 0
    const held =
      inStock >= received ? 'all of them still in stock' : inStock <= 0 ? 'none of them still in stock' : `${formatNumber(inStock)} of them still in stock`
    return `${p.containerRef}'s goods are received: ${pieces(received)}, ${held}. ${split}`
  }

  const refs = [...new Set(late.map((p) => p.containerRef))]
  const what = late.length === previews.length
    ? `All ${formatNumber(late.length)} are on goods already received`
    : `Of these, ${formatNumber(late.length)} ${late.length === 1 ? 'is' : 'are'} on goods already received`
  return `${what} (${refs.slice(0, 3).join(', ')}${refs.length > 3 ? ` and ${formatNumber(refs.length - 3)} more` : ''}): ${split}`
}

/** The fields of a charge row and an allocation the late part reads (ContainerChargeRowDto, ContainerChargeAllocationDto). */
export interface ChargeRowLike {
  id: number
  status: number
  includeInLandedCost: boolean
  adjustedAfterOffload: boolean
}
export interface AllocationLike {
  chargeId: number
  containerLineId: number
  amountBase: number
}

/**
 * Per container line, what the charges posted after the goods were received put on it (base currency): the part of its
 * landed cost that came after the goods receipt. Lines without one are left out.
 */
export function lateChargesByLine(charges: readonly ChargeRowLike[], allocations: readonly AllocationLike[]): Map<number, number> {
  const late = new Set(charges.filter((c) => c.status === 2 && c.includeInLandedCost && c.adjustedAfterOffload).map((c) => c.id))
  const byLine = new Map<number, number>()
  for (const a of allocations) {
    if (!late.has(a.chargeId) || a.amountBase === 0) continue
    byLine.set(a.containerLineId, Math.round(((byLine.get(a.containerLineId) ?? 0) + a.amountBase) * 100) / 100)
  }
  return byLine
}
