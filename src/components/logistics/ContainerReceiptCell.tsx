import { Link } from 'react-router'
import { Anchor, Badge, Group, Text } from '@mantine/core'
import { routes } from '../../routes'
import type { ContainerReceipt } from './containerReceipt'
import { WHOLE_BADGE } from './movementContainers'

interface ContainerReceiptCellProps {
  receipt: ContainerReceipt | null
  /** purchase.goodsreceipts.view: without it the number is plain text. */
  canView: boolean
}

/**
 * The "Goods receipt" / "Receipt" cell of a container row: the GRN number of a posted receipt, or a gray "Draft" badge,
 * linked to the receipt for a reader who may open it; "—" when the container has none.
 */
export function ContainerReceiptCell({ receipt, canView }: ContainerReceiptCellProps) {
  if (!receipt) {
    return (
      <Text fz="sm" c="dimmed">
        —
      </Text>
    )
  }
  const label = receipt.number ?? 'Draft'
  const content =
    receipt.status === 1 ? (
      <Badge size="sm" variant="light" color="gray" styles={WHOLE_BADGE} style={{ cursor: canView ? 'pointer' : undefined }}>
        {label}
      </Badge>
    ) : (
      <Text span fz="sm" fw={canView ? 600 : undefined} style={{ whiteSpace: 'nowrap' }}>
        {label}
      </Text>
    )
  if (!canView) return <Group gap={4}>{content}</Group>
  return (
    <Anchor
      component={Link}
      to={routes.goodsReceipt(receipt.id)}
      fz="sm"
      underline="hover"
      aria-label={receipt.number ? `Open goods receipt ${receipt.number}` : 'Open the draft goods receipt'}
    >
      {content}
    </Anchor>
  )
}
