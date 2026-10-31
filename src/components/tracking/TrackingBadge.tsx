import { Badge, Tooltip, type MantineSize } from '@mantine/core'
import type { TrackingKind } from '../../api/types'
import { KIND_TEXT, kindBadgeText } from './trackingNumbers'

interface TrackingBadgeProps {
  /** Serial | Batch | Expiry; nothing is drawn for null. */
  kind: TrackingKind | null | undefined
  /** The item also requires an expiry date: "Serial nos. + expiry", "Batches + expiry". */
  withExpiry?: boolean
  size?: MantineSize
  variant?: 'light' | 'filled' | 'outline' | 'dot'
  /** Said on hover (a wide screen): "Dispatch… asks for the serial numbers of these pieces." */
  tooltip?: string
  /** A grid's badge: 4 px side padding and no letter-spacing, so the longest, xs "Serial nos. + expiry", fits 130 px. */
  compact?: boolean
}

/**
 * How an item is tracked, as a badge (script 93): "Serial nos." grape, "Batches" cyan, "Expiry dates" yellow, with
 * "+ expiry" when each piece also gives its expiry date. Item Definition's header and a transfer order's lines show
 * it; generic, so any screen that asks for the numbers later shows the same badge.
 */
export function TrackingBadge({
  kind,
  withExpiry = false,
  size = 'sm',
  variant = 'light',
  tooltip,
  compact = false,
}: TrackingBadgeProps) {
  if (!kind) return null
  const badge = (
    <Badge
      size={size}
      variant={variant}
      color={KIND_TEXT[kind].colour}
      px={compact ? 4 : undefined}
      // Never cut with an ellipsis ("Serial n…"): never narrower than its words, it widens its column a little instead.
      style={{ textTransform: 'none', minWidth: 'max-content', ...(compact ? { letterSpacing: 0 } : null) }}
      data-tracking-badge={kind}
    >
      {kindBadgeText(kind, withExpiry && kind !== 'Expiry')}
    </Badge>
  )
  if (!tooltip) return badge
  return (
    <Tooltip label={tooltip} withArrow multiline w={260} events={{ hover: true, focus: true, touch: true }}>
      {badge}
    </Tooltip>
  )
}
