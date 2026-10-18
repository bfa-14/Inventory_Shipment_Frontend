import type { ShipmentCardDto, ShipmentColumnDto, ShipmentPhase } from '../../../api/logistics/shipments'
import { formatNumber } from '../../format'

/**
 * THE SHIPMENTS BOARD'S ARITHMETIC (script 82): the columns and groups the cards fall into, the words of a card and the
 * selection, apart from the components so the board, its List view and the phone tabs read the same answers. Which
 * column and group a container is in is the server's (`phase`, `groupKey`, `groupLabel`, `groupOrder`): nothing here
 * decides it, it only gathers the cards the server placed.
 */

/** How many cards a column draws at first, and adds at each "Show 50 more". */
export const CARDS_STEP = 50

/** The column a card may be ticked in: the received ones are history, read-only. */
export function isSelectableCard(card: Pick<ShipmentCardDto, 'phase'>): boolean {
  return card.phase !== 'Received'
}

export interface BoardGroup {
  /** The server's group key: "MOV|46", "LEG|4|7", "AT|4", "WH|1". */
  key: string
  /** "MOV-2026-000046 · MSC Aurora V.123 · Chennai → Dar es Salaam · ETA 20/10/2026" - without its count. */
  label: string
  order: number
  cards: ShipmentCardDto[]
}

export interface BoardColumn extends ShipmentColumnDto {
  groups: BoardGroup[]
  /** Every card of the column, in board order (group, ref). */
  cards: ShipmentCardDto[]
  /** The cards that can be ticked (none in Received). */
  selectable: ShipmentCardDto[]
}

/** The columns as the server gave them (left to right), each with its cards gathered into its groups. */
export function boardColumns(columns: ShipmentColumnDto[], cards: ShipmentCardDto[]): BoardColumn[] {
  const byPhase = new Map<ShipmentPhase, ShipmentCardDto[]>()
  for (const card of cards) {
    const list = byPhase.get(card.phase)
    if (list) list.push(card)
    else byPhase.set(card.phase, [card])
  }
  return [...columns]
    .sort((a, b) => a.phaseOrder - b.phaseOrder)
    .map((column) => {
      const own = byPhase.get(column.phase) ?? []
      const groups = new Map<string, BoardGroup>()
      for (const card of own) {
        const group = groups.get(card.groupKey)
        if (group) group.cards.push(card)
        else groups.set(card.groupKey, { key: card.groupKey, label: card.groupLabel, order: card.groupOrder, cards: [card] })
      }
      const ordered = [...groups.values()].sort((a, b) => a.order - b.order)
      return {
        ...column,
        groups: ordered,
        cards: ordered.flatMap((g) => g.cards),
        selectable: own.filter(isSelectableCard),
      }
    })
}

/** "84 pcs TVS-APACHE-160" with one item, "2 items, 120 pcs" with several, "No items loaded" with none. */
export function itemsText(card: Pick<ShipmentCardDto, 'itemCount' | 'itemCode' | 'totalQtyBase'>): string {
  if (card.itemCount === 0) return 'No items loaded'
  if (card.itemCount === 1 && card.itemCode) return `${formatNumber(card.totalQtyBase)} pcs ${card.itemCode}`
  return `${formatNumber(card.itemCount)} items, ${formatNumber(card.totalQtyBase)} pcs`
}

/** "22 containers · 1,848 pcs": a column's header line. */
export function columnFigures(column: Pick<ShipmentColumnDto, 'count' | 'pieces'>): string {
  return `${formatNumber(column.count)} container${column.count === 1 ? '' : 's'} · ${formatNumber(column.pieces)} pcs`
}

/** A card's own order on screen: what "Show 50 more" draws next, skipping the groups the reader folded. */
export interface DrawnGroup {
  group: BoardGroup
  /** The cards drawn of this group (none when folded, or past the column's limit). */
  cards: ShipmentCardDto[]
  /** The cards of this group not drawn because the column reached its limit. */
  hidden: number
}

/**
 * The cards a column draws: its groups in order, each open group's cards until the column's limit is reached. Every
 * group header is drawn whatever the limit - its "Select all" reaches the whole group, so a ship can be ticked before
 * its cards are on screen. Folded groups draw no card and use none of the limit.
 */
export function drawColumn(column: BoardColumn, limit: number, folded: (groupKey: string) => boolean): { groups: DrawnGroup[]; drawn: number; hidden: number } {
  let left = limit
  let drawn = 0
  let hidden = 0
  const groups = column.groups.map((group): DrawnGroup => {
    if (folded(group.key)) return { group, cards: [], hidden: 0 }
    const cards = group.cards.slice(0, Math.max(0, left))
    left -= cards.length
    drawn += cards.length
    hidden += group.cards.length - cards.length
    return { group, cards, hidden: group.cards.length - cards.length }
  })
  return { groups, drawn, hidden }
}

/** The ids of the cards, with every one of `ids` added (on) or taken out (off). */
export function withIds(current: ReadonlySet<number>, ids: number[], on: boolean): Set<number> {
  const next = new Set(current)
  for (const id of ids) {
    if (on) next.add(id)
    else next.delete(id)
  }
  return next
}

/** Every one of the cards is ticked / some are: what a "Select all" box shows. */
export function tickState(cards: ShipmentCardDto[], selected: ReadonlySet<number>): { all: boolean; some: boolean } {
  if (cards.length === 0) return { all: false, some: false }
  let count = 0
  for (const card of cards) if (selected.has(card.id)) count++
  return { all: count === cards.length, some: count > 0 && count < cards.length }
}
