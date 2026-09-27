import { Anchor, Badge, Group, Paper, ScrollArea, Table, Text, Title } from '@mantine/core'
import { Link } from 'react-router'
import { chargeStatusColour, CHARGE_STATUSES } from '../../api/logistics/containerCharges'
import type { PurchaseChargeDto } from '../../api/purchase/landedCostAdjustments'
import { dateLabel } from '../documents/documentKind'
import { formatNumber } from '../format'

/**
 * The charges of an imported invoice's CONTAINERS (documentKind CNT), read-only: an import's
 * freight, clearing and insurance are entered on its containers, and this invoice only shows the
 * part that falls on its lines ("Share on this invoice"). The total is the header's
 * containerChargesBase — posted charges that enter the landed cost.
 */
export function InvoiceContainerChargesCard({
  charges,
  totalBase,
  baseCurrencyCode,
}: {
  charges: PurchaseChargeDto[]
  totalBase: number | null
  baseCurrencyCode: string
}) {
  const rows = charges.filter((c) => c.documentKind === 'CNT')
  return (
    <Paper radius="lg" p="md" withBorder data-invoice-container-charges>
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Title order={5}>Container charges</Title>
        <Text fz="sm" c="dimmed">
          Entered on the containers - read-only here
        </Text>
      </Group>
      {rows.length === 0 ? (
        <Text fz="sm" c="dimmed" ta="center" py="md">
          No charge on the containers of this invoice yet.
        </Text>
      ) : (
        <ScrollArea type="auto">
          <Table miw={1000} verticalSpacing={6} striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Container</Table.Th>
                <Table.Th>Charge type</Table.Th>
                <Table.Th>Provider</Table.Th>
                <Table.Th>Reference</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th ta="right">Amount</Table.Th>
                <Table.Th ta="right">Amount ({baseCurrencyCode})</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th ta="right">Share on this invoice</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>
                    {c.containerId ? (
                      <Anchor component={Link} to={`/logistics/containers/${c.containerId}`} fz="sm" fw={600}>
                        {c.containerRef ?? c.sourceNumber}
                      </Anchor>
                    ) : (
                      (c.containerRef ?? '—')
                    )}
                  </Table.Td>
                  <Table.Td>{`${c.chargeCode} - ${c.chargeName}`}</Table.Td>
                  <Table.Td>{c.providerName ?? '—'}</Table.Td>
                  <Table.Td>{c.reference ?? '—'}</Table.Td>
                  <Table.Td>{c.chargeDate ? dateLabel(c.chargeDate) : '—'}</Table.Td>
                  <Table.Td ta="right">{`${formatNumber(c.amount, 2)} ${c.currencyCode}`}</Table.Td>
                  <Table.Td ta="right">{formatNumber(c.amountBase, 2)}</Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={chargeStatusColour(c.chargeStatus ?? 0)}>
                      {CHARGE_STATUSES.find((s) => s.value === c.chargeStatus)?.label ?? '—'}
                    </Badge>
                    {!c.includeInLandedCost ? (
                      <Text fz="xs" c="dimmed">
                        not in the cost
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {formatNumber(c.shareBase, 2)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
      <Group justify="flex-end" mt="sm">
        <Text fw={700} data-container-charges-total>
          Total on this invoice: {formatNumber(totalBase ?? 0, 2)} {baseCurrencyCode}
        </Text>
      </Group>
    </Paper>
  )
}
