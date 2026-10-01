import { useEffect, useState } from 'react'
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
import { fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber } from '../format'
import { FormModal } from '../ui/FormModal'
import type { SelectableContainer } from './containerSelection'

interface StartShipmentModalProps {
  containers: SelectableContainer[]
  onClose(): void
  onShipped(movement: ShippedMovementDto): void
}

const DEFAULT_TYPE_CODE = 'SEA'
const DRAFT = 1
const MOVEMENT_IN_PROGRESS = 2
const REFS_SHOWN = 2

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
 * "Start shipment…" for the ticked containers: ONE movement for all of them, in one call — the drafts
 * confirmed, the movement created and started (or only planned), the vessel, voyage, B/L and ETA
 * copied to the containers.
 *
 * FROM / TO MAY STAY EMPTY for a sea leg: the server takes the containers' common port of loading and
 * of destination, shown here as the hint. When the containers disagree (or have none), or the leg is
 * not sea freight, the places are required. The warnings above the form say in advance what the
 * server would refuse — a container already travelling — or accept with a note: drafts, containers
 * without a number. A refusal is shown in the dialog as it comes (CONTAINER_BUSY names the container).
 */
export function StartShipmentModal({ containers, onClose, onShipped }: StartShipmentModalProps) {
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
  const from = common(containers.map((c) => c.portOfLoadingName))
  const to = common(containers.map((c) => c.portOfDestinationName))
  const placesByDefault = seaLeg && from !== null && to !== null
  const drafts = containers.filter((c) => c.status === DRAFT)
  const withoutNumber = containers.filter((c) => !c.containerNo)
  const travelling = containers.filter((c) => c.currentMovementStatus === MOVEMENT_IN_PROGRESS)

  async function save() {
    if (!typeId) {
      setError('Choose the movement type.')
      return
    }
    if (!placesByDefault && (!fromId || !toId)) {
      setPlaceError(seaLeg ? "The containers' ports differ or are missing: choose where from and where to." : 'Choose where from and where to.')
      return
    }
    setPlaceError(null)
    setSaving(true)
    setError(null)
    try {
      const movement = await movementsApi.shipContainers({
        containerIds: containers.map((c) => c.id),
        movementTypeId: Number(typeId),
        fromPlaceId: fromId ? Number(fromId) : null,
        toPlaceId: toId ? Number(toId) : null,
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
            <Anchor component="button" type="button" fz="sm" fw={600} onClick={() => void navigate(`/logistics/movements/${movement.id}`)}>
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

  const portOptions = ports.map((p) => ({ value: String(p.id), label: portLabel(p) }))
  const routeHint = placesByDefault ? `From and To empty = the containers' ports: ${from} → ${to}` : null

  return (
    <FormModal
      opened
      title="Start shipment"
      onSubmit={() => void save()}
      onClose={onClose}
      saving={saving}
      saveLabel={startNow === 'start' ? 'Start shipment' : 'Plan movement'}
      size="xl"
    >
      <Stack gap="sm">
        <Text fw={600} data-ship-containers>
          {formatNumber(containers.length)} container{containers.length === 1 ? '' : 's'}: {refList(containers)}
        </Text>
        {drafts.length > 0 ? (
          <Alert color={canConfirm ? 'blue' : 'orange'} py={6}>
            {formatNumber(drafts.length)} {drafts.length === 1 ? 'is a draft' : 'are drafts'}
            {canConfirm ? ': they will be confirmed.' : ': confirm them first (you do not have containers.confirm).'}
          </Alert>
        ) : null}
        {withoutNumber.length > 0 ? (
          <Alert color="yellow" py={6}>
            No container number yet: {withoutNumber.map((c) => c.containerRef).join(', ')}. The shipment can start without it.
          </Alert>
        ) : null}
        {travelling.length > 0 ? (
          <Alert color="red" py={6} data-ship-busy>
            Already travelling:{' '}
            {travelling.map((c) => `${c.containerRef}${c.currentMovementNo ? ` (${c.currentMovementNo})` : ''}`).join(', ')}. The shipment will be
            refused while {travelling.length === 1 ? 'it is' : 'they are'} selected.
          </Alert>
        ) : null}

        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          <Select
            label="Movement type"
            withAsterisk
            data={types.map((t) => ({ value: String(t.id), label: `${t.typeCode} - ${t.typeName}` }))}
            value={typeId}
            onChange={setTypeId}
            searchable
            // The dialog opens with the cursor here: an open list over the form would take the next click.
            openOnFocus={false}
            allowDeselect={false}
          />
          <Select
            label="From"
            withAsterisk={!placesByDefault}
            placeholder={placesByDefault ? (from ?? undefined) : 'Choose the place'}
            data={portOptions}
            value={fromId}
            onChange={(next) => {
              setFromId(next)
              setPlaceError(null)
            }}
            searchable
            clearable
            error={placeError && !fromId ? placeError : undefined}
          />
          <Select
            label="To"
            withAsterisk={!placesByDefault}
            placeholder={placesByDefault ? (to ?? undefined) : 'Choose the place'}
            data={portOptions}
            value={toId}
            onChange={(next) => {
              setToId(next)
              setPlaceError(null)
            }}
            searchable
            clearable
            error={placeError && !toId ? ' ' : undefined}
          />
          <DateInput
            label={startNow === 'start' ? 'Start date' : 'Planned date'}
            valueFormat="DD/MM/YYYY"
            value={fromIsoDate(startDate)}
            onChange={(next) => setStartDate(next ? isoDate(new Date(next)) : null)}
          />
          <DateInput label="ETA" valueFormat="DD/MM/YYYY" clearable value={fromIsoDate(eta)} onChange={(next) => setEta(next ? isoDate(new Date(next)) : null)} />
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
          <DateInput label="B/L date" valueFormat="DD/MM/YYYY" clearable value={fromIsoDate(blDate)} onChange={(next) => setBlDate(next ? isoDate(new Date(next)) : null)} />
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
