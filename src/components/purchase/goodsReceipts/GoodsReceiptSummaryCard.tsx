import { Divider, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useSeesItemCosts } from '../../../hooks/useSeesItemCosts'
import { formatNumber } from '../../format'

interface GoodsReceiptSummaryCardProps {
  expectedBase: number
  receivedBase: number
  shortBase: number
  /** (94) Null without View item costs (inventory.costs.view). */
  valueBase: number | null
  currencyCode: string
  /** A draft's value is an estimate: the order price until an invoice is matched. */
  posted: boolean
}

/**
 * What the receipt adds up to, in pieces and in money: Expected, Received, Short and "Value at cost".
 *
 * COMPUTED FROM THE LINES ON SCREEN while a draft is typed, so it moves with the counting; a posted receipt shows the
 * server's figures.
 *
 * (94) WITHOUT VIEW ITEM COSTS the card gives the pieces only: the "Value at cost" block is not drawn.
 */
export function GoodsReceiptSummaryCard({ expectedBase, receivedBase, shortBase, valueBase, currencyCode, posted }: GoodsReceiptSummaryCardProps) {
  const seesCosts = useSeesItemCosts()
  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">
        Summary
      </Title>

      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Expected
          </Text>
          <Text fw={500}>{formatNumber(expectedBase)} pcs</Text>
        </Group>
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Received
          </Text>
          <Text fw={500}>{formatNumber(receivedBase)} pcs</Text>
        </Group>
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Short
          </Text>
          <Text fw={500} c={shortBase > 0 ? 'red' : undefined}>
            {formatNumber(shortBase)} pcs
          </Text>
        </Group>

        {seesCosts && (
          <>
            <Divider />

            <Group justify="space-between" align="flex-start">
              <Stack gap={0}>
                <Text fw={600}>Value at cost</Text>
                {!posted && (
                  <Text size="xs" c="dimmed">
                    Estimate: the cost is set when the receipt is posted.
                  </Text>
                )}
              </Stack>
              <Text fw={700} fz="lg">
                {formatNumber(valueBase, 2)} {currencyCode}
              </Text>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  )
}
