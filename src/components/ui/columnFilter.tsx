import type { ReactNode } from 'react'
import { ColumnFilterPopover, type ColumnFilterPopoverProps } from './ColumnFilterPopover'

/**
 * The `filter` and `filtering` props for one grid column, spread straight into its definition.
 * `filtering` is what lights the funnel in the header, so it always agrees with the value the
 * popover opens on - one call site, one source of truth for both.
 *
 *   { accessor: 'isActive', title: 'Status', ...columnFilter({ label: 'Status',
 *     options: ['Active', 'Inactive'], withText: false, ...grid.bind('isActive') }) }
 */
export function columnFilter(props: Omit<ColumnFilterPopoverProps, 'close'>): {
  filter: (params: { close: () => void }) => ReactNode
  filtering: boolean
} {
  return {
    filter: ({ close }) => <ColumnFilterPopover {...props} close={close} />,
    filtering: props.value !== undefined,
  }
}
