import type { ReactNode } from 'react'
import { Badge } from '../ui/Badge'
import { Icon } from '../ui/Icon'

// ---------------------------------------------------------------- sortable header

interface SortableHeaderProps<TSort extends string> {
  column: TSort
  label: string
  activeColumn: TSort
  direction: 'asc' | 'desc'
  onSort(column: TSort): void
}

/** Column heading that toggles asc/desc and shows the current direction. */
export function SortableHeader<TSort extends string>({
  column,
  label,
  activeColumn,
  direction,
  onSort,
}: SortableHeaderProps<TSort>) {
  const active = activeColumn === column

  return (
    <th>
      <button type="button" className="sort-header" onClick={() => onSort(column)}>
        {label}
        <Icon
          name={active ? (direction === 'asc' ? 'sort-asc' : 'sort-desc') : 'sort'}
          className={active ? 'sort-header__icon sort-header__icon--on' : 'sort-header__icon'}
        />
      </button>
    </th>
  )
}

// ---------------------------------------------------------------- cells

/** Amber star + "Yes" for the main branch / warehouse, plain "No" otherwise. */
export function MainFlagCell({ isMain }: { isMain: boolean }) {
  if (!isMain) return <>No</>

  return (
    <span className="main-branch">
      <Icon name="star" filled className="main-branch__star" />
      Yes
    </span>
  )
}

export function StatusPill({ isActive }: { isActive: boolean }) {
  return <Badge tone={isActive ? 'success' : 'neutral'}>{isActive ? 'Active' : 'Inactive'}</Badge>
}

// ---------------------------------------------------------------- row actions

interface RowActionsProps {
  /** Used in the accessible labels, e.g. "Edit BR-001". */
  code: string
  isActive: boolean
  canEdit: boolean
  canDelete: boolean
  /** True for the main branch / warehouse, which may not be deactivated or deleted. */
  isProtected: boolean
  /** Tooltip for the disabled Deactivate icon, e.g. "The main branch cannot be deactivated". */
  protectedDeactivateTitle: string
  protectedDeleteTitle: string
  onEdit(): void
  onToggleStatus(): void
  onDelete(): void
}

/** Edit / Activate-Deactivate / Delete icon buttons, hidden or disabled per permission and state. */
export function RowActions({
  code,
  isActive,
  canEdit,
  canDelete,
  isProtected,
  protectedDeactivateTitle,
  protectedDeleteTitle,
  onEdit,
  onToggleStatus,
  onDelete,
}: RowActionsProps) {
  // Only an active main record is locked: once it is inactive it no longer holds the flag.
  const lockDeactivate = isProtected && isActive

  return (
    <div className="row-actions">
      {canEdit ? (
        <button
          type="button"
          className="icon-btn icon-btn--edit"
          title="Edit"
          aria-label={`Edit ${code}`}
          onClick={onEdit}
        >
          <Icon name="pencil" />
        </button>
      ) : null}

      {canEdit ? (
        <button
          type="button"
          className="icon-btn"
          disabled={lockDeactivate}
          title={lockDeactivate ? protectedDeactivateTitle : isActive ? 'Deactivate' : 'Activate'}
          aria-label={`${isActive ? 'Deactivate' : 'Activate'} ${code}`}
          onClick={onToggleStatus}
        >
          <Icon name="power" />
        </button>
      ) : null}

      {canDelete ? (
        <button
          type="button"
          className="icon-btn icon-btn--danger"
          disabled={isProtected}
          title={isProtected ? protectedDeleteTitle : 'Delete'}
          aria-label={`Delete ${code}`}
          onClick={onDelete}
        >
          <Icon name="trash" />
        </button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- loading / empty rows

/** Shimmer rows shown while a page is loading. */
export function SkeletonRows({ rows = 5, columns }: { rows?: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={`skeleton-${r}`} className="skeleton-row">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c}>
              <span className="skeleton" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export function EmptyRow({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={columns} className="table-state muted">
        {children}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------- footer & pagination

interface TableFooterProps {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  pageSizeOptions: readonly number[]
  onPageChange(page: number): void
  onPageSizeChange(pageSize: number): void
}

/** "Showing x to y of z entries" with the page-size selector and pagination. */
export function TableFooter({
  page,
  pageSize,
  totalCount,
  totalPages,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: TableFooterProps) {
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, totalCount)

  return (
    <div className="table-footer">
      <p className="table-footer__count">
        Showing {from} to {to} of {totalCount} entries
      </p>

      <div className="table-footer__controls">
        <label className="page-size">
          Rows
          <select aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <Pagination page={page} totalPages={totalPages} onGoTo={onPageChange} />
      </div>
    </div>
  )
}

/** Up to five page numbers around the current one, with ellipses for the rest. */
function Pagination({ page, totalPages, onGoTo }: { page: number; totalPages: number; onGoTo(page: number): void }) {
  if (totalPages < 1) return null

  const pages: number[] = []
  let start = Math.max(1, page - 2)
  const end = Math.min(totalPages, start + 4)
  start = Math.max(1, end - 4)
  for (let p = start; p <= end; p++) pages.push(p)

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="pagination__step"
        disabled={page <= 1}
        onClick={() => onGoTo(page - 1)}
        aria-label="Previous page"
      >
        <Icon name="chevron-left" />
      </button>

      {start > 1 ? <span className="pagination__gap">...</span> : null}

      {pages.map((p) => (
        <button
          key={p}
          type="button"
          className={`pagination__page${p === page ? ' pagination__page--current' : ''}`}
          aria-current={p === page ? 'page' : undefined}
          onClick={() => onGoTo(p)}
        >
          {p}
        </button>
      ))}

      {end < totalPages ? <span className="pagination__gap">...</span> : null}

      <button
        type="button"
        className="pagination__step"
        disabled={page >= totalPages}
        onClick={() => onGoTo(page + 1)}
        aria-label="Next page"
      >
        <Icon name="chevron-right" />
      </button>
    </nav>
  )
}
