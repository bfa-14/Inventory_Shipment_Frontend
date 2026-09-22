import type { ShortageDocumentLineDto, ShortageLiveRowDto } from '../../api/inventory/shortages'

/**
 * One line of a shortage plan while it is on the page.
 *
 * THREE INPUTS FROM THE SERVER, THREE FROM THE PLANNER, EVERYTHING ELSE DERIVED. Current inventory,
 * transit, outstanding order and the computed monthly sales are the server's figures and are never
 * edited here; the planner types a manual monthly sales figure, a required quantity and a PC per
 * container. {@link derive} turns the six (and the header's lead time) into every other cell, with
 * the same formulas the database uses — so the grid answers as it is typed, and the API's values
 * replace the page's on the next save.
 */
export interface ShortageLine {
  /** Stable for the life of the row on the page; the grid keys on it, so an input keeps its focus while the row re-sorts. */
  key: string
  id: number | null
  itemId: number
  itemCode: string
  itemName: string
  currentInventoryBase: number
  transitBase: number
  outstandingOrderBase: number
  /** Computed from the sales history; shown greyed when there is no override. */
  expectedMonthlySalesBase: number
  /** The planner's override, or null when the computed value stands. */
  expectedMonthlySalesManual: number | null
  purchaseUnitName: string
  purchasePackingFormula: number
  /** Purchase units. Follows the suggestion until the planner types one ({@link requiredManual}). */
  requiredQty: number
  /** True once the planner typed a quantity: it no longer follows the suggestion. */
  requiredManual: boolean
  /** The planner's override, or null when the item's Container unit ({@link defaultPcPerContainer}) stands. */
  pcPerContainer: number | null
  /** The Packing Formula of the item's "Container" unit; null when the item has none. */
  defaultPcPerContainer: number | null
  minQuantity: number | null
  maxQuantity: number | null
  lastCost: number | null
  notes: string
  /** A message about the row: the server's "Line N: …". */
  error?: string
}

/** Every cell that is computed rather than stored. */
export interface ShortageDerived {
  stockPlusTransitBase: number
  totalExpectedStockBase: number
  effectiveMonthlySales: number
  expectedRequirementBase: number
  shortageBase: number
  /** Null when nothing sells: months of coverage have no meaning then. */
  coverageMonths: number | null
  /** The shortage rounded up to whole purchase units. */
  suggestedRequiredQty: number
  requiredBase: number
  /** The override, else the item's Container unit; null without either. */
  effectivePcPerContainer: number | null
  /** Null without a PC per container. */
  containerRequirement: number | null
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

/**
 * The rule, per line, in base units:
 *
 *   Stock + Transit       = Current Inventory + Transit
 *   Total Expected Stock  = Current Inventory + Transit + Outstanding Order
 *   Expected Requirement  = Expected Monthly Sales × Lead Time (Month)
 *   Shortage              = max(0, Requirement − Total Expected Stock), rounded UP to a whole unit
 *   Coverage (months)     = Total Expected Stock ÷ Expected Monthly Sales
 *   Container Requirement = Required Qty × packing ÷ PC per Container
 */
export function derive(
  line: Pick<ShortageLine, 'currentInventoryBase' | 'transitBase' | 'outstandingOrderBase' | 'expectedMonthlySalesBase' | 'expectedMonthlySalesManual' | 'purchasePackingFormula' | 'requiredQty' | 'pcPerContainer' | 'defaultPcPerContainer'>,
  leadTimeMonths: number,
): ShortageDerived {
  const stockPlusTransitBase = line.currentInventoryBase + line.transitBase
  const totalExpectedStockBase = stockPlusTransitBase + line.outstandingOrderBase
  const effectiveMonthlySales = line.expectedMonthlySalesManual ?? line.expectedMonthlySalesBase
  const requirement = effectiveMonthlySales * (leadTimeMonths > 0 ? leadTimeMonths : 0)
  const gap = requirement - totalExpectedStockBase
  // The tiny subtraction keeps 12.000000001 (a float artefact of 2.4 × 5) from becoming 13.
  const shortageBase = gap > 0 ? Math.ceil(gap - 1e-9) : 0
  const packing = line.purchasePackingFormula > 0 ? line.purchasePackingFormula : 1
  const requiredBase = line.requiredQty * packing
  const pcPerContainer = line.pcPerContainer ?? line.defaultPcPerContainer

  return {
    stockPlusTransitBase,
    totalExpectedStockBase,
    effectiveMonthlySales,
    expectedRequirementBase: round2(requirement),
    shortageBase,
    coverageMonths: effectiveMonthlySales > 0 ? round2(totalExpectedStockBase / effectiveMonthlySales) : null,
    suggestedRequiredQty: shortageBase > 0 ? Math.ceil(shortageBase / packing) : 0,
    requiredBase,
    effectivePcPerContainer: pcPerContainer,
    containerRequirement: pcPerContainer !== null && pcPerContainer > 0 ? round2(requiredBase / pcPerContainer) : null,
  }
}

export interface ShortageTotals {
  items: number
  totalShortageBase: number
  totalRequiredBase: number
  /** The sum of the container requirements, e.g. 7.35. */
  containers: number
  /** That sum rounded up: 8 containers are booked for 7.35. */
  containersRounded: number
  /** 7.35 ÷ 8 = 91.88. Null when no line has a container requirement. */
  utilizationPct: number | null
}

export function totalsOf(lines: ShortageLine[], leadTimeMonths: number): ShortageTotals {
  let totalShortageBase = 0
  let totalRequiredBase = 0
  let containers = 0
  for (const line of lines) {
    const d = derive(line, leadTimeMonths)
    totalShortageBase += d.shortageBase
    totalRequiredBase += d.requiredBase
    containers += d.containerRequirement ?? 0
  }
  containers = round2(containers)
  // Nothing to ship is 0 containers, not the -0 that Math.ceil makes of a tiny negative.
  const containersRounded = containers > 0 ? Math.ceil(containers - 1e-9) : 0
  return {
    items: lines.length,
    totalShortageBase,
    totalRequiredBase,
    containers,
    containersRounded,
    utilizationPct: containers > 0 ? round2((100 * containers) / containersRounded) : null,
  }
}

let keySeed = 0
const nextKey = () => `shr-${++keySeed}`

/**
 * A saved line. Its quantity counts as typed when it is not what the snapshot would suggest, and its
 * PC per container when it is not the item's Container unit (the database keeps only the value used).
 * A POSTED plan is a snapshot: the value it used stays its value, whatever the item's unit says today.
 */
export function lineFromDto(dto: ShortageDocumentLineDto, draft: boolean): ShortageLine {
  const defaultPcPerContainer = draft ? dto.defaultPcPerContainer : dto.pcPerContainer
  const line: ShortageLine = {
    key: nextKey(),
    id: dto.id,
    itemId: dto.itemId,
    itemCode: dto.itemCode,
    itemName: dto.itemName,
    currentInventoryBase: dto.currentInventoryBase,
    transitBase: dto.transitBase,
    outstandingOrderBase: dto.outstandingOrderBase,
    expectedMonthlySalesBase: dto.expectedMonthlySalesBase,
    expectedMonthlySalesManual: dto.expectedMonthlySalesManual,
    purchaseUnitName: dto.purchaseUnitName,
    purchasePackingFormula: dto.purchasePackingFormula,
    requiredQty: dto.requiredQty,
    requiredManual: false,
    pcPerContainer: dto.pcPerContainer === defaultPcPerContainer ? null : dto.pcPerContainer,
    defaultPcPerContainer,
    minQuantity: dto.minQuantity,
    maxQuantity: dto.maxQuantity,
    lastCost: dto.lastCost,
    notes: dto.notes ?? '',
  }
  line.requiredManual = dto.requiredQty !== derive(line, dto.leadTimeMonths).suggestedRequiredQty
  return line
}

/** A live row picked in "Load items": the suggestion as its quantity, the item's Container unit as its PC per container. */
export function lineFromLiveRow(row: ShortageLiveRowDto): ShortageLine {
  return {
    key: nextKey(),
    id: null,
    itemId: row.itemId,
    itemCode: row.itemCode,
    itemName: row.itemName,
    currentInventoryBase: row.currentInventoryBase,
    transitBase: row.transitBase,
    outstandingOrderBase: row.outstandingOrderBase,
    expectedMonthlySalesBase: row.expectedMonthlySalesBase,
    expectedMonthlySalesManual: null,
    purchaseUnitName: row.purchaseUnitName,
    purchasePackingFormula: row.purchasePackingFormula,
    requiredQty: row.suggestedRequiredQty,
    requiredManual: false,
    pcPerContainer: null,
    defaultPcPerContainer: row.pcPerContainer,
    minQuantity: row.minQuantity,
    maxQuantity: row.maxQuantity,
    lastCost: row.lastCost,
    notes: '',
  }
}

/** Draft grey, Posted green. */
export const SHORTAGE_STATUS_COLOURS: Record<string, string> = { Draft: 'gray', Posted: 'green' }

export const SHORTAGES_ROUTE = '/inventory/shortages'
