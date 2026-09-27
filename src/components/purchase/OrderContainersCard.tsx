import type { ReactNode } from 'react'
import { Anchor, Badge, Group, Paper, ScrollArea, Table, Text, Title } from '@mantine/core'
import { Link } from 'react-router'
import { containerStatusColour, containerStatusLabel } from '../../api/logistics/containers'
import type { PurchaseInvoiceContainerDto } from '../../api/purchase/documents'
import { dateLabel } from '../documents/documentKind'
import { formatNumber } from '../format'

/**
 * The containers of a purchase ORDER: where its goods are. Loaded, Invoiced and Received are this
 * order's quantities on each container (a container may carry lines of other orders too). The two
 * buttons — Add Container, Create Invoice from Containers — are the host's, passed as `actions`.
 */
export function OrderContainersCard({ containers, actions }: { containers: PurchaseInvoiceContainerDto[]; actions?: ReactNode }) {
  return (
    <Paper radius="lg" p="md" withBorder data-order-containers>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
        <Title order={5}>Containers</Title>
        {actions ? <Group gap="xs">{actions}</Group> : null}
      </Group>
      {containers.length === 0 ? (
        <Text fz="sm" c="dimmed" ta="center" py="md">
          No container yet - use Add Container.
        </Text>
      ) : (
        <ScrollArea type="auto">
          <Table miw={900} verticalSpacing={6} striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Ref.</Table.Th>
                <Table.Th>Container No.</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th ta="right">Loaded (this order)</Table.Th>
                <Table.Th ta="right">Invoiced</Table.Th>
                <Table.Th ta="right">Received</Table.Th>
                <Table.Th>Current location</Table.Th>
                <Table.Th>ETA</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {containers.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>
                    <Anchor component={Link} to={`/logistics/containers/${c.id}`} fz="sm" fw={600}>
                      {c.containerRef}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{c.containerNo ?? '—'}</Table.Td>
                  <Table.Td>{c.containerTypeCode}</Table.Td>
                  <Table.Td>
                    <Badge color={containerStatusColour(c.status)} variant={c.status === 7 ? 'filled' : 'light'}>
                      {containerStatusLabel(c.status)}
                    </Badge>
                  </Table.Td>
                  <Table.Td ta="right">{formatNumber(c.allocatedBase)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(c.invoicedBase)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(c.receivedBase)}</Table.Td>
                  <Table.Td>
                    {c.offloadedDate ? `Offloaded ${dateLabel(c.offloadedDate)} into ${c.warehouseCode ?? '—'}` : (c.currentLocation ?? '—')}
                  </Table.Td>
                  <Table.Td>{c.eta ? dateLabel(c.eta) : '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Paper>
  )
}
