import { Badge, Card, Group, NavLink, Stack, Text, Tooltip } from '@mantine/core'
import { IconArrowsExchange, IconFiles, IconScale, IconShoppingCart, IconTruck } from '@tabler/icons-react'
import type { ItemDetailsDto } from '../../api/types'
import { formatDateTime } from '../../components/format'

/** Label above, value below - the read-only shape the side cards repeat. */
function Row({ label, value, dimmed = false }: { label: string; value: string; dimmed?: boolean }) {
  return (
    <Group justify="space-between" align="baseline" wrap="nowrap" gap="md">
      <Text c="dimmed" fz="sm">
        {label}
      </Text>
      <Text fz="sm" fw={dimmed ? 400 : 500} c={dimmed ? 'dimmed' : undefined} ta="right">
        {value}
      </Text>
    </Group>
  )
}

/** Who created the item and who touched it last. */
export function ItemAuditCard({ item }: { item: ItemDetailsDto }) {
  return (
    <Card radius="lg" p="lg" withBorder>
      <Text fw={600} fz="md" mb="sm">
        Audit
      </Text>
      <Stack gap="xs">
        <Row label="Created on" value={formatDateTime(item.createdAtUtc)} />
        <Row label="Created by" value={item.createdByName ?? '—'} />
        <Row label="Last updated" value={formatDateTime(item.updatedAtUtc)} />
        <Row label="Updated by" value={item.updatedByName ?? '—'} />
      </Stack>
    </Card>
  )
}

/**
 * On hand and the cost figures. Every value here is a placeholder the API sends as 0 or null: the
 * numbers become real when the stock and purchasing modules land, and the note says so rather than
 * letting a reader take a dash for "this item costs nothing".
 */
export function ItemStockCard({ item }: { item: ItemDetailsDto | null }) {
  const money = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : value.toLocaleString(undefined, { minimumFractionDigits: 2 })

  return (
    <Card radius="lg" p="lg" withBorder>
      <Text fw={600} fz="md" mb="sm">
        Stock &amp; Costs
      </Text>
      <Stack gap="xs">
        <Row label="On Hand" value={item ? String(item.onHand) : '0'} dimmed />
        <Row label="Last Cost" value={money(item?.lastCost)} dimmed />
        <Row label="Average Cost" value={money(item?.averageCost)} dimmed />
        <Row label="Last Purchase Cost" value={money(item?.lastPurchaseCost)} dimmed />
      </Stack>
      <Text c="dimmed" fz="xs" mt="sm">
        Available once the Stock module is live.
      </Text>
    </Card>
  )
}

const QUICK_LINKS = [
  { label: 'Stock Balance', icon: IconScale },
  { label: 'Stock Movement', icon: IconArrowsExchange },
  { label: 'Purchase Orders', icon: IconShoppingCart },
  { label: 'Containers', icon: IconTruck },
  { label: 'Documents', icon: IconFiles },
]

/** Where this item will be reachable from once the rest of the application exists. */
export function ItemQuickLinksCard() {
  return (
    <Card radius="lg" p="lg" withBorder>
      <Text fw={600} fz="md" mb="xs">
        Quick Links
      </Text>
      <Stack gap={2}>
        {QUICK_LINKS.map(({ label, icon: Icon }) => (
          <Tooltip key={label} label="Coming soon" withArrow position="left">
            <NavLink
              label={label}
              leftSection={<Icon size={17} stroke={1.6} />}
              rightSection={
                <Badge size="xs" variant="light" color="gray">
                  Soon
                </Badge>
              }
              disabled
              styles={{ root: { borderRadius: 'var(--mantine-radius-md)' } }}
            />
          </Tooltip>
        ))}
      </Stack>
    </Card>
  )
}
