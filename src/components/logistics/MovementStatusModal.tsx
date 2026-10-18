import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Alert, Button, Group, Loader, Modal, Stack, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconCheck, IconPlayerPlay } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { movementsApi, type MovementDto } from '../../api/logistics/movements'
import { useAuth } from '../../auth/useAuth'
import { refreshGoodsReceiptsWaiting } from '../../hooks/useGoodsReceiptsWaiting'
import { PERMISSIONS } from '../../navigation'
import { dateLabel } from '../documents/documentKind'
import { formatNumber, todayDateOnly } from '../format'
import { notify } from '../ui/notify'
import { DeliveryCompletePreview } from './DeliveryReceipts'
import { showDeliveryResult } from './deliveryNotification'
import { completeWords } from './nextStep'
import { isStay } from './shipStep'

/** The stage whose completion brings the containers to the warehouse: a draft goods receipt for each (rule 5). */
const DELIVERY = 'Delivery'

/** How many other containers the "they arrive too" line names before "and N more". */
const NAMED = 5

export type MovementStatusKind = 'start' | 'complete'

interface MovementStatusModalProps {
  kind: MovementStatusKind
  movementId: number
  /** The movement as the page already has it (the movement page); else it is read when the dialog opens. */
  movement?: MovementDto | null
  /** The container it was opened from (its page, its row): the title names it, the others are named "too". */
  container?: { id: number; containerRef: string } | null
  onClose(): void
  /** After the start or the completion: the host shows the movement as it is now, or reloads its rows. */
  onDone(result: MovementDto): void
}

/** "KTG-2026-0032, KTG-2026-0033 and 9 more". */
function someRefs(refs: string[]): string {
  const shown = refs.slice(0, NAMED).join(', ')
  return refs.length > NAMED ? `${shown} and ${formatNumber(refs.length - NAMED)} more` : shown
}

/**
 * Starting or completing a movement, from wherever it is offered (script 80): the movement page, a row of the Movements
 * list, the container's page and its row on the Containers list. One dialog, so the rules are the same everywhere:
 *
 * - THE DATE IS A FACT: today by default, never in the future (the owner's decision; the server refuses it too), a start
 *   not before the previous leg of one of its containers ended (70018), an end not before the start.
 * - A PLANNED MOVEMENT THAT CANNOT START says why before the click (`startBlockedReason`, the refusal Start would give).
 * - OPENED FROM A CONTAINER, the dialog says plainly when the movement carries other containers: "All 12 containers of
 *   MOV-2026-000046 arrive too" - completing it from one container's page moves every container on it.
 * - A Delivery shows what happens to each container's goods (the draft goods receipts), and the notifications after it
 *   say what did - every completion goes through the API's Complete, which drafts them after the commit.
 */
export function MovementStatusModal({ kind, movementId, movement: given, container, onClose, onDone }: MovementStatusModalProps) {
  const navigate = useNavigate()
  const canViewReceipts = useAuth().hasPermission(PERMISSIONS.goodsReceiptsView)
  const [loaded, setLoaded] = useState<MovementDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [date, setDate] = useState<string | null>(todayDateOnly())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Read when it opens, unless the page already has it: the row a list holds has no containers nor row version.
  useEffect(() => {
    if (given) return
    const controller = new AbortController()
    movementsApi
      .get(movementId, controller.signal)
      .then((dto) => {
        if (!controller.signal.aborted) setLoaded(dto)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(err instanceof ApiError ? err.message : 'The movement could not be loaded.')
      })
    return () => controller.abort()
  }, [given, movementId])

  const movement = given ?? loaded
  const starting = kind === 'start'
  const today = todayDateOnly()
  const stay = isStay(movement?.stage)

  const title = !movement
    ? starting
      ? 'Start movement'
      : 'Complete movement'
    : container
      ? `${starting ? `Start ${movement.typeName}` : completeWords(movement.stage, movement.toName).title} - ${container.containerRef}`
      : `${starting ? 'Start' : 'Complete'} ${movement.movementNo}`

  // The earliest date: the end of the previous leg (start), the start (complete).
  const notBefore = movement ? (starting ? (movement.startNotBefore?.slice(0, 10) ?? null) : (movement.startDate?.slice(0, 10) ?? null)) : null
  const dateProblem = !date
    ? null
    : date > today
      ? starting
        ? 'The start date cannot be in the future: start the movement on the day it really leaves.'
        : 'The end date cannot be in the future: complete the movement on the day it really arrives.'
      : notBefore && date < notBefore
        ? starting
          ? `The movement cannot start before ${movement?.startNotBeforeMovementNo ?? 'the previous leg'} reached ${movement?.startNotBeforePlaceName ?? 'its From'} on ${dateLabel(notBefore)}.`
          : `The end date cannot be before the start date (${dateLabel(notBefore)}).`
        : null
  const blocked = starting ? (movement?.startBlockedReason ?? null) : null
  const wrongStatus = movement ? (starting ? !movement.canStart : !movement.canComplete) : false

  const others = movement && container ? movement.containers.filter((c) => c.containerId !== container.id).map((c) => c.containerRef) : []

  async function confirmIt() {
    if (!movement || !date || dateProblem || blocked) return
    setBusy(true)
    setError(null)
    const before = new Map(movement.containers.map((c) => [c.containerId, c.containerStatusName]))
    try {
      const result = starting
        ? await movementsApi.start(movement.id, date, movement.rowVersion)
        : await movementsApi.complete(movement.id, date, movement.rowVersion)
      notify.success(starting ? `${result.movementNo} started.` : `${result.movementNo} completed.`)
      const changes = result.containers
        .filter((c) => before.has(c.containerId) && before.get(c.containerId) !== c.containerStatusName)
        .map((c) => `${c.containerRef}: ${before.get(c.containerId)} -> ${c.containerStatusName}`)
      if (changes.length > 0) notify.info(changes.length > 10 ? `${changes.slice(0, 10).join('; ')} and ${formatNumber(changes.length - 10)} more` : changes.join('; '))
      // A Delivery: the drafts created, linked, and the containers that got none, with the reason (rule 5).
      if (!starting && (result.goodsReceipts?.length || result.warnings?.length)) {
        showDeliveryResult(result.goodsReceipts, result.warnings, { canViewReceipts, navigate: (to) => void navigate(to) })
        void refreshGoodsReceiptsWaiting()
      } else if (!starting && result.goodsReceiptsAutomatic === false && result.goodsReceiptsMessage) {
        // (79) The goods receipt type makes them by hand: none was drafted, and the answer says what to do instead.
        notify.info(result.goodsReceiptsMessage)
      }
      onDone(result)
    } catch (err) {
      // Shown in the dialog, which stays open: the reader fixes the date, or reads why and cancels.
      setError(err instanceof ApiError ? err.message : starting ? 'The movement could not be started.' : 'The movement could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const delivery = !starting && movement?.stage === DELIVERY

  return (
    <Modal opened onClose={onClose} title={title} size={delivery ? 'lg' : 'md'} closeOnClickOutside={!busy} withCloseButton={!busy}>
      {loadError ? (
        <Alert color="red">{loadError}</Alert>
      ) : !movement ? (
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      ) : (
        <Stack data-movement-status-dialog>
          <Text fz="sm" fw={600}>
            {movement.movementNo} {movement.typeName}: {movement.fromName}
            {movement.toPlaceId === movement.fromPlaceId ? '' : ` → ${movement.toName}`}
            {movement.startDate ? ` · started ${dateLabel(movement.startDate)}` : ''}
            {movement.eta ? ` · ETA ${dateLabel(movement.eta)}` : ''}
          </Text>
          {others.length > 0 ? (
            <Alert color="orange" py={6} data-status-others>
              {`All ${formatNumber(movement.containers.length)} containers of ${movement.movementNo} ${starting ? 'start' : 'arrive'} too: ${container?.containerRef}, ${someRefs(others)}.`}
            </Alert>
          ) : null}
          {delivery ? (
            <DeliveryCompletePreview movement={movement} />
          ) : (
            <Text fz="sm">
              {starting
                ? 'The containers on the movement set off: their status, dates and location follow the stage of the movement type.'
                : stay
                  ? 'The containers are done here: their status, dates and location follow the stage of the movement type.'
                  : 'The containers arrive: their status, dates and location follow the stage of the movement type.'}
            </Text>
          )}
          {blocked ? (
            <Alert color="red" py={6} data-status-blocked>
              {blocked}
            </Alert>
          ) : wrongStatus ? (
            <Alert color="red" py={6}>
              {starting ? 'Only a planned movement can be started.' : 'Only a movement in progress can be completed.'}
            </Alert>
          ) : null}
          <DateInput
            label={starting ? 'Start date' : completeWords(movement.stage, movement.toName).dateLabel}
            withAsterisk
            valueFormat="DD/MM/YYYY"
            value={date}
            // No maxDate / minDate: a typed date outside them would be dropped silently, and the reader must read why.
            onChange={(next) => {
              setDate(next ? String(next).slice(0, 10) : null)
              setError(null)
            }}
            error={dateProblem ?? undefined}
            data-autofocus
          />
          {error ? (
            <Alert color="red" py={6} data-status-error>
              {error}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              color={starting ? undefined : 'green'}
              leftSection={starting ? <IconPlayerPlay size={16} /> : <IconCheck size={16} />}
              disabled={!date || dateProblem !== null || blocked !== null || wrongStatus}
              loading={busy}
              onClick={() => void confirmIt()}
            >
              {starting ? 'Start movement' : 'Complete movement'}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
