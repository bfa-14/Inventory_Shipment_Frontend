import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../navigation'
import type { SelectableContainer } from './containerSelection'
import { MovementStatusModal } from './MovementStatusModal'
import { shipActionOf, type ShipAction } from './shipStep'
import { StartShipmentModal } from './StartShipmentModal'

const MOVEMENTS_ROUTE = '/logistics/movements'

type Open =
  | { kind: 'ship'; container: SelectableContainer }
  | { kind: 'start' | 'complete'; container: SelectableContainer; movementId: number }

/**
 * A container's next step, as one action (script 80): the button next to Save on its page and the first entry of its
 * row's "…" menu on the Containers list. Both run it here, so they open the same dialogs:
 *
 * - "Start shipment…" (never moved): the Start shipment dialog for this one container, From locked to its port of loading;
 * - "Start Inland transport…" (its next planned movement): the Start dialog of that movement;
 * - "Arrived at Dar es Salaam…" / "Complete Customs clearance…" (a movement in progress carries it): the Complete
 *   dialog, which says when the movement carries other containers too;
 * - "Next leg…" (its last movement is completed): the movement form, From = where it is (locked), the container ticked,
 *   and Back returning to the container.
 *
 * `action(container)` is null without containers.movements.manage (the entry is then hidden): a reader who may not move
 * containers is not shown a door. A disabled action carries its reason.
 */
export function useShipStep(onDone: () => void): {
  action: (container: SelectableContainer) => ShipAction | null
  run: (container: SelectableContainer) => void
  dialogs: ReactNode
} {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSIONS.movementsManage)
  const canConfirm = hasPermission(PERMISSIONS.containersConfirm)
  const [open, setOpen] = useState<Open | null>(null)

  function action(container: SelectableContainer): ShipAction | null {
    return canManage ? shipActionOf(container, { canConfirm }) : null
  }

  function run(container: SelectableContainer) {
    const next = action(container)
    if (!next || next.disabledReason) return
    switch (next.step) {
      case 'Ship':
        setOpen({ kind: 'ship', container })
        break
      case 'Start':
      case 'Complete':
        if (next.movementId !== null) setOpen({ kind: next.step === 'Start' ? 'start' : 'complete', container, movementId: next.movementId })
        break
      case 'NextLeg':
        void navigate(`${MOVEMENTS_ROUTE}/new?containerId=${container.id}&from=container/${container.id}`)
        break
      default:
        break
    }
  }

  const finished = () => {
    setOpen(null)
    onDone()
  }

  const dialogs =
    open?.kind === 'ship' ? (
      <StartShipmentModal containers={[open.container]} onClose={() => setOpen(null)} onShipped={finished} />
    ) : open ? (
      <MovementStatusModal
        kind={open.kind}
        movementId={open.movementId}
        container={{ id: open.container.id, containerRef: open.container.containerRef }}
        onClose={() => setOpen(null)}
        onDone={finished}
      />
    ) : null

  return { action, run, dialogs }
}
