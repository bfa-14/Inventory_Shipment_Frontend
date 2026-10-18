import { useEffect, useMemo, useState } from 'react'
import { Alert, Anchor, Checkbox, Group, Radio, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useNavigate } from 'react-router'
import { ApiError } from '../../api/http'
import { movementsApi, type ShippedMovementDto } from '../../api/logistics/movements'
import { movementTypesApi, type MovementTypeLookupDto } from '../../api/masterdata/movementTypes'
import { partiesApi } from '../../api/masterdata/parties'
import { portLabel, portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import type { PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../navigation'
import { dateLabel, fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, todayDateOnly } from '../format'
import { FormModal } from '../ui/FormModal'
import type { SelectableContainer } from './containerSelection'
import { FROM_LOCKED_HINT, isStay, placeOptionGroups, shipRefusal } from './shipStep'

interface StartShipmentModalProps {
  containers: SelectableContainer[]
  onClose(): void
  onShipped(movement: ShippedMovementDto): void
  /**
   * The way back the movement link of the notification carries ("?from=container/12", "?from=containers"), so that
   * Back on the movement returns to the page the dialog was opened from. Empty: Back goes to the Movements list.
   */
  returnQuery?: string
}

const DEFAULT_TYPE_CODE = 'SEA'
const DRAFT = 1
const REFS_SHOWN = 2
const LEFT_OUT_SHOWN = 5

/** "KTG-1, KTG-2 (+3)". */
function refList(containers: SelectableContainer[]): string {
  const shown = containers.slice(0, REFS_SHOWN).map((c) => c.containerRef).join(', ')
  return containers.length > REFS_SHOWN ? `${shown} (+${formatNumber(containers.length - REFS_SHOWN)})` : shown
}

/** The one value every container shares, or null when they differ or one has none. */
function common(values: (string | null)[]): string | null {
  const first = values[0] ?? null
  return first !== null && values.every((v) => v === first) ? first : null
}

/**
 * The place most of the containers are at, among those that know theirs (the end of their latest movement, else their
 * port of loading). Null when none of them knows it: any From fits them.
 */
function commonPlace(containers: SelectableContainer[]): { id: number; name: string } | null {
  const counts = new Map<number, { id: number; name: string; count: number }>()
  for (const c of containers) {
    if (c.placeId == null) continue
    const entry = counts.get(c.placeId) ?? { id: c.placeId, name: c.placeName ?? '', count: 0 }
    entry.count += 1
    counts.set(c.placeId, entry)
  }
  let best: { id: number; name: string; count: number } | null = null
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry
  return best ? { id: best.id, name: best.name } : null
}

/**
 * "Start shipment…" for the ticked containers - or the one container of its page: ONE movement for all of them, in one
 * call - the drafts confirmed, the movement created and started (or only planned), the vessel, voyage, B/L and ETA
 * copied to the containers.
 *
 * A CONTAINER LEAVES FROM WHERE IT IS (script 80). The From is the place the containers are at - the end of their latest
 * movement, else their port of loading - and is locked ("A container leaves from where it is."); for Loading at the
 * supplier it is the To instead (the port of loading). For a stay (port, customs, border) the To is the From by default.
 *
 * THE CONTAINERS THAT CANNOT SHIP ARE LEFT OUT, named with the reason, before the click: received, closed or cancelled,
 * travelling with a movement, a next movement already planned, a draft the reader may not confirm, at another place.
 * The server checks it all again; its refusal is shown in the dialog as it comes.
 *
 * TO MAY STAY EMPTY for a sea leg of containers that never moved: the server takes their common port of destination,
 * shown as the hint.
 */
export function StartShipmentModal({ containers, onClose, onShipped, returnQuery = '' }: StartShipmentModalProps) {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canConfirm = hasPermission(PERMISSIONS.containersConfirm)

  const [types, setTypes] = useState<MovementTypeLookupDto[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  const [carriers, setCarriers] = useState<PartyLookupDto[]>([])

  const [typeId, setTypeId] = useState<string | null>(null)
  const [fromId, setFromId] = useState<string | null>(null)
  const [toId, setToId] = useState<string | null>(null)
  const [startDate, setStartDate] = useState<string | null>(isoDate(new Date()))
  const [eta, setEta] = useState<string | null>(null)
  const [carrierId, setCarrierId] = useState<string | null>(null)
  const [vessel, setVessel] = useState('')
  const [voyage, setVoyage] = useState('')
  const [reference, setReference] = useState('')
  const [blNo, setBlNo] = useState('')
  const [blDate, setBlDate] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [startNow, setStartNow] = useState<'start' | 'plan'>('start')
  const [copyToContainers, setCopyToContainers] = useState(true)
  const [placeError, setPlaceError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    movementTypesApi
      .lookup(true)
      .then((list) => {
        if (!live) return
        setTypes(list)
        const sea = list.find((t) => t.typeCode === DEFAULT_TYPE_CODE)
        if (sea) setTypeId((current) => current ?? String(sea.id))
      })
      .catch(() => {})
    portsApi.lookup(true).then((list) => live && setPorts(list)).catch(() => {})
    partiesApi.lookup({ activeOnly: true }).then((list) => live && setCarriers(list)).catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const type = types.find((t) => String(t.id) === typeId) ?? null
  const seaLeg = type?.stage === 'Sea'
  const origin = type?.stage === 'Origin'
  const stay = isStay(type?.stage)

  /* WHO SHIPS: the refusals the server would give, said first; then the place most of the others are at. */
  const plan = useMemo(() => {
    const leftOut: { ref: string; reason: string }[] = []
    let candidates: SelectableContainer[] = []
    for (const c of containers) {
      const reason = shipRefusal(c, canConfirm)
      if (reason) leftOut.push({ ref: c.containerRef, reason })
      else candidates.push(c)
    }
    if (origin) {
      for (const c of candidates.filter((x) => (x.movementCount ?? 0) > 0))
        leftOut.push({ ref: c.containerRef, reason: `${c.containerRef} has already moved: loading at the supplier is only for containers that have not moved yet.` })
      candidates = candidates.filter((x) => (x.movementCount ?? 0) === 0)
    }
    const place = commonPlace(candidates)
    const shipping = candidates.filter((c) => place === null || c.placeId == null || c.placeId === place.id)
    for (const c of candidates.filter((x) => !shipping.includes(x)))
      leftOut.push({ ref: c.containerRef, reason: `${c.containerRef} is at ${c.placeName ?? 'another place'}, not at ${place?.name ?? ''}: ship it from there.` })
    // The earliest start: the latest end of their previous legs (the server refuses before it).
    const since = shipping.map((c) => c.placeSince?.slice(0, 10) ?? null).filter((d): d is string => d !== null).sort().at(-1) ?? null
    return { leftOut, shipping, place, since }
  }, [containers, canConfirm, origin])

  const { leftOut, shipping, place, since } = plan
  const anyMoved = shipping.some((c) => (c.movementCount ?? 0) > 0)
  // Loading at the supplier ends at the port of loading: the To is locked there, the From is the supplier's.
  const fromLocked = !origin && place !== null
  const toLocked = origin && place !== null
  const fromValue = fromLocked ? String(place.id) : fromId
  const toValue = toLocked ? String(place.id) : (toId ?? (stay ? fromValue : null))
  const from = common(shipping.map((c) => c.portOfLoadingName))
  const to = common(shipping.map((c) => c.portOfDestinationName))
  // The server's default: a sea leg of containers that never moved goes to their common port of destination.
  const toByDefault = seaLeg && !anyMoved && to !== null
  const drafts = shipping.filter((c) => c.status === DRAFT)
  const withoutNumber = shipping.filter((c) => !c.containerNo)
  const today = todayDateOnly()
  const dateProblem =
    !startDate || startNow === 'plan'
      ? null
      : startDate > today
        ? 'The start date cannot be in the future: choose Plan only for a later date.'
        : since && startDate < since
          ? `The containers got here on ${dateLabel(since)}: the shipment cannot start before.`
          : null

  async function save() {
    if (shipping.length === 0) return
    if (!typeId) {
      setError('Choose the movement type.')
      return
    }
    if (!fromValue || (!toValue && !toByDefault)) {
      setPlaceError(!fromValue ? 'Choose where from.' : 'Choose where to.')
      return
    }
    if (dateProblem) return
    setPlaceError(null)
    setSaving(true)
    setError(null)
    try {
      const movement = await movementsApi.shipContainers({
        containerIds: shipping.map((c) => c.id),
        movementTypeId: Number(typeId),
        fromPlaceId: Number(fromValue),
        toPlaceId: toValue ? Number(toValue) : null,
        startDate,
        eta,
        carrierPartyId: carrierId ? Number(carrierId) : null,
        vehicleOrVessel: vessel.trim() || null,
        voyageNo: voyage.trim() || null,
        reference: reference.trim() || null,
        blNo: blNo.trim() || null,
        blDate,
        notes: notes.trim() || null,
        startNow: startNow === 'start',
        confirmDrafts: canConfirm,
        updateContainers: copyToContainers,
      })
      const verb = movement.status === 1 ? 'planned' : 'started'
      notifications.show({
        color: 'green',
        withBorder: true,
        autoClose: 6000,
        message: (
          <Text fz="sm">
            <Anchor component="button" type="button" fz="sm" fw={600} onClick={() => void navigate(`/logistics/movements/${movement.id}${returnQuery}`)}>
              {movement.movementNo}
            </Anchor>{' '}
            {verb} with {formatNumber(movement.containerCount)} container{movement.containerCount === 1 ? '' : 's'}
          </Text>
        ),
      })
      onShipped(movement)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The shipment could not be started.')
    } finally {
      setSaving(false)
    }
  }

  const portOptions = placeOptionGroups(ports, [fromValue, toValue])
  const portName = (value: string | null) => {
    const port = ports.find((p) => String(p.id) === value)
    return port ? `${port.portCode} - ${portLabel(port)}` : null
  }
  const routeHint = toByDefault && !toValue ? `To empty = the containers' port of destination: ${from ?? '?'} → ${to}` : null

  return (
    <FormModal
      opened
      title={containers.length === 1 ? `Start shipment - ${containers[0].containerRef}` : 'Start shipment'}
      onSubmit={() => void save()}
      onClose={onClose}
      saving={saving}
      saveDisabled={shipping.length === 0 || dateProblem !== null}
      saveLabel={startNow === 'start' ? 'Start shipment' : 'Plan movement'}
      size="xl"
    >
      <Stack gap="sm">
        {shipping.length > 0 ? (
          <Text fw={600} data-ship-containers>
            {formatNumber(shipping.length)} container{shipping.length === 1 ? '' : 's'}: {refList(shipping)}
            {place ? ` · at ${place.name}` : ''}
          </Text>
        ) : (
          <Alert color="red" py={6} data-ship-none>
            None of the ticked containers can ship: {leftOut[0]?.reason ?? 'nothing is selected.'}
          </Alert>
        )}
        {leftOut.length > 0 && shipping.length > 0 ? (
          <Alert color="orange" py={6} data-ship-left-out title={`Left out (${formatNumber(leftOut.length)})`}>
            <Stack gap={2}>
              {leftOut.slice(0, LEFT_OUT_SHOWN).map((row) => (
                <Text key={row.ref} fz="sm">
                  {row.reason}
                </Text>
              ))}
              {leftOut.length > LEFT_OUT_SHOWN ? <Text fz="sm">and {formatNumber(leftOut.length - LEFT_OUT_SHOWN)} more.</Text> : null}
            </Stack>
          </Alert>
        ) : null}
        {drafts.length > 0 ? (
          <Alert color="blue" py={6}>
            {formatNumber(drafts.length)} {drafts.length === 1 ? 'is a draft' : 'are drafts'}: {drafts.length === 1 ? 'it' : 'they'} will be confirmed.
          </Alert>
        ) : null}
        {withoutNumber.length > 0 ? (
          <Alert color="yellow" py={6}>
            No container number yet: {withoutNumber.map((c) => c.containerRef).join(', ')}. The shipment can start without it.
          </Alert>
        ) : null}

        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          <Select
            label="Movement type"
            withAsterisk
            data={types.map((t) => ({ value: String(t.id), label: `${t.typeCode} - ${t.typeName}` }))}
            value={typeId}
            onChange={(next) => {
              setTypeId(next)
              // A stay starts with To = From; a leg that moves asks for its own.
              setToId(null)
            }}
            searchable
            // The dialog opens with the cursor here: an open list over the form would take the next click.
            openOnFocus={false}
            allowDeselect={false}
          />
          {fromLocked ? (
            <TextInput label="From" value={portName(fromValue) ?? place.name} readOnly description={FROM_LOCKED_HINT} data-ship-from-locked />
          ) : (
            <Select
              label="From"
              withAsterisk
              placeholder="Choose the place"
              data={portOptions}
              value={fromValue}
              onChange={(next) => {
                setFromId(next)
                setPlaceError(null)
              }}
              searchable
              clearable
              error={placeError && !fromValue ? placeError : undefined}
            />
          )}
          {toLocked ? (
            <TextInput label="To" value={portName(toValue) ?? place.name} readOnly description="Loading at the supplier ends at the port of loading." />
          ) : (
            <Select
              label="To"
              withAsterisk={!toByDefault}
              placeholder={toByDefault ? (to ?? undefined) : 'Choose the place'}
              description={stay ? 'Same place as From for this stage, unless changed.' : undefined}
              inputWrapperOrder={['label', 'input', 'description', 'error']}
              data={portOptions}
              value={toValue}
              onChange={(next) => {
                setToId(next)
                setPlaceError(null)
              }}
              searchable
              clearable
              error={placeError && !toValue && fromValue ? placeError : undefined}
            />
          )}
          <DateInput
            label={startNow === 'start' ? 'Start date' : 'Planned date'}
            valueFormat="DD/MM/YYYY"
            value={fromIsoDate(startDate)}
            // No maxDate / minDate: a typed date outside them would be dropped silently; the error says why instead.
            onChange={(next) => setStartDate(next ? isoDate(next) : null)}
            error={dateProblem ?? undefined}
          />
          <DateInput label="ETA" valueFormat="DD/MM/YYYY" clearable value={fromIsoDate(eta)} onChange={(next) => setEta(next ? isoDate(next) : null)} />
          <Select
            label="Carrier"
            placeholder="Shipping line, trucker..."
            data={carriers.map((p) => ({ value: String(p.id), label: `${p.partyCode} - ${p.partyName}` }))}
            value={carrierId}
            onChange={setCarrierId}
            searchable
            clearable
            nothingFoundMessage="No party matches"
          />
          <TextInput label="Vessel / truck" maxLength={100} value={vessel} onChange={(e) => setVessel(e.currentTarget.value)} />
          <TextInput label="Voyage" maxLength={30} value={voyage} onChange={(e) => setVoyage(e.currentTarget.value)} />
          <TextInput label="Reference (booking)" maxLength={50} value={reference} onChange={(e) => setReference(e.currentTarget.value)} />
          <TextInput label="B/L No." maxLength={30} value={blNo} onChange={(e) => setBlNo(e.currentTarget.value)} />
          <DateInput label="B/L date" valueFormat="DD/MM/YYYY" clearable value={fromIsoDate(blDate)} onChange={(next) => setBlDate(next ? isoDate(next) : null)} />
        </SimpleGrid>
        {routeHint ? (
          <Text fz="xs" c="dimmed" mt={-4} data-ship-route>
            {routeHint}
          </Text>
        ) : null}
        <Textarea label="Notes" autosize minRows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />

        <Group gap="xl" wrap="wrap">
          <Radio.Group value={startNow} onChange={(next) => setStartNow(next as 'start' | 'plan')}>
            <Group gap="md">
              <Radio value="start" label="Start now" />
              <Radio value="plan" label="Plan only" />
            </Group>
          </Radio.Group>
          <Checkbox
            label="Copy vessel, voyage, B/L and ETA to the containers"
            checked={copyToContainers}
            onChange={(e) => setCopyToContainers(e.currentTarget.checked)}
          />
        </Group>

        {error ? (
          <Alert color="red" data-ship-error>
            {error}
          </Alert>
        ) : null}
      </Stack>
    </FormModal>
  )
}
