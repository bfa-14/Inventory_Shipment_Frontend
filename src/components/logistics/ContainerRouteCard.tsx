import { useState, type ReactNode } from 'react'
import { Alert, Button, Group, Modal, Paper, Select, Stack, Text, Textarea, TextInput, Timeline, Title } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconAnchor, IconFlag, IconMapPin, IconNote, IconPlus, IconShip, IconShieldCheck, IconTruckDelivery } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  CONTAINER_EVENT_TYPES,
  eventTypeLabel,
  type AddEventRequest,
  type ContainerEventDto,
  type ContainerEventType,
} from '../../api/logistics/containers'
import { portLabel, type PortLookupDto } from '../../api/masterdata/ports'
import { dateLabel, isoDate, stamp } from '../documents/documentKind'

const EVENT_ICONS: Record<string, ReactNode> = {
  Booked: <IconFlag size={14} />,
  Dispatched: <IconShip size={14} />,
  PortArrival: <IconAnchor size={14} />,
  CustomsRelease: <IconShieldCheck size={14} />,
  BorderCrossing: <IconMapPin size={14} />,
  Offloaded: <IconTruckDelivery size={14} />,
  Note: <IconNote size={14} />,
}

interface ContainerRouteCardProps {
  events: ContainerEventDto[]
  canAdd: boolean
  onAdd: () => void
}

/** The route, newest first: each event moved the dates, the status and the current location. */
export function ContainerRouteCard({ events, canAdd, onAdd }: ContainerRouteCardProps) {
  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={5}>Route</Title>
        {canAdd ? (
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={onAdd}>
            Add event
          </Button>
        ) : null}
      </Group>
      {events.length === 0 ? (
        <Text c="dimmed" fz="sm">
          No event yet. The route starts once the container is confirmed and dispatched.
        </Text>
      ) : (
        <Timeline active={0} bulletSize={24} lineWidth={2}>
          {events.map((event) => (
            <Timeline.Item key={event.id} bullet={EVENT_ICONS[event.eventType] ?? <IconNote size={14} />} title={eventTypeLabel(event.eventType)}>
              <Text fz="sm">
                {dateLabel(event.eventDate)}
                {event.portName || event.locationText ? ` - ${event.portName ?? event.locationText}` : ''}
              </Text>
              {event.notes ? (
                <Text fz="xs" c="dimmed">
                  {event.notes}
                </Text>
              ) : null}
              <Text fz="xs" c="dimmed">
                {event.createdByName ?? 'System'} · {stamp(event.createdAtUtc)}
              </Text>
            </Timeline.Item>
          ))}
        </Timeline>
      )}
    </Paper>
  )
}

interface AddEventModalProps {
  opened: boolean
  onClose: () => void
  ports: PortLookupDto[]
  /** Only a note before the container is confirmed; the server refuses the rest. */
  notesOnly: boolean
  onSubmit: (request: AddEventRequest) => Promise<void>
}

/** A route event: a port of the master data, or a free-text place when it is not one. */
export function AddEventModal({ opened, onClose, ports, notesOnly, onSubmit }: AddEventModalProps) {
  const [eventType, setEventType] = useState<ContainerEventType>(notesOnly ? 'Note' : 'Dispatched')
  const [eventDate, setEventDate] = useState<string | null>(isoDate(new Date()))
  const [portId, setPortId] = useState<string | null>(null)
  const [locationText, setLocationText] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!eventDate) {
      setError('The date is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        eventType,
        eventDate,
        portId: portId === null ? null : Number(portId),
        locationText: portId === null && locationText.trim() ? locationText.trim() : null,
        notes: notes.trim() || null,
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The event could not be added.')
    } finally {
      setBusy(false)
    }
  }

  const options = CONTAINER_EVENT_TYPES.filter((t) => !notesOnly || t.value === 'Note')

  return (
    <Modal opened={opened} onClose={onClose} title="Add route event" centered>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Stack>
          <Select label="Event" withAsterisk data={options} value={eventType} allowDeselect={false} onChange={(v) => setEventType((v as ContainerEventType) ?? 'Note')} data-autofocus />
          <DateInput label="Date" withAsterisk valueFormat="DD/MM/YYYY" value={eventDate} onChange={(v) => setEventDate(v ? String(v).slice(0, 10) : null)} />
          <Select
            label="Port / place"
            placeholder="Pick a port"
            data={ports.map((p) => ({ value: String(p.id), label: `${portLabel(p)} - ${p.kind}` }))}
            value={portId}
            onChange={setPortId}
            searchable
            clearable
          />
          {portId === null ? (
            <TextInput label="Or another place" placeholder="Customs yard, border post..." maxLength={100} value={locationText} onChange={(e) => setLocationText(e.currentTarget.value)} />
          ) : null}
          <Textarea label="Notes" autosize minRows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          {error ? <Alert color="red">{error}</Alert> : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Add event
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
