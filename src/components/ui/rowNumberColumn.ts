import type { DataTableColumn } from 'mantine-datatable'

/**
 * Leading "#" column numbering rows across pages: on page 2 with 10 per page it starts at 11.
 */
export function rowNumberColumn<T>(page: number, recordsPerPage: number): DataTableColumn<T> {
  return {
    accessor: '__rowNumber',
    title: '#',
    width: 60,
    render: (_record: T, index: number) => (page - 1) * recordsPerPage + index + 1,
  } as DataTableColumn<T>
}
