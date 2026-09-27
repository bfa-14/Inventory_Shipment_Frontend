import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Center,
  CloseButton,
  Grid,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
  useMatches,
} from '@mantine/core'
import { IconAlertTriangle, IconArrowRight, IconCalendarDue, IconMapPin, IconRefresh, IconSearch } from '@tabler/icons-react'
import dayjs from 'dayjs'
import { Link } from 'react-router'
import { ApiError } from '../../api/http'
import { containersApi, containerStatusColour, type TrackingContainerDto, type TrackingDto, type TrackingLegDto } from '../../api/logistics/containers'
import { formatNumber } from '../../components/format'
import { RouteMap } from '../../components/logistics/RouteMap'
import { PageHeader } from '../../components/ui/PageHeader'
import { CONTAINERS_ROUTE } from './ContainersPage'

export const TRACKING_ROUTE = '/logistics/tracking'

const REFRESH_MS = 60_000
const SEARCH_DEBOUNCE_MS = 350
const NO_LEGS: TrackingLegDto[] = []

type Mode = 'selected' | 'all'

function day(value: string | null): string {
  return value ? dayjs(value).format('D MMM YYYY') : '-'
}

/** Free time at the port is over: the last free day has passed and the box is still at the port or just cleared. */
function freeTimeOver(container: TrackingContainerDto): boolean {
  return (container.status === 4 || container.status === 5) && !!container.lastFreeDay && dayjs(container.lastFreeDay).isBefore(dayjs(), 'day')
}

function FreeTimeBadge() {
  return (
    <Badge color="red" variant="filled" size="sm" leftSection={<IconAlertTriangle size={11} />}>
      Free time over
    </Badge>
  )
}

function StatusBadge({ container }: { container: TrackingContainerDto }) {
  return (
    <Badge color={containerStatusColour(container.status)} variant="light" size="sm">
      {container.statusName}
    </Badge>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={0}>
      <Text fz="xs" c="dimmed">
        {label}
      </Text>
      <Text fz="sm" fw={500}>
        {children}
      </Text>
    </Stack>
  )
}

function ContainerTitle({ container, order }: { container: TrackingContainerDto; order: 4 | 5 }) {
  return (
    <Group gap="xs" wrap="wrap">
      <Anchor component={Link} to={`${CONTAINERS_ROUTE}/${container.id}`} fw={700} fz={order === 4 ? 'lg' : 'md'}>
        {container.containerRef}
      </Anchor>
      {container.containerNo ? (
        <Text c="dimmed" fz="sm">
          {container.containerNo}
        </Text>
      ) : null}
      <StatusBadge container={container} />
      {freeTimeOver(container) ? <FreeTimeBadge /> : null}
    </Group>
  )
}

function ListItem({ container, selected, onSelect }: { container: TrackingContainerDto; selected: boolean; onSelect: () => void }) {
  return (
    <UnstyledButton
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      p="xs"
      style={{
        display: 'block',
        width: '100%',
        borderRadius: 'var(--mantine-radius-md)',
        border: `1px solid ${selected ? 'var(--mantine-color-brand-4)' : 'var(--mantine-color-gray-3)'}`,
        background: selected ? 'var(--mantine-color-brand-0)' : 'var(--mantine-color-white)',
      }}
    >
      <Group justify="space-between" gap={6} wrap="nowrap" align="flex-start">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text fw={600} fz="sm" truncate>
            {container.containerRef}
          </Text>
          <Text fz="xs" c="dimmed" truncate>
            {container.containerNo ?? 'No container no. yet'}
          </Text>
        </Stack>
        <StatusBadge container={container} />
      </Group>
      <Group gap={4} mt={6} wrap="nowrap">
        <IconMapPin size={13} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
        <Text fz="xs" truncate>
          {container.currentLocation ?? '-'}
        </Text>
      </Group>
      <Group justify="space-between" gap={4} mt={2} wrap="wrap">
        <Group gap={4} wrap="nowrap">
          <IconCalendarDue size={13} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
          <Text fz="xs">ETA {day(container.eta)}</Text>
        </Group>
        {freeTimeOver(container) ? <FreeTimeBadge /> : null}
      </Group>
    </UnstyledButton>
  )
}

function FactsPanel({ container }: { container: TrackingContainerDto }) {
  const ports = [container.portOfLoadingName, container.portOfDestinationName].filter(Boolean).join(' → ') || '-'
  return (
    <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md" verticalSpacing="sm">
      <Fact label="Items">{container.itemSummary ?? '-'}</Fact>
      <Fact label="Quantity (base units)">{formatNumber(container.totalAllocatedBase)}</Fact>
      {container.totalOilQty > 0 ? <Fact label="Oil quantity">{formatNumber(container.totalOilQty, 2)}</Fact> : null}
      <Fact label="Supplier">{container.supplierName ?? '-'}</Fact>
      <Fact label="Ports">{ports}</Fact>
      <Fact label="Final destination">{container.finalDestinationName ?? '-'}</Fact>
      <Fact label="Warehouse">{container.warehouseName ?? '-'}</Fact>
      <Fact label="Dispatched">{day(container.dispatchDate)}</Fact>
      <Fact label="ETA">{day(container.eta)}</Fact>
      <Fact label="Port arrival">{day(container.actualPortArrival)}</Fact>
      <Fact label="Customs release">{day(container.customsReleaseDate)}</Fact>
      <Fact label="Offloaded">{day(container.offloadedDate)}</Fact>
      <Fact label="Last free day">
        <Text span inherit c={freeTimeOver(container) ? 'red' : undefined}>
          {day(container.lastFreeDay)}
        </Text>
      </Fact>
      {container.daysAtPort !== null ? <Fact label="Days at port">{formatNumber(container.daysAtPort)}</Fact> : null}
    </SimpleGrid>
  )
}

export function TrackingPage() {
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [data, setData] = useState<TrackingDto | null>(null)
  /** The request (search + refresh tick) whose answer is on screen; any other key means one is on its way. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>('selected')
  const listHeight = useMatches({ base: 320, md: 'calc(100dvh - 300px)' })

  // A typed search applies 350 ms after the last keystroke (Enter and clearing apply at once).
  useEffect(() => {
    const next = search.trim()
    if (next === applied) return
    const timer = setTimeout(() => setApplied(next), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, applied])

  // Refresh every minute; the selection is kept because it is an id, not a row.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const requestKey = `${tick}|${applied}`
  const loading = loadedKey !== requestKey

  useEffect(() => {
    const controller = new AbortController()
    const key = `${tick}|${applied}`
    containersApi
      .tracking({ search: applied || undefined }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
        setError(null)
        setUpdatedAt(new Date())
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof ApiError ? err.message : 'The tracking could not be loaded.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedKey(key)
      })
    return () => controller.abort()
  }, [applied, tick])

  const containers = useMemo(() => data?.containers ?? [], [data])
  const legsByContainer = useMemo(() => {
    const map = new Map<number, TrackingLegDto[]>()
    for (const leg of data?.legs ?? []) {
      const list = map.get(leg.containerId)
      if (list) list.push(leg)
      else map.set(leg.containerId, [leg])
    }
    return map
  }, [data])

  const selected = containers.find((c) => c.id === selectedId) ?? containers[0] ?? null

  const select = (id: number) => {
    setSelectedId(id)
    if (mode === 'all') document.getElementById(`tracking-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const applyNow = (value: string) => {
    setSearch(value)
    setApplied(value.trim())
  }

  return (
    <>
      <PageHeader
        title="Container tracking"
        subtitle="Where every container is on its way to the warehouse."
        breadcrumbs={[{ label: 'Logistics' }, { label: 'Tracking' }]}
        actions={
          <>
            {updatedAt ? (
              <Text fz="xs" c="dimmed">
                Updated {dayjs(updatedAt).format('HH:mm')}
              </Text>
            ) : null}
            <Tooltip label="Refresh now">
              <ActionIcon variant="default" size="lg" aria-label="Refresh" onClick={() => setTick((t) => t + 1)} loading={loading && data !== null}>
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
            <SegmentedControl
              value={mode}
              onChange={(value) => setMode(value as Mode)}
              data={[
                { value: 'selected', label: 'Selected' },
                { value: 'all', label: 'All' },
              ]}
            />
          </>
        }
      />

      {error ? (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      ) : null}

      <Grid gap="md">
        <Grid.Col span={{ base: 12, md: 4, xl: 3 }}>
          <Paper radius="lg" p="sm" withBorder>
            <TextInput
              placeholder="Search ref, container no., item, supplier..."
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value === '') applyNow('')
                else setSearch(value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyNow(search)
              }}
              rightSection={search ? <CloseButton size="sm" aria-label="Clear search" onClick={() => applyNow('')} /> : null}
              mb="sm"
            />
            <ScrollArea.Autosize mah={listHeight} type="auto" offsetScrollbars="y">
              {loading && data === null ? (
                <Center py="xl">
                  <Loader size="sm" />
                </Center>
              ) : containers.length === 0 ? (
                <Text c="dimmed" fz="sm" ta="center" py="lg">
                  {applied ? 'No container matches the search.' : 'No container is on its way.'}
                </Text>
              ) : (
                <Stack gap={6}>
                  {containers.map((container) => (
                    <ListItem key={container.id} container={container} selected={selected?.id === container.id} onSelect={() => select(container.id)} />
                  ))}
                </Stack>
              )}
            </ScrollArea.Autosize>
            {containers.length > 0 ? (
              <Text fz="xs" c="dimmed" mt="xs">
                {formatNumber(containers.length)} container{containers.length === 1 ? '' : 's'}
              </Text>
            ) : null}
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8, xl: 9 }}>
          {mode === 'selected' ? (
            selected ? (
              <Stack gap="md">
                <Paper radius="lg" p="md" withBorder>
                  <Group justify="space-between" align="flex-start" mb="sm" gap="xs">
                    <ContainerTitle container={selected} order={4} />
                    <Anchor component={Link} to={`${CONTAINERS_ROUTE}/${selected.id}`} fz="sm">
                      <Group gap={4} wrap="nowrap">
                        Open container <IconArrowRight size={14} />
                      </Group>
                    </Anchor>
                  </Group>
                  {selected.currentLocation ? (
                    <Group gap={4} mb="sm">
                      <IconMapPin size={14} color="var(--mantine-color-dimmed)" />
                      <Text fz="sm" c="dimmed">
                        {selected.currentLocation}
                      </Text>
                    </Group>
                  ) : null}
                  <RouteMap container={selected} legs={legsByContainer.get(selected.id) ?? NO_LEGS} />
                </Paper>
                <Paper radius="lg" p="md" withBorder>
                  <Title order={5} mb="sm">
                    Facts
                  </Title>
                  <FactsPanel container={selected} />
                </Paper>
              </Stack>
            ) : loading ? null : (
              <Paper radius="lg" p="xl" withBorder>
                <Text c="dimmed" ta="center">
                  Pick a container to see its route.
                </Text>
              </Paper>
            )
          ) : (
            <Stack gap="md">
              {containers.map((container) => (
                <Paper
                  key={container.id}
                  id={`tracking-${container.id}`}
                  radius="lg"
                  p="md"
                  withBorder
                  style={selected?.id === container.id ? { borderColor: 'var(--mantine-color-brand-4)' } : undefined}
                >
                  <Group justify="space-between" mb="xs" gap="xs">
                    <ContainerTitle container={container} order={5} />
                    {container.currentLocation ? (
                      <Text fz="xs" c="dimmed">
                        {container.currentLocation} · ETA {day(container.eta)}
                      </Text>
                    ) : null}
                  </Group>
                  <RouteMap container={container} legs={legsByContainer.get(container.id) ?? NO_LEGS} compact />
                </Paper>
              ))}
            </Stack>
          )}
        </Grid.Col>
      </Grid>
    </>
  )
}
