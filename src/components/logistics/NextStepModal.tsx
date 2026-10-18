import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Alert, Anchor, Button, Checkbox, Group, Loader, Modal, Stack, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconPlayerPlay, IconRoute } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { movementsApi, type MovementDto } from '../../api/logistics/movements'
import { nextStepApi, type ContainerNextStepDto, type NextStepGroupRequest, type NextStepGroupResultDto } from '../../api/logistics/nextStep'
import { movementTypesApi, type MovementTypeLookupDto } from '../../api/masterdata/movementTypes'
import { portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import { useAuth } from '../../auth/useAuth'
import { refreshGoodsReceiptsWaiting } from '../../hooks/useGoodsReceiptsWaiting'
import { PERMISSIONS } from '../../navigation'
import { routes } from '../../routes'
import { dateLabel } from '../documents/documentKind'
import { formatNumber, todayDateOnly } from '../format'
import { notify } from '../ui/notify'
import { DeliveryCompletePreview } from './DeliveryReceipts'
import { showDeliveryResult } from './deliveryNotification'
import { initialLeg, legDateProblem, legProblem, retypeLeg, SEA, type LegPrefill, type LegValues } from './nextLeg'
import { NextLegFields } from './NextLegFields'
import { completeWords, DRAFT_NOT_CONFIRMABLE, movementLine, newLegTitle, proposalSourceText, thenLabel, thenNeedsTo } from './nextStep'
import { isStay } from './shipStep'

/** How many other containers a line names before "(N more)". */
const NAMED = 2

const DELIVERY = 'Delivery'

interface NextStepModalProps {
  containerId: number
  containerRef: string
  /**
   * The way back the movement link of the notification carries ("?from=container/12", "?from=containers"), so Back on
   * the movement returns to the page the dialog was opened from.
   */
  returnQuery?: string
  onClose(): void
  /** After the step: the host reloads what it shows. */
  onDone(): void
}

/** "KTG-2026-0032, KTG-2026-0033 (2 more)". */
function someRefs(refs: string[]): string {
  const shown = refs.slice(0, NAMED).join(', ')
  return refs.length > NAMED ? `${shown} (${formatNumber(refs.length - NAMED)} more)` : shown
}

/**
 * "NEXT STEP…" FOR ONE CONTAINER (script 81): one dialog for every step of its journey, already filled in from where the
 * container is and what the server proposes.
 *
 * - A NEW LEG ("Start shipment…", "Inland transport to Kasumbalesa…"): the proposed type and To, the From locked to
 *   where it is, today; "Start now" / "Plan only". Where the proposal came from is said under the type (the usual next
 *   leg from here, the container's ports, the stages).
 * - A PLANNED LEG ("Start Inland transport…"): its start date, and the containers that start with it.
 * - A LEG IN PROGRESS ("Arrived at Dar es Salaam…", "Cleared customs at Kasumbalesa…"): the date named by the stage, the
 *   containers that arrive too, and "Then start …" for the leg proposed after it - a second step once the arrival is
 *   committed, so a refusal there never undoes the arrival. A Delivery shows its draft goods receipts and can open the
 *   container's draft afterwards.
 *
 * Every step goes through the API's next step, which takes the movement's own Complete / Start (the Delivery's goods
 * receipts are drafted after the commit) or saves a new leg with the movement procedures: the server's refusal is shown
 * here as it comes, and the dialog stays open.
 */
export function NextStepModal({ containerId, containerRef, returnQuery = '', onClose, onDone }: NextStepModalProps) {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canConfirm = hasPermission(PERMISSIONS.containersConfirm)
  const canViewReceipts = hasPermission(PERMISSIONS.goodsReceiptsView)

  const [step, setStep] = useState<ContainerNextStepDto | null>(null)
  const [movement, setMovement] = useState<MovementDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [types, setTypes] = useState<MovementTypeLookupDto[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  const [leg, setLeg] = useState<LegValues | null>(null)
  const [date, setDate] = useState<string | null>(todayDateOnly())
  const [then, setThen] = useState(false)
  const [openReceipt, setOpenReceipt] = useState(true)
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    nextStepApi
      .get(containerId, controller.signal)
      .then(async (dto) => {
        if (controller.signal.aborted) return
        setStep(dto)
        setThen(dto.thenDefault && !thenNeedsTo(dto))
        if (dto.kind === 'Ship' || dto.kind === 'NextLeg') {
          setLeg(
            initialLeg(
              { typeId: dto.proposedTypeId, toPlaceId: dto.proposedToPlaceId, stage: dto.proposedStage, placeId: dto.placeId },
              prefillOf(dto),
            ),
          )
          // A draft the reader may not confirm can be planned, not started.
          if (dto.isDraft && !canConfirm) setLeg((current) => (current ? { ...current, startMode: 'plan' } : current))
        }
        // The movement of the step: the containers it carries, the Delivery's draft goods receipts to come.
        if ((dto.kind === 'Complete' || dto.kind === 'StartPlanned') && dto.movementId !== null) {
          const mv = await movementsApi.get(dto.movementId, controller.signal)
          if (!controller.signal.aborted) setMovement(mv)
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(err instanceof ApiError ? err.message : 'The next step of the container could not be loaded.')
      })
    movementTypesApi.lookup(true).then((list) => !controller.signal.aborted && setTypes(list)).catch(() => {})
    portsApi.lookup(true).then((list) => !controller.signal.aborted && setPorts(list)).catch(() => {})
    return () => controller.abort()
  }, [containerId, canConfirm])

  const kind = step?.kind ?? null
  const newLeg = kind === 'Ship' || kind === 'NextLeg'
  const completing = kind === 'Complete'
  const starting = kind === 'StartPlanned'
  const legType = types.find((t) => String(t.id) === leg?.typeId) ?? null
  const proposal = useMemo(
    () => ({ typeId: step?.proposedTypeId ?? null, toPlaceId: step?.proposedToPlaceId ?? null, placeId: step?.placeId ?? null }),
    [step],
  )
  const place = step?.placeId != null ? { id: step.placeId, name: step.placeName ?? '' } : null
  const neverMoved = (step?.movementCount ?? 0) === 0
  const draftBlocked = Boolean(step?.isDraft && !canConfirm)

  /* the title: the label of the step, without its "…" */
  const words = completeWords(step?.movementStage, step?.movementToName)
  const title = !step
    ? `Next step - ${containerRef}`
    : completing
      ? `${words.title} - ${containerRef}`
      : starting
        ? `Start ${step.movementTypeName ?? 'the planned leg'} - ${containerRef}`
        : kind === 'Ship'
          ? `Start shipment - ${containerRef}`
          : `${newLegTitle({ typeName: step.proposedTypeName, stage: step.proposedStage, isStay: step.proposedIsStay, toName: step.proposedToName, placeName: step.placeName })} - ${containerRef}`

  /* the earliest date */
  const today = todayDateOnly()
  const notBefore = (completing || starting ? step?.movementNotBefore : (step?.placeSince ?? step?.lastMovementEndDate))?.slice(0, 10) ?? null
  const dateProblem = newLeg
    ? leg
      ? legDateProblem(leg, notBefore, step?.lastMovementNo)
      : null
    : !date
      ? 'Choose the date.'
      : date > today
        ? completing
          ? 'The date cannot be in the future: record it on the day it really happened.'
          : 'The start date cannot be in the future: start the movement on the day it really leaves.'
        : notBefore && date < notBefore
          ? completing
            ? `The date cannot be before the start of ${step?.movementNo ?? 'the movement'} (${dateLabel(notBefore)}).`
            : `The movement cannot start before the previous leg ended (${dateLabel(notBefore)}).`
          : null
  const placeProblem = newLeg && leg && tried ? legProblem(leg, types) : null

  const others = movement ? movement.containers.filter((c) => c.containerId !== containerId).map((c) => c.containerRef) : []
  const delivery = completing && step?.movementStage === DELIVERY
  const receiptsAutomatic = movement?.goodsReceiptsAutomatic !== false
  const blocked = step?.blockedReason ?? (starting ? (movement?.startBlockedReason ?? null) : null)
  const thenOffered = completing && !delivery && step?.thenTypeId != null
  const thenWithoutTo = step ? thenNeedsTo(step) : false

  const primaryLabel = completing
    ? words.button
    : starting
      ? `Start ${step?.movementTypeName ?? 'movement'}`
      : kind === 'Ship'
        ? leg?.startMode === 'plan'
          ? 'Plan shipment'
          : 'Start shipment'
        : `${leg?.startMode === 'plan' ? 'Plan' : 'Start'} ${legType?.typeName ?? 'the leg'}`

  function onTypeChange(typeId: string | null) {
    if (!leg || !step) return
    setLeg(retypeLeg(leg, typeId, types, proposal, prefillOf(step)))
    setError(null)
  }

  function request(): NextStepGroupRequest | null {
    if (!step || !kind) return null
    if (completing || starting) {
      return {
        key: containerRef,
        kind,
        movementId: step.movementId,
        rowVersion: step.movementRowVersion,
        containerIds: [containerId],
        date,
        then: completing && then && thenOffered ? { startNow: true, date } : null,
      }
    }
    if (!leg || !legType) return null
    const sea = legType.stage === SEA
    const stay = isStay(legType.stage)
    return {
      key: containerRef,
      kind: kind === 'Ship' ? 'Ship' : 'NextLeg',
      containerIds: [containerId],
      movementTypeId: legType.id,
      fromPlaceId: legType.stage === 'Origin' && leg.fromId ? Number(leg.fromId) : null,
      toPlaceId: stay ? (step.placeId ?? null) : leg.toId ? Number(leg.toId) : null,
      startNow: leg.startMode === 'start',
      date: leg.date,
      eta: leg.eta,
      carrierPartyId: leg.carrierId ? Number(leg.carrierId) : null,
      vehicleOrVessel: leg.vessel.trim() || null,
      voyageNo: sea ? leg.voyage.trim() || null : null,
      reference: leg.reference.trim() || null,
      blNo: sea ? leg.blNo.trim() || null : null,
      blDate: sea ? leg.blDate : null,
      notes: leg.notes.trim() || null,
      onePerContainer: false,
      copyToContainers: sea ? leg.copyToContainers : true,
    }
  }

  async function submit() {
    setTried(true)
    if (!step || dateProblem || blocked) return
    if (newLeg && leg && legProblem(leg, types)) return
    const body = request()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      const [result] = await nextStepApi.apply([body])
      if (!result?.ok) {
        // Shown in the dialog, which stays open: the reader changes the date, or reads why and cancels.
        setError(result?.message ?? 'The step could not be taken.')
        return
      }
      announce(result)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The step could not be taken.')
    } finally {
      setBusy(false)
    }
  }

  /** The server's sentence, with its movements as links; then the Delivery's draft goods receipts and the warnings. */
  function announce(result: NextStepGroupResultDto) {
    const made = [...result.movements, ...result.thenMovements]
    notifications.show({
      color: 'green',
      withBorder: true,
      autoClose: 8000,
      message: (
        <Stack gap={2} data-next-step-done>
          <Text fz="sm">{result.message}</Text>
          {made.length > 0 ? (
            <Group gap={6}>
              {made.slice(0, 3).map((m) => (
                <Anchor key={m.id} component="button" type="button" fz="xs" fw={600} onClick={() => void navigate(`/logistics/movements/${m.id}${returnQuery}`)}>
                  Open {m.movementNo}
                </Anchor>
              ))}
            </Group>
          ) : null}
        </Stack>
      ),
    })
    if (delivery) {
      if (result.goodsReceipts?.length) {
        showDeliveryResult(result.goodsReceipts, result.warnings, { canViewReceipts, navigate: (to) => void navigate(to) })
      } else {
        for (const warning of result.warnings) notifications.show({ message: warning, color: 'orange', autoClose: 15000, withBorder: true })
        if (!result.warnings.length && result.goodsReceiptsMessage) notify.info(result.goodsReceiptsMessage)
      }
      void refreshGoodsReceiptsWaiting()
      const draft = result.goodsReceipts?.find((r) => r.containerId === containerId && r.created && r.goodsReceiptId)
      if (openReceipt && canViewReceipts && draft?.goodsReceiptId) void navigate(routes.goodsReceipt(draft.goodsReceiptId))
    } else {
      for (const warning of result.warnings) notifications.show({ message: warning, color: 'orange', autoClose: 15000, withBorder: true })
    }
  }

  const where =
    step && newLeg
      ? neverMoved
        ? `Not moved yet: leaves from its port of loading ${step.placeName ?? '(none)'}.`
        : `Now at ${step.placeName ?? '—'}${step.placeSince ? ` since ${dateLabel(step.placeSince)}` : ''}${step.lastMovementNo ? ` (end of ${step.lastMovementNo})` : ''}.`
      : null
  const typeHint =
    step && leg && legType
      ? String(step.proposedTypeId) === leg.typeId
        ? proposalSourceText(step.proposalSource, step.proposalLegs, step.placeName, step.proposedToPlaceId !== null || Boolean(step.proposedIsStay))
        : !isStay(legType.stage) && legType.stage !== 'Origin' && !leg.toId
          ? 'Choose the To'
          : null
      : null

  return (
    <Modal opened onClose={onClose} title={title} size={newLeg ? 'xl' : delivery ? 'lg' : 'md'} closeOnClickOutside={!busy} withCloseButton={!busy}>
      {loadError ? (
        <Alert color="red">{loadError}</Alert>
      ) : !step || ((completing || starting) && !movement) || (newLeg && (!leg || types.length === 0)) ? (
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Stack gap="sm" data-next-step-dialog={kind ?? ''}>
            {where ? (
              <Text fz="sm" fw={600} data-next-step-where>
                {where}
              </Text>
            ) : null}
            {completing || starting ? (
              <Text fz="sm" fw={600} data-next-step-movement>
                {movementLine(step, dateLabel)}
              </Text>
            ) : null}

            {/* the alerts */}
            {newLeg && step.isDraft ? (
              <Alert color="blue" py={6}>
                {draftBlocked ? `${DRAFT_NOT_CONFIRMABLE} The leg can still be planned.` : 'This container is a draft: it is confirmed first.'}
              </Alert>
            ) : null}
            {newLeg && !step.hasContainerNo ? (
              <Alert color="yellow" py={6}>
                No container number yet: the shipment can start without it.
              </Alert>
            ) : null}
            {newLeg && step.hasTypedDates && neverMoved ? (
              <Alert color="orange" py={6} data-next-step-typed-dates>
                The dispatch and arrival dates typed on this container will be replaced by the movements' dates.
              </Alert>
            ) : null}
            {others.length > 0 ? (
              <Alert color="orange" py={6} data-next-step-others>
                {completing
                  ? `All ${formatNumber(movement?.containers.length ?? 0)} containers of ${step.movementNo} arrive too: ${containerRef}, ${someRefs(others)}.`
                  : `It also carries ${someRefs(others)}: they start with it.`}
              </Alert>
            ) : null}
            {blocked ? (
              <Alert color="red" py={6} data-next-step-blocked>
                {blocked}
              </Alert>
            ) : null}

            {newLeg && leg ? (
              <NextLegFields
                values={leg}
                onChange={(patch) => {
                  setLeg({ ...leg, ...patch })
                  setError(null)
                }}
                onTypeChange={onTypeChange}
                types={types}
                ports={ports}
                place={place}
                neverMoved={neverMoved}
                typeHint={typeHint}
                dateProblem={dateProblem}
                placeProblem={placeProblem}
                startDisabled={draftBlocked}
              />
            ) : (
              <>
                {delivery && movement ? <DeliveryCompletePreview movement={movement} /> : null}
                <DateInput
                  label={completing ? words.dateLabel : 'Start date'}
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
                {thenOffered ? (
                  <Checkbox
                    label={thenLabel(step)}
                    description={
                      thenWithoutTo
                        ? 'No usual To from here yet: choose it with Next step… once the arrival is recorded.'
                        : proposalSourceText(step.thenSource, step.thenLegs, step.movementToName, true)
                    }
                    checked={then && !thenWithoutTo}
                    disabled={thenWithoutTo}
                    onChange={(e) => setThen(e.currentTarget.checked)}
                    data-next-step-then
                  />
                ) : null}
                {delivery && receiptsAutomatic && canViewReceipts ? (
                  <Checkbox label="Then open the draft goods receipt" checked={openReceipt} onChange={(e) => setOpenReceipt(e.currentTarget.checked)} data-next-step-open-receipt />
                ) : null}
              </>
            )}

            {error ? (
              <Alert color="red" py={6} data-next-step-error>
                {error}
              </Alert>
            ) : null}
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                color={completing ? 'green' : undefined}
                leftSection={completing ? <IconCheck size={16} /> : starting ? <IconPlayerPlay size={16} /> : <IconRoute size={16} />}
                disabled={dateProblem !== null || blocked !== null}
                loading={busy}
                data-next-step-submit
              >
                {primaryLabel}
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  )
}

/** What a new leg starts from: the container's vessel, voyage and B/L (a sea leg), its truck no. (a road leg). */
function prefillOf(step: ContainerNextStepDto): LegPrefill {
  return { vesselName: step.vesselName, voyageNo: step.voyageNo, blNo: step.blNo, blDate: step.blDate, truckNo: step.truckNo }
}
