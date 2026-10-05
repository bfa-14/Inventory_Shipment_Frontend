/**
 * How full a container is, the way the database judges it (logistics.fn_ContainerFill, script 50).
 *
 * FILL IS A SUM OF FRACTIONS, NOT PIECES ÷ ONE CAPACITY: 42 pieces of an 84-piece item and 60 of a
 * 120-piece item fill a container exactly (0.5 + 0.5), although 102 pieces is neither capacity.
 * The pieces per container of an item are its Container unit (Item Definition) - there is no typed
 * or container type capacity any more; an item without one makes the fill unknown.
 * The sum is compared with the SQL's tolerance, so a mix that is exactly full never reads as
 * 100.00000001 % and never raises the capacity warning the server would not raise either.
 */
export const FULL_TOLERANCE = 1.000001

/** Above the tolerance: the server would answer OVER_CAPACITY. */
export function isOverFull(fill: number): boolean {
  return fill > FULL_TOLERANCE
}

/** Green from 90 to 100 %, red above 100 %, grey below 90 %. */
export function fillColour(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'gray'
  if (pct > FULL_TOLERANCE * 100) return 'red'
  return pct >= 90 ? 'green' : 'gray'
}

/** "100.0 %", one decimal - the proposal's own rounding. */
export function fillLabel(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return '—'
  // Inside the tolerance a full container says 100.0, not 100.0000001 rounded up to 100.1.
  const shown = pct > 100 && pct <= FULL_TOLERANCE * 100 ? 100 : pct
  return `${shown.toFixed(1)} %`
}

/** What a container holds of one item, with the item's pieces per container (null = no Container unit). */
export interface FillPart {
  itemId: number
  itemCode: string
  quantity: number
  pcsPerContainer: number | null
}

export interface Fill {
  /** Per item, merged, in the order met; only items with a quantity. */
  parts: FillPart[]
  /** The items without a Container unit: the fill is unknown while there is one. */
  missing: FillPart[]
  fraction: number
  /** 0-100+; null when unknown. */
  pct: number | null
  over: boolean
  /** Pieces still fitting, for a container of ONE item (negative above capacity). */
  remaining: number | null
}

/** The fill of what a form holds, line by line (the same rule as the server's). */
export function fillOf(lines: FillPart[]): Fill {
  const byItem = new Map<number, FillPart>()
  for (const line of lines) {
    if (!(line.quantity > 0)) continue
    const part = byItem.get(line.itemId)
    if (part) part.quantity += line.quantity
    else byItem.set(line.itemId, { ...line })
  }
  const parts = [...byItem.values()]
  const missing = parts.filter((p) => !p.pcsPerContainer)
  const fraction = parts.reduce((sum, p) => sum + (p.pcsPerContainer ? p.quantity / p.pcsPerContainer : 0), 0)
  const known = missing.length === 0
  return {
    parts,
    missing,
    fraction,
    pct: known ? fraction * 100 : null,
    over: known && isOverFull(fraction),
    remaining: known && parts.length === 1 && parts[0].pcsPerContainer ? parts[0].pcsPerContainer - parts[0].quantity : null,
  }
}

/** "84 pcs of TEST38-A, 84 per container; 60 pcs of TEST46-B, 120 per container". */
export function fillParts(fill: Fill): string {
  return fill.parts
    .map((p) => `${p.quantity.toLocaleString('en-US')} pcs of ${p.itemCode}, ${p.pcsPerContainer?.toLocaleString('en-US') ?? '?'} per container`)
    .join('; ')
}

/** The server's 69007 sentence, for the confirmation asked before the save goes. */
export function overCapacityMessage(fill: Fill): string {
  const items = fill.parts
    .map((p) => `${p.quantity.toLocaleString('en-US')} pcs of ${p.itemCode} (${p.pcsPerContainer?.toLocaleString('en-US') ?? '?'} per container)`)
    .join(', ')
  return `This container would be ${Math.round(fill.pct ?? 0)} % full: ${items}. Confirm to load it above its capacity.`
}
