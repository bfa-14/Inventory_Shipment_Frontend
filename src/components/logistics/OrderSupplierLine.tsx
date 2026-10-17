import { Text } from '@mantine/core'
import { supplierLabel } from '../purchase/purchaseKind'
import type { ContainerOrderSupplier } from './containerDefaults'

/** "Supplier: SUP-0001 - TVS Motor Company (from the order)", read-only at the top of the dialog. */
export function OrderSupplierLine({ supplier }: { supplier: ContainerOrderSupplier | null }) {
  if (!supplier) return null
  return (
    <Text fz="sm" data-order-supplier>
      <Text span c="dimmed">
        Supplier:
      </Text>{' '}
      <Text span fw={600}>
        {supplierLabel({ partyCode: supplier.supplierCode, partyName: supplier.supplierName })}
      </Text>{' '}
      <Text span c="dimmed">
        (from the order)
      </Text>
    </Text>
  )
}
