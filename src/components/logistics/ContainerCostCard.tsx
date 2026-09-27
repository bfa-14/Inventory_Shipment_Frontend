import { Anchor, Divider, Group, Paper, Stack, Text, Title } from '@mantine/core'
import type { ContainerDto } from '../../api/logistics/containers'
import { formatNumber } from '../format'

/**
 * What the container really costs: FOB of its goods, the posted and draft charges, the landed total
 * and the real cost per item (the lines' landed per unit — final once offloaded). Each charge figure
 * jumps to the Charges card below.
 */
export function ContainerCostCard({ container, baseCurrencyCode }: { container: ContainerDto; baseCurrencyCode: string }) {
  const toCharges = (text: string) => (
    <Anchor href="#container-charges" fz="sm" onClick={(e) => { e.preventDefault(); document.getElementById('container-charges')?.scrollIntoView({ behavior: 'smooth' }) }}>
      {text}
    </Anchor>
  )
  return (
    <Paper radius="lg" p="md" withBorder data-container-cost>
      <Title order={5} mb="sm">
        Cost ({baseCurrencyCode})
      </Title>
      <Stack gap={6}>
        <Group justify="space-between">
          <Text fz="sm" c="dimmed">FOB total</Text>
          <Text fz="sm">{formatNumber(container.fobTotalBase ?? 0, 2)}</Text>
        </Group>
        <Group justify="space-between">
          <Text fz="sm" c="dimmed">Posted charges</Text>
          {toCharges(formatNumber(container.chargesPostedBase, 2))}
        </Group>
        <Group justify="space-between">
          <Text fz="sm" c="dimmed">Draft charges</Text>
          {toCharges(formatNumber(container.chargesDraftBase, 2))}
        </Group>
        <Group justify="space-between">
          <Text fw={700}>Landed total</Text>
          <Text fw={700} data-landed-total>{formatNumber(container.landedTotalBase ?? 0, 2)}</Text>
        </Group>
        {container.chargesPostedBase !== container.chargesLandedPostedBase ? (
          <Text fz="xs" c="dimmed">
            {formatNumber(container.chargesPostedBase - container.chargesLandedPostedBase, 2)} of posted charges do not enter the item cost.
          </Text>
        ) : null}
      </Stack>
      {container.lines.length > 0 ? (
        <>
          <Divider my="sm" label="Real cost per item" labelPosition="left" />
          <Stack gap={4}>
            {container.lines.map((line) => (
              <Group key={line.id} justify="space-between" wrap="nowrap" gap="xs">
                <Text fz="sm" truncate>
                  {line.itemCode}
                </Text>
                <Text fz="sm" fw={line.isLandedFinal ? 700 : 400} style={{ whiteSpace: 'nowrap' }}>
                  {formatNumber(line.landedCostBase, 2)}
                  {line.isLandedFinal ? '' : ' est.'}
                </Text>
              </Group>
            ))}
          </Stack>
        </>
      ) : null}
    </Paper>
  )
}
