import { Group, Paper, SimpleGrid, Table, Text, Title, Tooltip } from '@mantine/core'
import type { SalesInvoiceDto } from '../../api/sales/invoices'
import { formatNumber } from '../format'

/**
 * What the invoice earned: per line, and in total.
 *
 * ONLY FOR A HOLDER OF sales.profit.view, and the page draws nothing at all without it — the API
 * returns these fields as null for everybody else, so an "empty" card would be the permission
 * leaking as a shrug. A price is everybody's business; a margin is not.
 *
 * EVERY FIGURE WAS FROZEN AT POSTING. Cost of sales is what the goods were worth the moment they
 * left, not what replacing them costs today: the same invoice read next year says the same thing.
 */
export function SalesInvoiceProfitCard({ invoice, baseCurrencyCode }: { invoice: SalesInvoiceDto; baseCurrencyCode: string }) {
  const money = (value: number | null | undefined) => (value === null || value === undefined ? '—' : formatNumber(value, 2))

  const stat = (label: string, value: string, hint: string, colour?: string) => (
    <div>
      <Tooltip label={hint} multiline w={260} withArrow>
        <Text size="sm" c="dimmed" style={{ cursor: 'help', textDecoration: 'underline dotted' }}>{label}</Text>
      </Tooltip>
      <Text fw={700} fz="lg" c={colour}>{value}</Text>
    </div>
  )

  const profit = invoice.totalGrossProfitBase
  const negative = profit !== null && profit < 0

  return (
    <Paper radius="lg" p="md" withBorder data-profit-card>
      <Group justify="space-between" align="center" mb="sm">
        <Title order={5}>Profit</Title>
        <Text fz="xs" c="dimmed">Frozen at posting, in {baseCurrencyCode}</Text>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" mb="md">
        {stat('Net Sales', money(invoice.lines.reduce((sum, l) => sum + (l.netSalesBase ?? 0), 0)), 'The lines after discount, in the base currency.')}
        {stat('COGS', money(invoice.totalCostBase), 'What the goods were worth when they left: base quantity × the average cost at posting.')}
        {stat('Gross Profit', money(profit), 'Net sales less cost of sales.', negative ? 'red' : 'teal')}
        {stat(
          'GP %',
          invoice.totalGrossProfitPct === null ? '—' : `${formatNumber(invoice.totalGrossProfitPct, 2)} %`,
          'Gross profit as a percentage of net sales.',
          negative ? 'red' : undefined,
        )}
      </SimpleGrid>

      <Table.ScrollContainer minWidth={620}>
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={50}>#</Table.Th>
              <Table.Th>Item</Table.Th>
              <Table.Th w={110} ta="right">Net Sales</Table.Th>
              <Table.Th w={110} ta="right">COGS</Table.Th>
              <Table.Th w={120} ta="right">Gross Profit</Table.Th>
              <Table.Th w={90} ta="right">GP %</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {invoice.lines.map((line) => {
              const lineNegative = (line.grossProfitBase ?? 0) < 0
              return (
                <Table.Tr key={line.id}>
                  <Table.Td>{line.lineNo}</Table.Td>
                  <Table.Td>
                    <Text fz="sm" fw={500}>{line.itemCode}</Text>
                    <Text fz="xs" c="dimmed" lineClamp={1}>{line.itemName}</Text>
                  </Table.Td>
                  <Table.Td ta="right">{money(line.netSalesBase)}</Table.Td>
                  <Table.Td ta="right">{money(line.cogsBase)}</Table.Td>
                  <Table.Td ta="right">
                    <Text fz="sm" fw={500} c={lineNegative ? 'red' : undefined}>{money(line.grossProfitBase)}</Text>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text fz="sm" c={lineNegative ? 'red' : undefined}>
                      {line.grossProfitPct === null ? '—' : `${formatNumber(line.grossProfitPct, 2)} %`}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  )
}
