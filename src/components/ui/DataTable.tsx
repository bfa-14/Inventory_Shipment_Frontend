import type { ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  render(row: T): ReactNode
  /** Hidden below 700px to keep the table readable on phones. */
  secondary?: boolean
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey(row: T): string | number
  emptyMessage: string
  /** Rendered in a trailing "Actions" column when given. */
  rowActions?(row: T): ReactNode
  loading?: boolean
}

export function DataTable<T>({ columns, rows, rowKey, emptyMessage, rowActions, loading = false }: DataTableProps<T>) {
  if (loading) {
    return <p className="table-state muted">Loading...</p>
  }

  if (rows.length === 0) {
    return <p className="table-state muted">{emptyMessage}</p>
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.secondary ? 'col-secondary' : undefined}>
                {c.header}
              </th>
            ))}
            {rowActions ? <th className="col-actions">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.secondary ? 'col-secondary' : undefined}>
                  {c.render(row)}
                </td>
              ))}
              {rowActions ? <td className="col-actions">{rowActions(row)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
