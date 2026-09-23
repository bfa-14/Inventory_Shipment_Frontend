import { Anchor, Badge, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { Link } from 'react-router'
import { containerStatusColour } from '../../api/logistics/containers'
import type { PurchaseInvoiceContainerDto } from '../../api/purchase/documents'
import { dateLabel } from '../documents/documentKind'
import { formatNumber } from '../format'

/**
 * The containers carrying this invoice. An import invoice is received when its containers are
 * offloaded, so "where are my goods" is answered here: loaded, received, and where each box is.
 */
export function InvoiceContainersCard({ containers }: { containers: PurchaseInvoiceContainerDto[] }) {
  return (
    <Paper radius="lg" p="md" withBorder data-invoice-containers>
      <Title order={5} mb="sm">
        Containers
      </Title>
      {containers.length === 0 ? (
        <Text fz="sm" c="dimmed">
          Not loaded into any container yet.
        </Text>
      ) : (
        <Stack gap="sm">
          {containers.map((c) => (
            <Group key={c.id} justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
              <div style={{ minWidth: 0 }}>
                <Anchor component={Link} to={`/logistics/containers/${c.id}`} fz="sm" fw={600}>
                  {c.containerRef}
                </Anchor>
                {c.containerNo ? (
                  <Text span fz="xs" c="dimmed">
                    {' '}
                    · {c.containerNo}
                  </Text>
                ) : null}
                <Text fz="xs" c="dimmed">
                  Allocated {formatNumber(c.allocatedBase)} · Received {formatNumber(c.receivedBase)} (base units)
                </Text>
                <Text fz="xs" c="dimmed">
                  {c.offloadedDate
                    ? `Offloaded ${dateLabel(c.offloadedDate)} into ${c.warehouseCode ?? '—'}`
                    : c.currentLocation ?? (c.eta ? `ETA ${dateLabel(c.eta)}` : 'Not dispatched yet')}
                </Text>
              </div>
              <Badge color={containerStatusColour(c.status)} variant={c.status === 7 ? 'filled' : 'light'} style={{ flexShrink: 0 }}>
                {c.statusName}
              </Badge>
            </Group>
          ))}
        </Stack>
      )}
    </Paper>
  )
}
