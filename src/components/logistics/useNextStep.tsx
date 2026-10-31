import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../navigation'
import { routes } from '../../routes'
import { isMovementStep, nextStepOf, type NextStepAction, type NextStepContainer } from './nextStep'
import { NextStepModal } from './NextStepModal'

const CONTAINERS_ROUTE = '/logistics/containers'

/**
 * Where the step was offered: the container's own page (or its row on an order's or an invoice's Containers card), its
 * row on the Containers list, or its card on the Shipments board. The notification's movement links carry it
 * (?from=container/12, ?from=containers, ?from=shipments), so Back on the movement returns there.
 */
export type NextStepOrigin = 'container' | 'containers' | 'shipments'

/** The way back a movement link carries, by where the step was offered. */
function returnQueryOf(origin: NextStepOrigin, containerId: number): string {
  if (origin === 'container') return `?from=container/${containerId}`
  return origin === 'shipments' ? '?from=shipments' : '?from=containers'
}

/** What the hook reads of a container beyond its step: its goods receipt, for "Open goods receipt (draft)". */
export interface NextStepTarget extends NextStepContainer {
  goodsReceiptId?: number | null
  /** False while it cannot be received (Receive goods… disabled). */
  canReceive?: boolean
  /** (script 95) Why, from the server ("… has not been delivered yet: …"). */
  receiveBlockedReason?: string | null
}

/**
 * A CONTAINER'S NEXT STEP AS ONE ACTION (script 81): the button next to Save on its page and the first entry of its
 * row's "…" menu ("Next step: {label}"). Both run it here, so they open the same dialog, `NextStepModal`, already filled
 * in: "Start shipment…", "Start Inland transport…", "Arrived at Dar es Salaam…", "Cleared customs at Kasumbalesa…",
 * "Inland transport to Kasumbalesa…". Delivered and not received, the step is the goods receipt - "Receive goods…" /
 * "Open goods receipt (draft)", with their own rules and permissions.
 *
 * `action(container)` is null when the reader may not take the step (without containers.movements.manage for a
 * movement, purchase.goodsreceipts.create to receive, .view to open the draft): the entry is then hidden. Once the
 * journey is over the action is disabled with the reason.
 */
export function useNextStep(
  onDone: () => void,
  origin: NextStepOrigin,
): {
  action: (container: NextStepTarget) => NextStepAction | null
  run: (container: NextStepTarget) => void
  dialogs: ReactNode
} {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSIONS.movementsManage)
  const canReceive = hasPermission(PERMISSIONS.goodsReceiptsCreate)
  const canViewReceipts = hasPermission(PERMISSIONS.goodsReceiptsView)
  const [open, setOpen] = useState<NextStepTarget | null>(null)

  function action(container: NextStepTarget): NextStepAction | null {
    const step = nextStepOf(container)
    if (!step) return null
    if (step.kind === 'Receive') {
      if (!canReceive) return null
      return container.canReceive === false
        ? { ...step, disabledReason: step.disabledReason ?? container.receiveBlockedReason ?? 'This container cannot be received now.' }
        : step
    }
    if (step.kind === 'OpenReceipt') return canViewReceipts && container.goodsReceiptId ? step : null
    return canManage ? step : null
  }

  function run(container: NextStepTarget) {
    const step = action(container)
    if (!step || step.disabledReason) return
    if (step.kind === 'Receive') void navigate(`${CONTAINERS_ROUTE}/${container.id}?receive=1`)
    else if (step.kind === 'OpenReceipt' && container.goodsReceiptId) void navigate(routes.goodsReceipt(container.goodsReceiptId))
    else if (isMovementStep(step.kind)) setOpen(container)
  }

  const dialogs = open ? (
    <NextStepModal
      containerId={open.id}
      containerRef={open.containerRef}
      returnQuery={returnQueryOf(origin, open.id)}
      onClose={() => setOpen(null)}
      onDone={() => {
        setOpen(null)
        onDone()
      }}
    />
  ) : null

  return { action, run, dialogs }
}
