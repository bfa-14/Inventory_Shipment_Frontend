import { Checkbox, Group, Radio, Select, SimpleGrid, Stack, Textarea, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import type { MovementTypeLookupDto } from '../../api/masterdata/movementTypes'
import { portLabel, type PortLookupDto } from '../../api/masterdata/ports'
import { loadCarriers } from '../purchase/documentSearch'
import { SearchSelect } from '../ui/SearchSelect'
import { ORIGIN, SEA, typeOptionGroups, type LegValues } from './nextLeg'
import { FROM_LOCKED_HINT, isStay, placeOptionGroups } from './shipStep'

interface NextLegFieldsProps {
  values: LegValues
  onChange(patch: Partial<LegValues>): void
  /** The type changed: the host proposes the To again (`retypeLeg`). */
  onTypeChange(typeId: string | null): void
  types: MovementTypeLookupDto[]
  ports: PortLookupDto[]
  /** Where the containers are: the From of the leg (locked), the To of a stay. Null = they have no place (any From). */
  place: { id: number; name: string } | null
  /** Never moved: Loading at the supplier may be chosen (its From is free, its To is the port of loading). */
  neverMoved: boolean
  /** "Suggested: the usual next leg from Dar es Salaam (5 earlier legs)", shown under the type. */
  typeHint?: string | null
  /** The date's refusal (`legDateProblem`), on the field. */
  dateProblem?: string | null
  /** The To / From missing, once the reader tried to save. */
  placeProblem?: string | null
  /** The bulk dialog's groups take the shared date at its top: no date or Start now / Plan only here. */
  withDate?: boolean
  /** "the container" (one) or "the containers" (a group): the copy checkbox's words. */
  containersWord?: string
  /** A draft the reader may not confirm can only be planned: "Start now" is off. */
  startDisabled?: boolean
}

/**
 * THE FIELDS OF A NEW LEG (script 81): the Next step dialog of one container and a group's "Edit…" in the bulk dialog.
 * The From is where the containers are, read-only ("A container leaves from where it is."); Loading at the supplier is
 * the exception (its To is the port of loading, its From is free). A stay - Port, Customs, Border - happens there: no To
 * to pick, "at Kasumbalesa". Places are grouped Sea ports / Border posts / Inland places. The sea details (voyage, B/L)
 * only for a sea leg.
 */
export function NextLegFields({
  values,
  onChange,
  onTypeChange,
  types,
  ports,
  place,
  neverMoved,
  typeHint,
  dateProblem,
  placeProblem,
  withDate = true,
  containersWord = 'the container',
  startDisabled = false,
}: NextLegFieldsProps) {
  const type = types.find((t) => String(t.id) === values.typeId) ?? null
  const stay = isStay(type?.stage)
  const origin = type?.stage === ORIGIN
  const sea = type?.stage === SEA
  const placeId = place ? String(place.id) : null
  const portOptions = placeOptionGroups(ports, [values.fromId, values.toId, placeId])
  const portName = (value: string | null) => {
    const port = ports.find((p) => String(p.id) === value)
    return port ? `${port.portCode} - ${portLabel(port)}` : null
  }
  const placeName = portName(placeId) ?? place?.name ?? ''
  const fromLocked = !origin && place !== null

  return (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
        <Select
          label="Movement type"
          withAsterisk
          data={typeOptionGroups(types, neverMoved)}
          value={values.typeId}
          onChange={onTypeChange}
          searchable
          // The dialog opens with the cursor here: an open list over the form would take the next click.
          openOnFocus={false}
          allowDeselect={false}
          description={typeHint ?? undefined}
          inputWrapperOrder={['label', 'input', 'description', 'error']}
          data-next-leg-type
        />
        {fromLocked ? (
          <TextInput label="From" value={placeName} readOnly description={FROM_LOCKED_HINT} inputWrapperOrder={['label', 'input', 'description']} data-next-leg-from />
        ) : (
          <Select
            label="From"
            withAsterisk
            placeholder="Choose the place"
            data={portOptions}
            value={values.fromId}
            onChange={(next) => onChange({ fromId: next })}
            searchable
            clearable
            error={placeProblem && !values.fromId ? placeProblem : undefined}
          />
        )}
        {stay ? (
          <TextInput label="To" value={`at ${place?.name ?? placeName}`} readOnly description="A stay happens where the container is." inputWrapperOrder={['label', 'input', 'description']} data-next-leg-to-stay />
        ) : origin && place ? (
          <TextInput label="To" value={placeName} readOnly description="Loading at the supplier ends at the port of loading." inputWrapperOrder={['label', 'input', 'description']} />
        ) : (
          <Select
            label="To"
            withAsterisk
            placeholder="Choose the place"
            data={portOptions}
            value={values.toId}
            onChange={(next) => onChange({ toId: next })}
            searchable
            clearable
            error={placeProblem && !values.toId ? placeProblem : undefined}
            data-next-leg-to
          />
        )}
        {withDate ? (
          <DateInput
            label={values.startMode === 'start' ? 'Start date' : 'Planned date'}
            withAsterisk
            valueFormat="DD/MM/YYYY"
            value={values.date}
            // No maxDate / minDate: a typed date outside them would be dropped silently; the error says why instead.
            onChange={(next) => onChange({ date: next ? String(next).slice(0, 10) : null })}
            error={dateProblem ?? undefined}
          />
        ) : null}
        <DateInput label="ETA" valueFormat="DD/MM/YYYY" clearable value={values.eta} onChange={(next) => onChange({ eta: next ? String(next).slice(0, 10) : null })} />
        <SearchSelect
          label="Carrier"
          placeholder="Shipping line, trucker..."
          load={loadCarriers}
          value={values.carrierId}
          onChange={(next) => onChange({ carrierId: next })}
          clearable
          nothingFoundMessage="No party matches"
        />
        <TextInput label="Vehicle / vessel" maxLength={100} value={values.vessel} onChange={(e) => onChange({ vessel: e.currentTarget.value })} />
        <TextInput label="Reference" placeholder="Booking, waybill, declaration" maxLength={50} value={values.reference} onChange={(e) => onChange({ reference: e.currentTarget.value })} />
        {sea ? (
          <>
            <TextInput label="Voyage" maxLength={30} value={values.voyage} onChange={(e) => onChange({ voyage: e.currentTarget.value })} />
            <TextInput label="B/L No." maxLength={30} value={values.blNo} onChange={(e) => onChange({ blNo: e.currentTarget.value })} />
            <DateInput label="B/L date" valueFormat="DD/MM/YYYY" clearable value={values.blDate} onChange={(next) => onChange({ blDate: next ? String(next).slice(0, 10) : null })} />
          </>
        ) : null}
      </SimpleGrid>
      <Textarea label="Notes" autosize minRows={2} maxLength={1000} value={values.notes} onChange={(e) => onChange({ notes: e.currentTarget.value })} />
      <Group gap="xl" wrap="wrap">
        {withDate ? (
          <Radio.Group value={values.startMode} onChange={(next) => onChange({ startMode: next as LegValues['startMode'] })}>
            <Group gap="md">
              <Radio value="start" label="Start now" disabled={startDisabled} />
              <Radio value="plan" label="Plan only" />
            </Group>
          </Radio.Group>
        ) : null}
        {sea ? (
          <Checkbox
            label={`Copy vessel, voyage, B/L and ETA to ${containersWord}`}
            checked={values.copyToContainers}
            onChange={(e) => onChange({ copyToContainers: e.currentTarget.checked })}
          />
        ) : null}
      </Group>
    </Stack>
  )
}
