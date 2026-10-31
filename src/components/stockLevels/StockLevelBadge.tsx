import { Badge, Tooltip } from '@mantine/core'
import { stockLevelStatusInfo } from './stockLevelStatus'

/**
 * A level's status as a light badge: Below Min red, Below Min covered orange (its tooltip says why it is not red), Above
 * Max blue, OK green, No level gray. The words and colours are stockLevelStatus.ts's.
 */
export function StockLevelBadge({ status }: { status: string }) {
  const info = stockLevelStatusInfo(status)
  const badge = (
    /* The whole label, always: a badge in a narrow column was cut to "Be…" (its label hides its overflow), and a
       status read as "Be…" says nothing. The badge keeps its width; the column grows or the table scrolls. */
    <Badge
      variant="light"
      color={info.colour}
      style={{ whiteSpace: 'nowrap', maxWidth: 'none', flexShrink: 0 }}
      styles={{ label: { overflow: 'visible' } }}
      data-stock-level-status={status}
    >
      {info.label}
    </Badge>
  )
  return info.tooltip ? (
    <Tooltip label={info.tooltip} withArrow multiline w={260}>
      {badge}
    </Tooltip>
  ) : (
    badge
  )
}
