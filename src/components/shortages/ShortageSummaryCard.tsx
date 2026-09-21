import { Group, Paper, Progress, SimpleGrid, Text, Title } from '@mantine/core'
import { stamp } from '../documents/documentKind'
import { formatNumber } from '../format'
import type { ShortageTotals } from './shortageMath'

interface ShortageSummaryCardProps {
  totals: ShortageTotals
  /** When the live figures were last taken; null on a plan that was never saved. */
  calculatedAtUtc: string | null
}

/**
 * What the plan adds up to.
 *
 * CONTAINERS ARE SHOWN THREE WAYS because each answers a different question: 7.35 is what the
 * quantities need, 8 is what has to be booked, and 91.88 % is how full those eight will travel —
 * the figure that tells a planner whether topping a line up is free.
 */
export function ShortageSummaryCard({ totals, calculatedAtUtc }: ShortageSummaryCardProps) {
  const stat = (label: string, value: string, hint?: string) => (
    <div>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={700} fz="lg">{value}</Text>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </div>
  )

  const utilization = totals.utilizationPct

  return (
    <Paper radius="lg" p="md" withBorder data-shortage-summary>
      <Title order={5} mb="sm">Summary</Title>

      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
        {stat('Items', formatNumber(totals.items))}
        {stat('Total Shortage', formatNumber(totals.totalShortageBase), 'base units')}
        {stat('Total Required', formatNumber(totals.totalRequiredBase), 'base units')}
        {stat('Containers', formatNumber(totals.containers, 2), 'sum of the lines')}
        {stat('Containers rounded', formatNumber(totals.containersRounded), 'to book')}
        <div>
          <Text size="sm" c="dimmed">Utilization</Text>
          <Text fw={700} fz="lg">{utilization === null ? '—' : `${formatNumber(utilization, 2)} %`}</Text>
          <Progress value={utilization ?? 0} size="sm" mt={4} color={utilization !== null && utilization < 75 ? 'orange' : 'teal'} aria-label="Container utilization" />
        </div>
      </SimpleGrid>

      <Group mt="md" gap={6}>
        <Text size="xs" c="dimmed">Last calculated at</Text>
        <Text size="xs" fw={500}>{calculatedAtUtc ? stamp(calculatedAtUtc) : 'not yet — the figures are taken when the draft is saved'}</Text>
      </Group>
    </Paper>
  )
}
