import { Badge, Card, Group, NavLink, Stack, Text, Tooltip } from '@mantine/core'
import { Link } from 'react-router'
import { IconArrowsExchange, IconFiles, IconScale, IconShoppingCart, IconTruck } from '@tabler/icons-react'
import type { ItemDetailsDto } from '../../api/types'
import { formatDateOnly, formatDateTime, formatNumber } from '../../components/format'

/** Label above, value below - the read-only shape the side cards repeat. */
function Row({
  label,
  value,
  dimmed = false,
  hint,
}: {
  label: string
  value: string
  dimmed?: boolean
  /** What the figure means. The four cost figures differ by one word, so each says which it is. */
  hint?: string
}) {
  return (
    <Group justify="space-between" align="baseline" wrap="nowrap" gap="md">
      <Tooltip label={hint} disabled={!hint} multiline w={280} withArrow position="left">
        <Text c="dimmed" fz="sm" style={hint ? { cursor: 'help', textDecoration: 'underline dotted' } : undefined}>
          {label}
        </Text>
      </Tooltip>
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
 * On hand and the cost figures, as the ledger and the postings keep them.
 *
 * READ-ONLY BY DESIGN. The average is a moving average written by every posting that adds stock,
 * the last cost and supplier by the last receipt; a box that let somebody type over them would let
 * the same stock leave at a value it never entered at.
 */
export function ItemStockCard({ item }: { item: ItemDetailsDto | null }) {
  const money = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${formatNumber(value, 2)} USD`)

  return (
    <Card radius="lg" p="lg" withBorder>
      <Text fw={600} fz="md" mb="sm">
        Stock &amp; Costs
      </Text>
      <Stack gap="xs">
        <Row label="On Hand" value={item ? formatNumber(item.onHand) : '0'} />
        <Row
          label="FOB Purchase Cost"
          value={money(item?.fobCost)}
          hint="What the supplier charged per base unit on the last posted invoice, before freight, customs and the rest."
        />
        <Row
          label="Last Cost (landed)"
          value={money(item?.lastCost)}
          hint="The last posted purchase, FOB plus every charge allocated to it. An Inventory In does not touch it."
        />
        <Row
          label="Average Cost"
          value={money(item?.averageCost)}
          hint="The moving weighted average, moved only by the postings that add stock. What a sale is costed at."
        />
        <Row
          label="Inventory Value"
          value={money(item?.inventoryValue)}
          hint="On hand × average cost."
        />
        <Row label="Last Supplier" value={item?.lastSupplierName ?? '—'} dimmed={!item?.lastSupplierName} />
        <Row label="Last Purchase" value={item?.lastPurchaseAtUtc ? formatDateOnly(item.lastPurchaseAtUtc.slice(0, 10)) : '—'} dimmed={!item?.lastPurchaseAtUtc} />
      </Stack>
      <Text c="dimmed" fz="xs" mt="sm">
        Per base unit, in USD. FOB is what the supplier charged; the landed cost adds the freight, customs and clearing
        allocated to the goods.
      </Text>
    </Card>
  )
}

/** The links that lead somewhere yet; the rest wait for their pages. */
const LIVE_LINKS = [
  { label: 'Stock Balance', icon: IconScale, to: (itemId: number) => `/inventory/items/${itemId}/stock-balance` },
]

const QUICK_LINKS = [
  { label: 'Stock Movement', icon: IconArrowsExchange },
  { label: 'Purchase Orders', icon: IconShoppingCart },
  { label: 'Containers', icon: IconTruck },
  { label: 'Documents', icon: IconFiles },
]

/**
 * Where else this item can be looked at. A link needs a saved item; on a new one it waits.
 */
export function ItemQuickLinksCard({ itemId }: { itemId: number | null }) {
  return (
    <Card radius="lg" p="lg" withBorder>
      <Text fw={600} fz="md" mb="xs">
        Quick Links
      </Text>
      <Stack gap={2}>
        {LIVE_LINKS.map(({ label, icon: Icon, to }) => (
          <Tooltip key={label} label="Save the item first" withArrow position="left" disabled={itemId !== null}>
            <NavLink
              component={Link}
              to={itemId === null ? '#' : to(itemId)}
              label={label}
              leftSection={<Icon size={17} stroke={1.6} />}
              disabled={itemId === null}
              styles={{ root: { borderRadius: 'var(--mantine-radius-md)' } }}
            />
          </Tooltip>
        ))}
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
