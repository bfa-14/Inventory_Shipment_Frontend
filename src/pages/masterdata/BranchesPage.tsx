import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import type { BranchDto, BranchSortBy, PagedResult } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { Alert } from '../../components/Alert'
import { PageHeader } from '../../components/layout/PageHeader'
import {
  EmptyRow,
  MainFlagCell,
  RowActions,
  SkeletonRows,
  SortableHeader,
  StatusPill,
  TableFooter,
} from '../../components/masterdata/MasterDataTable'
import { downloadCsv } from '../../components/masterdata/csv'
import { MoreActionsMenu } from '../../components/masterdata/MoreActionsMenu'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/useToast'
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_OPTIONS } from '../../config'
import { PERMISSIONS } from '../../navigation'
import { BranchFormModal } from './BranchFormModal'

/** Everything that decides which rows the API returns. */
interface Query {
  search: string
  isActive: '' | 'true' | 'false'
  isMainBranch: '' | 'true' | 'false'
  sortBy: BranchSortBy
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

const DEFAULT_QUERY: Query = {
  search: '',
  isActive: '',
  isMainBranch: '',
  sortBy: 'BranchCode',
  sortDir: 'asc',
  page: 1,
  pageSize: PAGE_SIZE_DEFAULT,
}

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; branch: BranchDto }
  | { kind: 'delete'; branch: BranchDto }
  | { kind: 'status'; branch: BranchDto }
  | { kind: 'referenced'; branch: BranchDto; message: string }
  | null

const COLUMNS: { key: BranchSortBy; header: string }[] = [
  { key: 'BranchCode', header: 'Branch Code' },
  { key: 'BranchName', header: 'Branch Name' },
  { key: 'Address', header: 'Address' },
  { key: 'IsMainBranch', header: 'Is Main Branch' },
  { key: 'IsActive', header: 'Status' },
]

const COLUMN_COUNT = COLUMNS.length + 2 // the leading "#" and the trailing "Actions"

export function BranchesPage() {
  const { hasPermission } = useAuth()
  const { showToast } = useToast()

  const [query, setQuery] = useState<Query>(DEFAULT_QUERY)
  // The filter inputs are only copied into `query` when the user applies them.
  const [draftSearch, setDraftSearch] = useState('')
  const [draftActive, setDraftActive] = useState<Query['isActive']>('')
  const [draftMain, setDraftMain] = useState<Query['isMainBranch']>('')

  const [data, setData] = useState<PagedResult<BranchDto> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)

  const canCreate = hasPermission(PERMISSIONS.branchesCreate)
  const canEdit = hasPermission(PERMISSIONS.branchesEdit)
  const canDelete = hasPermission(PERMISSIONS.branchesDelete)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await branchesApi.search({
        search: query.search || undefined,
        isActive: query.isActive === '' ? undefined : query.isActive === 'true',
        isMainBranch: query.isMainBranch === '' ? undefined : query.isMainBranch === 'true',
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        page: query.page,
        pageSize: query.pageSize,
      })
      setData(page)
      setError([])
    } catch (err) {
      setError(err instanceof ApiError ? err.messages : ['The branches could not be loaded.'])
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    // Fetching the page is exactly the "synchronize with an external system" case; load() flips the
    // loading flag before it awaits so the skeleton rows appear straight away.
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  function applyFilters() {
    setQuery((q) => ({ ...q, search: draftSearch.trim(), isActive: draftActive, isMainBranch: draftMain, page: 1 }))
  }

  function clearFilters() {
    setDraftSearch('')
    setDraftActive('')
    setDraftMain('')
    setQuery(DEFAULT_QUERY)
  }

  function toggleSort(column: BranchSortBy) {
    setQuery((q) => ({
      ...q,
      sortBy: column,
      sortDir: q.sortBy === column && q.sortDir === 'asc' ? 'desc' : 'asc',
      page: 1,
    }))
  }

  function exportCsv() {
    downloadCsv(
      'branches.csv',
      ['Branch Code', 'Branch Name', 'Address', 'Is Main Branch', 'Status'],
      (data?.items ?? []).map((b) => [
        b.branchCode,
        b.branchName,
        b.address ?? '',
        b.isMainBranch ? 'Yes' : 'No',
        b.isActive ? 'Active' : 'Inactive',
      ]),
    )
  }

  async function afterSave(message: string) {
    setDialog(null)
    showToast(message)
    await load()
  }

  async function confirmDelete(branch: BranchDto) {
    setBusy(true)
    try {
      await branchesApi.remove(branch.id)
      await afterSave('Branch deleted successfully.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REFERENCED') {
        setDialog({ kind: 'referenced', branch, message: err.messages[0] as string })
      } else {
        setDialog(null)
        showToast(err instanceof ApiError ? (err.messages[0] as string) : 'The branch could not be deleted.', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(branch: BranchDto, isActive: boolean) {
    setBusy(true)
    try {
      await branchesApi.setStatus(branch.id, isActive)
      await afterSave(isActive ? 'Branch activated.' : 'Branch deactivated.')
    } catch (err) {
      setDialog(null)
      showToast(err instanceof ApiError ? (err.messages[0] as string) : 'The branch could not be updated.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const rows = data?.items ?? []
  const filtered = query.search !== '' || query.isActive !== '' || query.isMainBranch !== ''

  return (
    <>
      <PageHeader
        title="Branches / Sites"
        subtitle="View and manage company branches / sites."
        actions={
          <>
            <MoreActionsMenu onRefresh={() => void load()} onExport={exportCsv} />
            {canCreate ? (
              <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>
                <Icon name="plus" />
                New Branch
              </button>
            ) : null}
          </>
        }
      />

      <section className="card">
        <div className="filter-row">
          <div className="search-input filter-row__search">
            <Icon name="search" />
            <input
              type="search"
              aria-label="Search branches"
              placeholder="Search by branch code or name..."
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilters()
              }}
            />
          </div>

          <select
            aria-label="Status"
            className="filter-row__select"
            value={draftActive}
            onChange={(e) => setDraftActive(e.target.value as Query['isActive'])}
          >
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>

          <select
            aria-label="Is Main Branch"
            className="filter-row__select"
            value={draftMain}
            onChange={(e) => setDraftMain(e.target.value as Query['isMainBranch'])}
          >
            <option value="">All</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>

          <button type="button" className="btn btn-ghost" onClick={clearFilters}>
            <Icon name="refresh" />
            Clear Filters
          </button>
          <button type="button" className="btn btn-ghost" onClick={applyFilters}>
            <Icon name="filter" />
            Filter
          </button>
        </div>

        <Alert kind="error" messages={error} />

        <div className="table-scroll">
          <table className="data-table branches-table">
            <thead>
              <tr>
                <th className="col-index">#</th>
                {COLUMNS.map((column) => (
                  <SortableHeader
                    key={column.key}
                    column={column.key}
                    label={column.header}
                    activeColumn={query.sortBy}
                    direction={query.sortDir}
                    onSort={toggleSort}
                  />
                ))}
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows columns={COLUMN_COUNT} />
              ) : rows.length === 0 ? (
                <EmptyRow columns={COLUMN_COUNT}>
                  No branches found.
                  {filtered ? ' Try clearing the filters to see every branch.' : ''}
                </EmptyRow>
              ) : (
                rows.map((branch, index) => (
                  <tr key={branch.id}>
                    <td className="col-index">{(query.page - 1) * query.pageSize + index + 1}</td>
                    <td className="mono">{branch.branchCode}</td>
                    <td>{branch.branchName}</td>
                    <td className="branches-table__address">{branch.address ?? <span className="muted">-</span>}</td>
                    <td>
                      <MainFlagCell isMain={branch.isMainBranch} />
                    </td>
                    <td>
                      <StatusPill isActive={branch.isActive} />
                    </td>
                    <td className="col-actions">
                      <RowActions
                        code={branch.branchCode}
                        isActive={branch.isActive}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        isProtected={branch.isMainBranch}
                        protectedDeactivateTitle="The main branch cannot be deactivated"
                        protectedDeleteTitle="The main branch cannot be deleted"
                        onEdit={() => setDialog({ kind: 'edit', branch })}
                        onToggleStatus={() => setDialog({ kind: 'status', branch })}
                        onDelete={() => setDialog({ kind: 'delete', branch })}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TableFooter
          page={query.page}
          pageSize={query.pageSize}
          totalCount={data?.totalCount ?? 0}
          totalPages={data?.totalPages ?? 0}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={(page) => setQuery((q) => ({ ...q, page }))}
          onPageSizeChange={(pageSize) => setQuery((q) => ({ ...q, pageSize, page: 1 }))}
        />
      </section>

      {dialog?.kind === 'create' ? (
        <BranchFormModal
          mode="create"
          onClose={() => setDialog(null)}
          onSaved={() => void afterSave('Branch created successfully.')}
        />
      ) : null}

      {dialog?.kind === 'edit' ? (
        <BranchFormModal
          mode="edit"
          branch={dialog.branch}
          onClose={() => setDialog(null)}
          onSaved={() => void afterSave('Branch updated successfully.')}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          title="Delete branch"
          message={`Delete branch ${dialog.branch.branchCode} - ${dialog.branch.branchName}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void confirmDelete(dialog.branch)}
        />
      ) : null}

      {dialog?.kind === 'status' ? (
        <ConfirmDialog
          title={dialog.branch.isActive ? 'Deactivate branch' : 'Activate branch'}
          message={
            dialog.branch.isActive
              ? `Deactivate ${dialog.branch.branchCode} - ${dialog.branch.branchName}? It will no longer be selectable.`
              : `Activate ${dialog.branch.branchCode} - ${dialog.branch.branchName}?`
          }
          confirmLabel={dialog.branch.isActive ? 'Deactivate' : 'Activate'}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void setStatus(dialog.branch, !dialog.branch.isActive)}
        />
      ) : null}

      {dialog?.kind === 'referenced' ? (
        <Modal
          title="Branch cannot be deleted"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void setStatus(dialog.branch, false)}
              >
                Deactivate instead
              </button>
            </>
          }
        >
          <Alert kind="error" messages={dialog.message} />
        </Modal>
      ) : null}
    </>
  )
}
