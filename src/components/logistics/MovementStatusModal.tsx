import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Alert, Anchor, Button, Checkbox, Group, Loader, Modal, ScrollArea, Stack, Switch, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconPlayerPlay } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { movementsApi, type MovementDto, type MovementSplitResultDto } from '../../api/logistics/movements'
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
  /**
   * (82) The movement page: a Complete of a movement in progress that carries several containers offers "Only some
   * containers arrived" - the ticked ones get their own movement, completed; the others stay on this one, in progress.
   */
  allowSplit?: boolean
  /**
   * After "Only some containers arrived": the host reads this movement again (it carries the others now). Null when no
   * answer came back (a server error, a lost connection): the split may have happened, so the host reads it again too.
   */
  onSplitDone?(result: MovementSplitResultDto | null): void
  /**
   * (82) The way back the "Open MOV-…" links of its notifications carry - the page's own ("?from=container/12",
   * "?from=shipments"), so Back on that movement returns where the reader came from.
   */
  returnQuery?: string
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
 * - (82) ON THE MOVEMENT PAGE, "Only some containers arrived" (a movement in progress carrying several): a checklist of
 *   its containers, ticked = arrived, each that cannot leave it disabled with the server's reason. The ticked ones get
 *   their own movement (`complete-some`), completed on the date - a Delivery drafts only their goods receipts - and the
 *   others stay on this one, in progress. Ticking none or every one is said before the click. While it is on, the
 *   dialog is the movement's ("Complete MOV-…"), never the one container's it was opened from, and "All 12 containers …
 *   arrive too" is not said. A refusal stays in the dialog; no answer at all (a server error, a lost connection) is never
 *   read as "nothing split": the page reads its movement again and says to look.
 */
export function MovementStatusModal({ kind, movementId, movement: given, container, onClose, onDone, allowSplit = false, onSplitDone, returnQuery = '' }: MovementStatusModalProps) {
  const navigate = useNavigate()
  const canViewReceipts = useAuth().hasPermission(PERMISSIONS.goodsReceiptsView)
  const [loaded, setLoaded] = useState<MovementDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [date, setDate] = useState<string | null>(todayDateOnly())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** (82) "Only some containers arrived", and the ones ticked as arrived. */
  const [someOnly, setSomeOnly] = useState(false)
  const [arrived, setArrived] = useState<ReadonlySet<number>>(() => new Set())
  /* (82) ON A PHONE THE DATE IS NOT FOCUSED WHEN THE DIALOG OPENS: its calendar opened over the dialog, over "Only some
     containers arrived" and its checklist above the date, where a tap picked a day instead. There the date opens when
     tapped. Read at once (not in an effect), so the first render already knows. */
  const phone = useMediaQuery('(max-width: 36em)', false, { getInitialValueInEffect: false })

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

  /* (82) ONLY SOME ARRIVED: a Complete of a movement in progress that carries several containers. Each container says
     whether it can leave it (the server's canSplitOff, its reason under it when not); the ticked ones get their own
     movement, the others stay on this one. Ticking none or every one is said before the click, as the server would. */
  const splitAvailable = !starting && allowSplit && movement !== null && movement.status === 2 && movement.containers.length > 1
  const splitting = splitAvailable && someOnly

  // Splitting, the dialog is about the movement and the ticked containers, not the one it was opened from.
  const title = !movement
    ? starting
      ? 'Start movement'
      : 'Complete movement'
    : container && !splitting
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

  const total = movement?.containers.length ?? 0
  const someProblem = !splitting
    ? null
    : arrived.size === 0
      ? 'Tick the containers that arrived.'
      : arrived.size === total
        ? `Every container of ${movement?.movementNo ?? 'the movement'} is ticked: complete the movement itself (turn off "Only some containers arrived").`
        : null

  function tick(containerId: number, on: boolean) {
    setArrived((current) => {
      const next = new Set(current)
      if (on) next.add(containerId)
      else next.delete(containerId)
      return next
    })
    setError(null)
  }

  /** The movement made for the ones that arrived, as a link in the notification (the way back kept: `returnQuery`). */
  function movementLink(m: Pick<MovementDto, 'id' | 'movementNo'> | null) {
    if (!m) return null
    return (
      <Anchor component="button" type="button" fz="xs" fw={600} onClick={() => void navigate(`/logistics/movements/${m.id}${returnQuery}`)}>
        Open {m.movementNo}
      </Anchor>
    )
  }

  async function completeSome() {
    if (!movement || !date || dateProblem || someProblem) return
    setBusy(true)
    setError(null)
    try {
      const result = await movementsApi.completeSome(movement.id, { containerIds: [...arrived], date, rowVersion: movement.rowVersion })
      const own = result.movement
      // Named even when it could not be read back (the database did not answer after the split)
      const ownRef = own ?? (result.movementId ? { id: result.movementId, movementNo: result.movementNo } : null)
      if (result.ok) {
        notifications.show({
          color: 'green',
          withBorder: true,
          autoClose: 10000,
          message: (
            <Stack gap={2} data-status-split-done>
              <Text fz="sm">{result.message}</Text>
              {movementLink(ownRef)}
            </Stack>
          ),
        })
        // A Delivery: the drafts made for the containers that arrived, and the ones that got none (rule 5).
        if (own && (own.goodsReceipts?.length || result.warnings.length)) {
          showDeliveryResult(own.goodsReceipts, result.warnings, { canViewReceipts, navigate: (to) => void navigate(to) })
          void refreshGoodsReceiptsWaiting()
        } else if (own?.goodsReceiptsAutomatic === false && own.goodsReceiptsMessage) {
          notify.info(own.goodsReceiptsMessage)
        }
      } else {
        // SPLIT BUT NOT COMPLETED: they are on their own movement now, in progress - a warning, with that movement.
        notifications.show({
          color: 'orange',
          withBorder: true,
          autoClose: 20000,
          message: (
            <Stack gap={2} data-status-split-not-completed>
              <Text fz="sm">{result.message}</Text>
              {movementLink(ownRef)}
            </Stack>
          ),
        })
      }
      onSplitDone?.(result)
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        // A refusal (the date, a container changed meanwhile...): nothing was split - shown in the dialog, which stays open.
        setError(err.message)
      } else {
        // NO ANSWER TO READ (a server error, a lost connection): the split may have happened all the same - the server
        // answers every split it committed - so the movement is read again and the reader told to look, never that
        // nothing changed.
        notifications.show({
          color: 'orange',
          withBorder: true,
          autoClose: 20000,
          message: (
            <Text fz="sm" data-status-split-unknown>
              {`${err instanceof ApiError ? err.message : 'The answer did not come back.'} Whether the ticked containers left ${movement.movementNo} is not known: the movement is read again - check which containers are still on it.`}
            </Text>
          ),
        })
        onSplitDone?.(null)
      }
    } finally {
      setBusy(false)
    }
  }

  async function confirmIt() {
    if (splitting) {
      await completeSome()
      return
    }
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
          {others.length > 0 && !splitting ? (
            <Alert color="orange" py={6} data-status-others>
              {`All ${formatNumber(movement.containers.length)} containers of ${movement.movementNo} ${starting ? 'start' : 'arrive'} too: ${container?.containerRef}, ${someRefs(others)}.`}
            </Alert>
          ) : null}
          {splitAvailable ? (
            <Switch
              label="Only some containers arrived"
              description={`The ticked containers get their own movement, completed on the date below; the others stay on ${movement.movementNo}, in progress.`}
              checked={someOnly}
              onChange={(e) => {
                setSomeOnly(e.currentTarget.checked)
                setError(null)
              }}
              data-status-some-only
            />
          ) : null}
          {splitting ? (
            <Stack gap={4} data-status-some-list>
              <Text fz="sm" fw={600}>
                {`Arrived: ${formatNumber(arrived.size)} of ${formatNumber(total)}`}
              </Text>
              <ScrollArea.Autosize mah={280} type="auto" offsetScrollbars="y">
                <Stack gap={6}>
                  {movement.containers.map((c) => (
                    <Checkbox
                      key={c.containerId}
                      label={`${c.containerRef}${c.containerNo ? ` · ${c.containerNo}` : ''}`}
                      description={c.canSplitOff === false ? (c.splitOffBlockedReason ?? 'It cannot arrive on its own now.') : undefined}
                      disabled={c.canSplitOff === false || busy}
                      checked={arrived.has(c.containerId)}
                      onChange={(e) => tick(c.containerId, e.currentTarget.checked)}
                      data-status-some-container={c.containerRef}
                    />
                  ))}
                </Stack>
              </ScrollArea.Autosize>
              {someProblem ? (
                <Text fz="xs" c={arrived.size === 0 ? 'dimmed' : 'red.7'} data-status-some-problem>
                  {someProblem}
                </Text>
              ) : null}
            </Stack>
          ) : null}
          {delivery ? (
            // Only some arrive: only their draft goods receipts are announced.
            <DeliveryCompletePreview movement={splitting ? { ...movement, containers: movement.containers.filter((c) => arrived.has(c.containerId)) } : movement} />
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
            data-autofocus={phone ? undefined : true}
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
              disabled={!date || dateProblem !== null || blocked !== null || wrongStatus || someProblem !== null}
              loading={busy}
              onClick={() => void confirmIt()}
              data-status-confirm
            >
              {starting ? 'Start movement' : splitting ? `Complete ${formatNumber(arrived.size)} of ${formatNumber(total)} containers` : 'Complete movement'}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
