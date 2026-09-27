import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, Anchor, Badge, Button, Group, Loader, Modal, Paper, ScrollArea, Stack, Table, Text, Timeline, Title } from '@mantine/core'
import { IconArrowRight, IconPlus, IconRoute } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import type { ContainerDto, ContainerMovementDto } from '../../api/logistics/containers'
import { movementsApi, movementStatusColour, type MovementListDto } from '../../api/logistics/movements'
import { dateLabel } from '../documents/documentKind'
import { formatMoney, formatNumber, todayDateOnly } from '../format'
import { notify } from '../ui/notify'
import { StageIcon, stageColour } from './movementStage'

const MOVEMENTS_ROUTE = '/logistics/movements'

const STATUS_NAMES: Record<number, string> = { 1: 'Planned', 2: 'In Progress', 3: 'Completed', 4: 'Cancelled' }

interface ContainerRouteTimelineProps {
  container: ContainerDto
  canManage: boolean
  /** Re-reads the container after it joined a movement. */
  onChanged: () => void
}

/**
 * The container's route, leg by leg, oldest first: what kind of leg, from where to where, when, with
 * whom, and what it cost. A leg whose ETA has passed while it is still planned or running shows the
 * ETA in red - that is the leg to chase.
 */
export function ContainerRouteTimeline({ container, canManage, onChanged }: ContainerRouteTimelineProps) {
  const navigate = useNavigate()
  const [pickOpen, setPickOpen] = useState(false)
  const legs = container.movements
  // The line is drawn up to the last completed leg; a running leg is the active bullet.
  const active = legs.reduce((last, leg, index) => (leg.status === 2 || leg.status === 3 ? index : last), -1)
  // A container that has arrived, or never set off, cannot join a leg.
  const canJoin = canManage && container.status >= 1 && container.status <= 5

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
        <Title order={5}>Route</Title>
        {canJoin ? (
          <Group gap="xs">
            <Button size="xs" variant="default" leftSection={<IconRoute size={14} />} onClick={() => setPickOpen(true)}>
              Add to a movement...
            </Button>
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => void navigate(`${MOVEMENTS_ROUTE}/new?containerId=${container.id}`)}>
              New movement for this container
            </Button>
          </Group>
        ) : null}
      </Group>

      {legs.length === 0 ? (
        <Text c="dimmed" fz="sm" ta="center" py="sm">
          No movement yet
        </Text>
      ) : (
        <Timeline active={active} bulletSize={28} lineWidth={2}>
          {legs.map((leg) => (
            <Timeline.Item
              key={leg.movementId}
              color={stageColour(leg.stage)}
              lineVariant={leg.status === 1 ? 'dashed' : 'solid'}
              bullet={<StageIcon stage={leg.stage} size={16} color="currentColor" />}
              title={<LegTitle leg={leg} />}
            >
              <LegBody leg={leg} />
            </Timeline.Item>
          ))}
        </Timeline>
      )}

      {pickOpen ? (
        <AddToMovementModal
          container={container}
          onClose={() => setPickOpen(false)}
          onAdded={() => {
            setPickOpen(false)
            onChanged()
          }}
        />
      ) : null}
    </Paper>
  )
}

function LegTitle({ leg }: { leg: ContainerMovementDto }) {
  return (
    <Group gap="xs" wrap="wrap">
      <Text fz="sm" fw={600}>
        {leg.typeName}
      </Text>
      <Badge size="sm" variant="light" color={movementStatusColour(leg.status)}>
        {STATUS_NAMES[leg.status] ?? leg.status}
      </Badge>
      <Anchor component={Link} to={`${MOVEMENTS_ROUTE}/${leg.movementId}`} fz="xs">
        {leg.movementNo}
      </Anchor>
    </Group>
  )
}

function LegBody({ leg }: { leg: ContainerMovementDto }) {
  const late = (leg.status === 1 || leg.status === 2) && leg.eta !== null && leg.eta.slice(0, 10) < todayDateOnly()
  const carrier = [leg.carrierName, leg.vehicleOrVessel, leg.voyageNo].filter(Boolean).join(' · ')

  return (
    <Stack gap={2} mt={2}>
      <Group gap={4} wrap="wrap">
        <Text fz="sm">{leg.fromName}</Text>
        {leg.toPlaceId === leg.fromPlaceId ? null : (
          <>
            <IconArrowRight size={14} color="var(--mantine-color-dimmed)" />
            <Text fz="sm">{leg.toName}</Text>
          </>
        )}
      </Group>
      <Group gap="md" wrap="wrap">
        <DateBit label="Planned" value={leg.plannedDate} />
        <DateBit label="Start" value={leg.startDate} />
        <DateBit label="ETA" value={leg.eta} colour={late ? 'red' : undefined} />
        <DateBit label="End" value={leg.endDate} />
      </Group>
      {carrier ? (
        <Text fz="xs" c="dimmed">
          {carrier}
        </Text>
      ) : null}
      <Text fz="xs" c="dimmed">
        {leg.chargesBase ? `Charges ${formatMoney(leg.chargesBase, 'USD')}` : 'No charges'} · {formatNumber(leg.attachmentCount)}{' '}
        {leg.attachmentCount === 1 ? 'document' : 'documents'}
        {leg.containerCount > 1 ? ` · with ${formatNumber(leg.containerCount - 1)} other ${leg.containerCount === 2 ? 'container' : 'containers'}` : ''}
      </Text>
    </Stack>
  )
}

function DateBit({ label, value, colour }: { label: string; value: string | null; colour?: string }) {
  if (!value) return null
  return (
    <Text fz="xs" c={colour ?? 'dimmed'} fw={colour ? 700 : undefined}>
      {label} {dateLabel(value)}
    </Text>
  )
}

/** The planned movements this container can still join; picking one adds it and leaves the rest alone. */
function AddToMovementModal({ container, onClose, onAdded }: { container: ContainerDto; onClose: () => void; onAdded: () => void }) {
  const [rows, setRows] = useState<MovementListDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    movementsApi
      .list({ status: 1, pageSize: 50, sortBy: 'MovementNo', sortDir: 'desc' }, controller.signal)
      .then((result) => {
        const already = new Set(container.movements.map((m) => m.movementId))
        setRows(result.items.filter((m) => !already.has(m.id)))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof ApiError ? err.message : 'The planned movements could not be loaded.')
      })
    return () => controller.abort()
  }, [container.movements])

  async function add(row: MovementListDto) {
    setBusyId(row.id)
    try {
      // Re-read, so the save carries the movement's current fields and row version, not the list's.
      const movement = await movementsApi.get(row.id)
      await movementsApi.update(movement.id, {
        movementTypeId: movement.movementTypeId,
        fromPlaceId: movement.fromPlaceId,
        toPlaceId: movement.toPlaceId,
        plannedDate: movement.plannedDate,
        startDate: movement.startDate,
        eta: movement.eta,
        carrierPartyId: movement.carrierPartyId,
        vehicleOrVessel: movement.vehicleOrVessel,
        voyageNo: movement.voyageNo,
        reference: movement.reference,
        notes: movement.notes,
        containerIds: [...new Set([...movement.containers.map((c) => c.containerId), container.id])],
        rowVersion: movement.rowVersion,
      })
      notify.success(`${container.containerRef} added to ${movement.movementNo}.`)
      onAdded()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The container could not be added to the movement.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal opened onClose={onClose} title={`Add ${container.containerRef} to a movement`} size="xl">
      {error ? (
        <Alert color="red">{error}</Alert>
      ) : rows === null ? (
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      ) : rows.length === 0 ? (
        <Text c="dimmed" fz="sm" ta="center" py="md">
          No planned movement to join. Create a new movement for this container instead.
        </Text>
      ) : (
        <ScrollArea type="auto" mah={420}>
          <Table miw={640} verticalSpacing={6} highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Movement</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>From → To</Table.Th>
                <Table.Th>Planned</Table.Th>
                <Table.Th>Containers</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <Text fz="sm" fw={600}>
                      {row.movementNo}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <StageIcon stage={row.stage} />
                      <Text fz="sm">{row.typeName}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm">{row.toPlaceId === row.fromPlaceId ? row.fromCode : `${row.fromCode} → ${row.toCode}`}</Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{dateLabel(row.plannedDate)}</Table.Td>
                  <Table.Td>
                    <Text fz="sm">{row.containerRefs ?? '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Button size="xs" onClick={() => void add(row)} loading={busyId === row.id} disabled={busyId !== null && busyId !== row.id}>
                      Add
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Modal>
  )
}
