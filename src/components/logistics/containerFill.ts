/**
 * How full a container is, the way the database judges it.
 *
 * FILL IS A SUM OF FRACTIONS, NOT PIECES ÷ ONE CAPACITY: 42 pieces of an 84-piece item and 60 of a
 * 120-piece item fill a container exactly (0.5 + 0.5), although 102 pieces is neither capacity.
 * The sum is compared with the SQL's tolerance, so a mix that is exactly full never reads as
 * 100.00000001 % and never raises the capacity warning the server would not raise either.
 */
export const FULL_TOLERANCE = 1.000001

/** Above the tolerance: the server would answer OVER_CAPACITY. */
export function isOverFull(fill: number): boolean {
  return fill > FULL_TOLERANCE
}

/** Green from 90 to 100 %, orange above 100 %, grey below 90 %. */
export function fillColour(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'gray'
  if (pct > FULL_TOLERANCE * 100) return 'orange'
  return pct >= 90 ? 'green' : 'gray'
}

/** "100.0 %", one decimal - the proposal's own rounding. */
export function fillLabel(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return '—'
  // Inside the tolerance a full container says 100.0, not 100.0000001 rounded up to 100.1.
  const shown = pct > 100 && pct <= FULL_TOLERANCE * 100 ? 100 : pct
  return `${shown.toFixed(1)} %`
}
