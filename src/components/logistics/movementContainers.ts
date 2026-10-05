import type { BadgeProps } from '@mantine/core'
import {
  movementsApi,
  type MovementContainerCandidateDto,
  type MovementContainerDto,
  type MovementContainerMatchDto,
  type MovementPlaceQuery,
} from '../../api/logistics/movements'

/**
 * The containers of a movement as its page holds them - saved or not - and where each one is for the movement's From.
 *
 * THE PLACE RULES (scripts 46 and 49): a container starts a movement where its previous movement ends; one that never
 * moved starts from its port of loading (or goes on a "Loading at the supplier" movement ending there), and one without
 * a port of loading goes from anywhere. The server judges it for the From, To and type on the page, saved or not, in
 * the candidates and in match-containers, with the same sentences Save and Start refuse with.
 */
export interface CardContainer {
  containerId: number
  containerRef: string
  containerNo: string | null
  containerTypeCode: string
  status: number
  statusName: string
  orderNumbers: string | null
  supplierNames: string | null
  itemSummary: string | null
  pieces: number
  /** Where the container is now (saved ones): what a completed or cancelled movement shows as its place. */
  currentLocation?: string | null
  /** Null until the server has judged it for a From. */
  place: ContainerPlace | null
}

export interface ContainerPlace {
  /** What it was judged for (placeKey: From, To and type): a judgement for another one is stale. */
  key: string
  placeName: string | null
  previousMovementNo: string | null
  portOfLoadingName: string | null
  /** Why Save would refuse it, in the server's words; null = it can travel from there. */
  reason: string | null
  note: string | null
  /** The server did not find it any more (deleted meanwhile): no place to show, Save names the problem. */
  unknown?: boolean
}

/** The From, To and type a judgement is for: the place rules depend on all three (script 49). */
export function placeKey(query: MovementPlaceQuery): string {
  return `${query.fromPlaceId}|${query.toPlaceId ?? ''}|${query.movementTypeId ?? ''}`
}

/** A badge in a table cell keeps its whole label: the cell grows instead of the text being cut to "Confi…". */
export const WHOLE_BADGE: BadgeProps['styles'] = { label: { overflow: 'visible' } }

/** "Beira - end of MOV-2026-000012", or "Not moved yet - port of loading Shanghai". */
export function placeText(place: {
  placeName: string | null
  previousMovementNo: string | null
  portOfLoadingName: string | null
}): string {
  if (place.previousMovementNo) return `${place.placeName ?? '—'} - end of ${place.previousMovementNo}`
  // Never moved: the place is its port of loading (script 49 answers it as the place too).
  const port = place.portOfLoadingName ?? place.placeName
  return port ? `Not moved yet - port of loading ${port}` : 'Not moved yet - no port of loading'
}

export function fromSaved(c: MovementContainerDto): CardContainer {
  return {
    containerId: c.containerId,
    containerRef: c.containerRef,
    containerNo: c.containerNo,
    containerTypeCode: c.containerTypeCode,
    status: c.containerStatus,
    statusName: c.containerStatusName,
    orderNumbers: null,
    supplierNames: c.supplierName,
    itemSummary: c.itemSummary,
    pieces: c.totalAllocatedBase,
    currentLocation: c.currentLocation,
    place: null,
  }
}

export function fromCandidate(c: MovementContainerCandidateDto, key: string): CardContainer {
  return {
    containerId: c.id,
    containerRef: c.containerRef,
    containerNo: c.containerNo,
    containerTypeCode: c.containerTypeCode,
    status: c.status,
    statusName: c.statusName,
    orderNumbers: c.orderNumbers,
    supplierNames: c.supplierNames,
    itemSummary: c.itemSummary,
    pieces: c.pieces,
    place: {
      key,
      placeName: c.placeName,
      previousMovementNo: c.previousMovementNo,
      portOfLoadingName: c.portOfLoadingName,
      reason: c.reason,
      note: c.note,
    },
  }
}

/** A matched number that names one container (containerId set). */
export function fromMatch(m: MovementContainerMatchDto & { containerId: number }, key: string): CardContainer {
  return {
    containerId: m.containerId,
    containerRef: m.containerRef ?? '',
    containerNo: m.containerNo,
    containerTypeCode: m.containerTypeCode ?? '',
    status: m.status ?? 0,
    statusName: m.statusName ?? '',
    orderNumbers: m.orderNumbers,
    supplierNames: m.supplierNames,
    itemSummary: m.itemSummary,
    pieces: m.pieces ?? 0,
    place: {
      key,
      placeName: m.placeName,
      previousMovementNo: m.previousMovementNo,
      portOfLoadingName: m.portOfLoadingName,
      // A Duplicate row carries the container but its reason is about the list, not the container.
      reason: m.result === 'Ready' || m.result === 'AlreadyOnMovement' || m.result === 'Blocked' ? m.reason : null,
      note: m.note,
    },
  }
}

/** The API takes at most 500 numbers a call. */
const MATCH_CHUNK = 500

/** match-containers over any number of numbers, a call per 500; rowNo stays the position in `numbers`, from 1. */
export async function matchAll(query: MovementPlaceQuery, numbers: string[], signal?: AbortSignal): Promise<MovementContainerMatchDto[]> {
  const rows: MovementContainerMatchDto[] = []
  for (let start = 0; start < numbers.length; start += MATCH_CHUNK) {
    const part = await movementsApi.matchContainers(query, numbers.slice(start, start + MATCH_CHUNK), signal)
    rows.push(...part.map((r) => ({ ...r, rowNo: r.rowNo + start })))
  }
  return rows
}
