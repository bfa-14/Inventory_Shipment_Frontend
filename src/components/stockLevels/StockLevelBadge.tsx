import { Badge, Tooltip } from '@mantine/core'
import { stockLevelStatusInfo } from './stockLevelStatus'

/**
 * A level's status as a light badge: Below Min red, Below Min covered orange (its tooltip says why it is not red), Above
 * Max blue, OK green, No level gray. The words and colours are stockLevelStatus.ts's.
 */
export function StockLevelBadge({ status }: { status: string }) {
  const info = stockLevelStatusInfo(status)
  const badge = (
    <Badge variant="light" color={info.colour} style={{ whiteSpace: 'nowrap' }} data-stock-level-status={status}>
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
