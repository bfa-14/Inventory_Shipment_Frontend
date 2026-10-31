import type { ContainerShipState } from '../../api/logistics/containers'
import { SINGLE_PLACE_STAGES, type MovementStage } from '../../api/masterdata/movementTypes'
import { portLabel, type PortLookupDto } from '../../api/masterdata/ports'

/**
 * Where a container is and how its legs are placed (script 80): the stays, the grouped place pickers, the locked From.
 * The words of its next step are in `nextStep.ts` (script 81).
 */

/** What the label and the dialogs read of a container: a list row and the container page both carry it. */
export interface ShipStepContainer extends ContainerShipState {
  id: number
  containerRef: string
  status: number
}

/** A stay happens at one place - a port call, customs clearance, a border crossing: its To is its From. */
export function isStay(stage: string | null | undefined): boolean {
  return stage != null && SINGLE_PLACE_STAGES.includes(stage as MovementStage)
}

/** The order the place pickers group by: sea ports, then border posts, then inland places (then anything else). */
const KIND_ORDER = ['Sea', 'Border', 'Inland', 'Air']
const KIND_LABELS: Record<string, string> = { Sea: 'Sea ports', Border: 'Border posts', Inland: 'Inland places', Air: 'Airports' }

type Option = { value: string; label: string }

/**
 * The places of a picker grouped Sea / Border / Inland, so a border post is never taken for the sea port of the same
 * town. Inactive places are left out, except the ones already chosen (`keep`).
 */
export function placeOptionGroups(ports: PortLookupDto[], keep: (string | null | undefined)[] = []): { group: string; items: Option[] }[] {
  const kinds = new Map<string, Option[]>()
  for (const p of ports) {
    if (!p.isActive && !keep.includes(String(p.id))) continue
    const list = kinds.get(p.kind) ?? []
    list.push({ value: String(p.id), label: `${p.portCode} - ${portLabel(p)}` })
    kinds.set(p.kind, list)
  }
  const rank = (kind: string) => {
    const index = KIND_ORDER.indexOf(kind)
    return index === -1 ? KIND_ORDER.length : index
  }
  return [...kinds]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([kind, items]) => ({ group: KIND_LABELS[kind] ?? kind, items }))
}

/** "From" is locked to where the container is: the hint under it. */
export const FROM_LOCKED_HINT = 'A container leaves from where it is.'
