import { Alert, Badge, Group, Paper, Progress, Stack, Text, Title } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { formatNumber } from '../format'
import type { Fill } from './containerFill'

interface ContainerCapacityCardProps {
  typeLabel: string | null
  /** The fill of the lines on the page, from the items' Container units. */
  fill: Fill
  totalOil: number
}

/**
 * How full the container is: the sum, item by item, of the pieces loaded ÷ the item's pieces per container (its
 * Container unit, Item Definition) - no typed or container type capacity since script 50. RED ABOVE 100 %, and never
 * a block: the customer sometimes squeezes a few more in, so the save asks for a confirmation instead. Unknown while
 * an item has no Container unit.
 */
export function ContainerCapacityCard({ typeLabel, fill, totalOil }: ContainerCapacityCardProps) {
  const pct = fill.pct
  const allocated = fill.parts.reduce((sum, p) => sum + p.quantity, 0)
  const colour = fill.over ? 'red' : pct !== null && pct >= 90 ? 'green' : 'blue'

  return (
    <Paper radius="lg" p="md" withBorder data-container-capacity>
      <Group justify="space-between" mb="sm">
        <Title order={5}>Capacity</Title>
        {fill.over ? (
          <Badge color="red" variant="filled" leftSection={<IconAlertTriangle size={12} />}>
            Over capacity
          </Badge>
        ) : null}
      </Group>

      <Stack gap="xs">
        <Row label="Container type" value={typeLabel ?? '—'} />
        <Row label="Allocated (base units)" value={formatNumber(allocated)} />
        <Row
          label="Remaining"
          value={fill.remaining === null ? '—' : formatNumber(fill.remaining)}
          colour={fill.over ? 'red.7' : undefined}
        />
        <div>
          <Group justify="space-between" mb={4}>
            <Text fz="sm" c="dimmed">
              Fill
            </Text>
            <Text fz="sm" fw={700} c={fill.over ? 'red.7' : undefined}>
              {pct === null ? '—' : `${formatNumber(pct, 0)} %`}
            </Text>
          </Group>
          <Progress value={Math.min(pct ?? 0, 100)} color={colour} size="lg" radius="xl" aria-label="Fill" />
        </div>
        {fill.missing.length > 0 ? (
          <Text fz="xs" c="dimmed">
            Unknown: {fill.missing.map((m) => m.itemCode).join(', ')} {fill.missing.length === 1 ? 'has' : 'have'} no
            Container unit.
          </Text>
        ) : null}
        <Row label="Total oil (information)" value={formatNumber(totalOil, 2)} />
        {fill.over ? (
          <Alert color="red" variant="light" p="xs">
            Above capacity. Saving will ask for a confirmation.
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
