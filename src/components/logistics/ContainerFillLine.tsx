import { Fragment } from 'react'
import { Link } from 'react-router'
import { Anchor, Group, Progress, Stack, Text, Tooltip } from '@mantine/core'
import { formatNumber } from '../format'
import { fillColour, fillLabel, fillParts, type Fill } from './containerFill'

const ITEMS_ROUTE = '/inventory/items'

/**
 * "Fill: 100 % (84 pcs of TEST38-A, 84 per container)" under the lines of every container form - the order's Add
 * Container, the container page, the invoice's Add container. The pieces per container are the items' Container
 * units from the API; an item without one makes the fill unknown and says where to set it.
 */
export function ContainerFillLine({ fill }: { fill: Fill }) {
  if (fill.missing.length > 0) {
    return (
      <Text fz="sm" data-container-fill="unknown">
        <Text span fw={600}>
          Fill: —
        </Text>{' '}
        Set the Container unit of{' '}
        {fill.missing.map((item, index) => (
          <Fragment key={item.itemId}>
            {index > 0 ? ', ' : null}
            <Anchor component={Link} to={`${ITEMS_ROUTE}/${item.itemId}`} target="_blank" fw={600}>
              {item.itemCode}
            </Anchor>
          </Fragment>
        ))}{' '}
        in Item Definition
      </Text>
    )
  }
  const pct = fill.pct ?? 0
  return (
    <Stack gap={4} data-container-fill="known">
      <Text fz="sm" c={fill.over ? 'red.7' : undefined} fw={fill.over ? 700 : undefined}>
        <Text span fw={600} c={fill.over ? 'red.7' : undefined}>
          Fill: {formatNumber(pct, 0)} %
        </Text>
        {fill.parts.length > 0 ? ` (${fillParts(fill)})` : ''}
        {fill.over ? ' - above capacity' : ''}
      </Text>
      <Progress
        value={Math.min(100, pct)}
        color={fill.over ? 'red' : pct >= 90 ? 'green' : 'blue'}
        size="sm"
        radius="xl"
        aria-label="Fill"
      />
    </Stack>
  )
}

/**
 * The fill of a saved container in a list: "71.4 %", red above 100 %, "—" with the items without a Container unit
 * in a tooltip.
 */
export function ContainerFillCell({ fillPct, missingItems }: { fillPct: number | null; missingItems: string | null }) {
  if (fillPct === null) {
    return (
      <Tooltip
        label={missingItems ? `No Container unit: ${missingItems}` : 'Unknown'}
        withArrow
        disabled={!missingItems}
      >
        <Text fz="sm" c="dimmed" span data-fill-unknown>
          —
        </Text>
      </Tooltip>
    )
  }
  return (
    <Group gap={6} wrap="nowrap">
      <Text
        fz="sm"
        fw={fillPct > 100 ? 700 : undefined}
        c={fillColour(fillPct) === 'red' ? 'red.7' : undefined}
        span
        style={{ whiteSpace: 'nowrap' }}
      >
        {fillLabel(fillPct)}
      </Text>
    </Group>
  )
}
