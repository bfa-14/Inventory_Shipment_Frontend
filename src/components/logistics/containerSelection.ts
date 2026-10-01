/**
 * Ticking containers on a grid: what the selection bar reads of a row, its quick selectors and the
 * refresh of a selection after a reload. Kept apart from the bar so the component file only exports
 * components.
 */

/** What the bar reads of a container: a container list row carries all of it. */
export interface SelectableContainer {
  id: number
  containerRef: string
  containerNo: string | null
  status: number
  /** 1 planned, 2 in progress, 3 completed; null without a movement. */
  currentMovementStatus: number | null
  currentMovementNo: string | null
  /** What "Start shipment" shows as its default route. */
  portOfLoadingName: string | null
  portOfDestinationName: string | null
}

export const DRAFT = 1
const CONFIRMED = 2
const MOVEMENT_IN_PROGRESS = 2

/** Draft or confirmed and not travelling: what a shipment can still take. */
export function isNotShipped(container: SelectableContainer): boolean {
  return (container.status === DRAFT || container.status === CONFIRMED) && container.currentMovementStatus !== MOVEMENT_IN_PROGRESS
}

/**
 * The selection after a reload: each ticked container replaced by its fresh row when the reload
 * brought it back, so the bar judges today's statuses (a confirmed container is no longer a draft);
 * containers ticked on another page keep the row they were ticked with.
 */
export function refreshSelection<T extends { id: number }>(selected: T[], rows: T[]): T[] {
  if (selected.length === 0) return selected
  const fresh = new Map(rows.map((row) => [row.id, row]))
  return selected.map((row) => fresh.get(row.id) ?? row)
}
