import type { ContainerJourneyStatus, ContainerListDto } from '../../api/logistics/containers'
import { dateLabel } from '../documents/documentKind'

/**
 * WHERE A CONTAINER IS ON ITS JOURNEY (script 95, logistics.fn_Container_Journey): the latest leg that started, worked
 * out on the server so the Journey filter holds across every container.
 */
export const JOURNEY_FILTERS: { value: ContainerJourneyStatus; label: string }[] = [
  { value: 'NotDispatched', label: 'Not dispatched' },
  { value: 'OnTheWay', label: 'On the way' },
  { value: 'Arrived', label: 'Arrived' },
  { value: 'Received', label: 'Received' },
]

export const JOURNEY_COLOURS: Record<ContainerJourneyStatus, string> = {
  NotDispatched: 'gray',
  OnTheWay: 'indigo',
  Arrived: 'teal',
  Received: 'green',
}

type JourneyRow = Pick<ContainerListDto, 'journeyStatus' | 'journeyFromName' | 'journeyToName' | 'journeySince'>

/** "Dar es Salaam → Kasumbalesa", or "" (a stay at one place reads its place once). */
export function journeyLegText(row: JourneyRow): string {
  const from = row.journeyFromName ?? null
  const to = row.journeyToName ?? null
  if (!from && !to) return ''
  if (from && to && from === to) return from
  return `${from ?? '…'} → ${to ?? '…'}`
}

/** "On the way", "Arrived at Kasumbalesa", "Received into Lubumbashi Warehouse", "Not dispatched", or "". */
export function journeyStatusText(row: JourneyRow): string {
  switch (row.journeyStatus) {
    case 'NotDispatched':
      return 'Not dispatched'
    case 'OnTheWay':
      return 'On the way'
    case 'Arrived':
      return row.journeyToName ? `Arrived at ${row.journeyToName}` : 'Arrived'
    case 'Received':
      return row.journeyToName ? `Received into ${row.journeyToName}` : 'Received'
    default:
      return ''
  }
}

/** "since 12/10/2026", or null. */
export function journeySinceText(row: JourneyRow): string | null {
  return row.journeySince ? `since ${dateLabel(row.journeySince)}` : null
}
