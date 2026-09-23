import { Alert, Badge, Group, NumberInput, Paper, Progress, Stack, Text, Title } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { formatNumber } from '../format'
import type { Capacity } from './containerForm'

interface ContainerCapacityCardProps {
  typeLabel: string | null
  capacity: Capacity
  maxUnits: number | ''
  onMaxUnitsChange: (value: number | '') => void
  /** The type's own capacity, offered back when the reader changed it. */
  typeMaxUnits: number | null
  readOnly: boolean
  totalOil: number
}

/**
 * How full the container is, in units. OVER CAPACITY IS ORANGE, NOT RED, and never a block: the
 * customer sometimes squeezes a few more in, so the save asks for a confirmation instead.
 */
export function ContainerCapacityCard({
  typeLabel,
  capacity,
  maxUnits,
  onMaxUnitsChange,
  typeMaxUnits,
  readOnly,
  totalOil,
}: ContainerCapacityCardProps) {
  const pct = capacity.utilization
  const colour = capacity.over ? 'orange' : pct !== null && pct >= 90 ? 'teal' : 'blue'

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={5}>Capacity</Title>
        {capacity.over ? (
          <Badge color="orange" variant="filled" leftSection={<IconAlertTriangle size={12} />}>
            Over capacity
          </Badge>
        ) : null}
      </Group>

      <Stack gap="xs">
        <Row label="Container type" value={typeLabel ?? '—'} />
        {readOnly ? (
          <Row label="Max units" value={formatNumber(capacity.maxUnits)} />
        ) : (
          <NumberInput
            label="Max units"
            description={
              typeMaxUnits !== null && maxUnits !== typeMaxUnits ? `The type holds ${formatNumber(typeMaxUnits)}` : undefined
            }
            min={1}
            allowDecimal={false}
            thousandSeparator=","
            value={maxUnits}
            onChange={(value) => onMaxUnitsChange(value === '' ? '' : Number(value))}
          />
        )}
        <Row label="Allocated (base units)" value={formatNumber(capacity.allocated)} />
        <Row
          label="Remaining"
          value={capacity.remaining === null ? '—' : formatNumber(capacity.remaining)}
          colour={capacity.over ? 'orange' : undefined}
        />
        <div>
          <Group justify="space-between" mb={4}>
            <Text fz="sm" c="dimmed">
              Utilization
            </Text>
            <Text fz="sm" fw={700} c={capacity.over ? 'orange' : undefined}>
              {pct === null ? '—' : `${formatNumber(pct, 0)} %`}
            </Text>
          </Group>
          <Progress value={Math.min(pct ?? 0, 100)} color={colour} size="lg" radius="xl" aria-label="Utilization" />
        </div>
        <Row label="Total oil (information)" value={formatNumber(totalOil, 2)} />
        {capacity.over ? (
          <Alert color="orange" variant="light" p="xs">
            {formatNumber(capacity.allocated - (capacity.maxUnits ?? 0))} units above capacity. Saving will ask for a
            confirmation.
          </Alert>
        ) : null}
      </Stack>
    </Paper>
  )
}

function Row({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text fz="sm" c="dimmed">
        {label}
      </Text>
      <Text fz="sm" fw={600} c={colour}>
        {value}
      </Text>
    </Group>
  )
}
