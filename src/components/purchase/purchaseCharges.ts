import type {
  ManualAllocationRequest,
  PurchaseChargeDto,
  PurchaseChargeRequest,
} from '../../api/purchase/landedCostAdjustments'
import type { ChargeAllocationMethod, ChargeTypeLookupDto } from '../../api/purchase/chargeTypes'

/**
 * One charge while it is on the page.
 *
 * NULLABLE WHERE A ROW CAN BE HALF-TYPED: a type chosen but no amount yet, a currency whose rate is
 * still being looked up. `allocations` holds the manual split as a map from invoice line id to
 * amount, which is the shape the grid edits; it is flattened into the request on save.
 */
export interface ChargeLine {
  key: string
  /** The saved id, or null on a row that has never been saved. */
  id: number | null
  chargeTypeId: number | null
  chargeCode: string
  chargeName: string
  description: string
  providerPartyId: string | null
  reference: string
  /** The charge's own currency. Null means "the document's", which the server resolves. */
  currencyId: string | null
  rateType: number
  /** 1 base unit = rate charge-currency units. Null while unknown; the server then uses the date's rate. */
  exchangeRate: number | null
  amount: number | null
  allocationMethod: ChargeAllocationMethod
  /** Copied from the type when it was picked; a charge that is not in the landed cost costs the goods nothing. */
  includeInLandedCost: boolean
  includedInSupplierInvoice: boolean
  notes: string
  /** Manual method only: invoice line id -> amount in the base currency. */
  allocations: Record<number, number>
  /** What the server allocated, once the document is posted. */
  allocatedBase: number | null
  /** A message about the row: the server's "Charge N: …". */
  error?: string
}

let keySeed = 0
const nextKey = () => `chg-${++keySeed}`

export function emptyCharge(defaultCurrencyId: number | null): ChargeLine {
  return {
    key: nextKey(),
    id: null,
    chargeTypeId: null,
    chargeCode: '',
    chargeName: '',
    description: '',
    providerPartyId: null,
    reference: '',
    currencyId: defaultCurrencyId === null ? null : String(defaultCurrencyId),
    rateType: 1,
    exchangeRate: null,
    amount: null,
    allocationMethod: 'Value',
    includeInLandedCost: true,
    includedInSupplierInvoice: false,
    notes: '',
    allocations: {},
    allocatedBase: null,
  }
}

/** A saved charge, with its manual split read back from the allocations the server stored. */
export function chargeFromDto(dto: PurchaseChargeDto, allocations: Record<number, number> = {}): ChargeLine {
  return {
    key: nextKey(),
    id: dto.id,
    chargeTypeId: dto.chargeTypeId,
    chargeCode: dto.chargeCode,
    chargeName: dto.chargeName,
    description: dto.description ?? '',
    providerPartyId: dto.providerPartyId === null ? null : String(dto.providerPartyId),
    reference: dto.reference ?? '',
    currencyId: String(dto.currencyId),
    rateType: dto.rateType,
    exchangeRate: dto.exchangeRate,
    amount: dto.amount,
    allocationMethod: dto.allocationMethod,
    includeInLandedCost: dto.includeInLandedCost,
    includedInSupplierInvoice: dto.includedInSupplierInvoice,
    notes: dto.notes ?? '',
    allocations,
    allocatedBase: dto.allocatedBase,
  }
}

/** Picking a type fills the method and the cost flag in; what the reader typed is left alone. */
export function withChargeType(line: ChargeLine, type: ChargeTypeLookupDto): ChargeLine {
  return {
    ...line,
    chargeTypeId: type.id,
    chargeCode: type.chargeCode,
    chargeName: type.chargeName,
    allocationMethod: type.allocationMethod,
    includeInLandedCost: type.includeInLandedCost,
    // A method the reader has not chosen follows the type; a manual split made for another method
    // would point at the wrong thing, so it goes.
    allocations: type.allocationMethod === 'Manual' ? line.allocations : {},
    error: undefined,
  }
}

/**
 * The charge in the base currency: amount ÷ rate.
 *
 * DIVIDED, NOT MULTIPLIED. A rate here reads "1 USD = 2,800 CDF", so a charge of 2,800 CDF is 1 USD.
 * Null while there is no rate to divide by — the page shows a dash rather than a wrong number.
 */
export function amountBase(line: ChargeLine): number | null {
  if (line.amount === null) return null
  if (line.exchangeRate === null || line.exchangeRate <= 0) return null
  return Math.round((line.amount / line.exchangeRate + Number.EPSILON) * 100) / 100
}

/** What a manual charge still has to place, in the base currency. Zero means the split is complete. */
export function remainingToAllocate(line: ChargeLine): number {
  const total = amountBase(line) ?? 0
  const placed = Object.values(line.allocations).reduce((sum, value) => sum + (value || 0), 0)
  return Math.round((total - placed + Number.EPSILON) * 100) / 100
}

/** True when a manual charge that reaches the goods has not been fully placed yet. */
export function isUnallocated(line: ChargeLine): boolean {
  if (line.allocationMethod !== 'Manual' || !line.includeInLandedCost) return false
  if ((amountBase(line) ?? 0) <= 0) return false
  return Math.abs(remainingToAllocate(line)) > 0.01
}

/** The charges that reach the item cost, and everything else — the footer says both. */
export function chargeTotals(lines: ChargeLine[]): { total: number; landed: number } {
  let total = 0
  let landed = 0
  for (const line of lines) {
    const value = amountBase(line) ?? 0
    total += value
    if (line.includeInLandedCost) landed += value
  }

  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
  return { total: round(total), landed: round(landed) }
}

/** The charges as the API takes them. Line numbers come from the position, so they match "Charge N:". */
export function toChargeRequests(lines: ChargeLine[]): PurchaseChargeRequest[] {
  return lines.map((line, index) => ({
    lineNumber: index + 1,
    chargeTypeId: line.chargeTypeId!,
    description: line.description.trim() || null,
    providerPartyId: line.providerPartyId === null ? null : Number(line.providerPartyId),
    reference: line.reference.trim() || null,
    currencyId: line.currencyId === null ? null : Number(line.currencyId),
    rateType: line.rateType,
    exchangeRate: line.exchangeRate,
    amount: line.amount ?? 0,
    allocationMethod: line.allocationMethod,
    includedInSupplierInvoice: line.includedInSupplierInvoice,
    notes: line.notes.trim() || null,
  }))
}

/** The manual splits, flattened. Only charges that are manual AND reach the cost have any. */
export function toManualAllocations(lines: ChargeLine[]): ManualAllocationRequest[] {
  const out: ManualAllocationRequest[] = []
  lines.forEach((line, index) => {
    if (line.allocationMethod !== 'Manual' || !line.includeInLandedCost) return
    for (const [lineId, amount] of Object.entries(line.allocations)) {
      if (!amount) continue
      out.push({ chargeLineNumber: index + 1, purchaseLineId: Number(lineId), amountBase: amount })
    }
  })
  return out
}

/** The invoice line a manual split is spread over, as the allocation grid needs to draw it. */
export interface AllocationTarget {
  id: number
  lineNo: number
  itemCode: string
  itemName: string
  quantityBase: number
}
