import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BranchLookupDto, PagedResult, WarehouseDto, WarehouseSortBy } from '../../api/types'
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
import { branchLabel } from '../../components/format'
import { WarehouseFormModal } from './WarehouseFormModal'

/** Everything that decides which rows the API returns. */
interface Query {
  search: string
  branchId: string
  isActive: '' | 'true' | 'false'
  isMainWarehouse: '' | 'true' | 'false'
  sortBy: WarehouseSortBy
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

const DEFAULT_QUERY: Query = {
  search: '',
  branchId: '',
  isActive: '',
  isMainWarehouse: '',
  sortBy: 'WarehouseCode',
  sortDir: 'asc',
  page: 1,
  pageSize: PAGE_SIZE_DEFAULT,
}

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; warehouse: WarehouseDto }
  | { kind: 'delete'; warehouse: WarehouseDto }
  | { kind: 'status'; warehouse: WarehouseDto }
  | { kind: 'referenced'; warehouse: WarehouseDto; message: string }
  | null

const COLUMNS: { key: WarehouseSortBy; header: string }[] = [
  { key: 'WarehouseCode', header: 'Warehouse Code' },
  { key: 'WarehouseName', header: 'Warehouse Name' },
  { key: 'BranchName', header: 'Branch / Site' },
  { key: 'Address', header: 'Address' },
  { key: 'IsMainWarehouse', header: 'Is Main Warehouse' },
  { key: 'IsActive', header: 'Status' },
]

const COLUMN_COUNT = COLUMNS.length + 2 // the leading "#" and the trailing "Actions"

export function WarehousesPage() {
  const { hasPermission } = useAuth()
  const { showToast } = useToast()

  const [query, setQuery] = useState<Query>(DEFAULT_QUERY)
  // The filter inputs are only copied into `query` when the user applies them.
  const [draftSearch, setDraftSearch] = useState('')
  const [draftBranch, setDraftBranch] = useState('')
  const [draftActive, setDraftActive] = useState<Query['isActive']>('')
  const [draftMain, setDraftMain] = useState<Query['isMainWarehouse']>('')

  const [data, setData] = useState<PagedResult<WarehouseDto> | null>(null)
  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)

  const canCreate = hasPermission(PERMISSIONS.warehousesCreate)
  const canEdit = hasPermission(PERMISSIONS.warehousesEdit)
  const canDelete = hasPermission(PERMISSIONS.warehousesDelete)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await warehousesApi.search({
        search: query.search || undefined,
        branchId: query.branchId === '' ? undefined : Number(query.branchId),
        isActive: query.isActive === '' ? undefined : query.isActive === 'true',
        isMainWarehouse: query.isMainWarehouse === '' ? undefined : query.isMainWarehouse === 'true',
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        page: query.page,
        pageSize: query.pageSize,
      })
      setData(page)
      setError([])
    } catch (err) {
      setError(err instanceof ApiError ? err.messages : ['The warehouses could not be loaded.'])
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

  // Every branch, including inactive ones, so rows on a deactivated branch can still be filtered.
  useEffect(() => {
    branchesApi
      .lookup(false)
      .then(setBranches)
      .catch(() => {
        // Not fatal: the filter simply offers "All" until the next reload.
      })
  }, [])

  function applyFilters() {
    setQuery((q) => ({
      ...q,
      search: draftSearch.trim(),
      branchId: draftBranch,
      isActive: draftActive,
      isMainWarehouse: draftMain,
      page: 1,
    }))
  }

  function clearFilters() {
    setDraftSearch('')
    setDraftBranch('')
    setDraftActive('')
    setDraftMain('')
    setQuery(DEFAULT_QUERY)
  }

  function toggleSort(column: WarehouseSortBy) {
    setQuery((q) => ({
      ...q,
      sortBy: column,
      sortDir: q.sortBy === column && q.sortDir === 'asc' ? 'desc' : 'asc',
      page: 1,
    }))
  }

  function exportCsv() {
    downloadCsv(
      'warehouses.csv',
      ['Warehouse Code', 'Warehouse Name', 'Branch / Site', 'Address', 'Is Main Warehouse', 'Status'],
      (data?.items ?? []).map((w) => [
        w.warehouseCode,
        w.warehouseName,
        `${w.branchCode} - ${w.branchName}`,
        w.address ?? '',
        w.isMainWarehouse ? 'Yes' : 'No',
        w.isActive ? 'Active' : 'Inactive',
      ]),
    )
  }

  async function afterSave(message: string) {
    setDialog(null)
    showToast(message)
    await load()
  }

  async function confirmDelete(warehouse: WarehouseDto) {
    setBusy(true)
    try {
      await warehousesApi.remove(warehouse.id)
      await afterSave('Warehouse deleted successfully.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REFERENCED') {
        setDialog({ kind: 'referenced', warehouse, message: err.messages[0] as string })
      } else {
        setDialog(null)
        showToast(err instanceof ApiError ? (err.messages[0] as string) : 'The warehouse could not be deleted.', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(warehouse: WarehouseDto, isActive: boolean) {
    setBusy(true)
    try {
      await warehousesApi.setStatus(warehouse.id, isActive)
      await afterSave(isActive ? 'Warehouse activated.' : 'Warehouse deactivated.')
    } catch (err) {
      setDialog(null)
      showToast(err instanceof ApiError ? (err.messages[0] as string) : 'The warehouse could not be updated.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const rows = data?.items ?? []
  const filtered =
    query.search !== '' || query.branchId !== '' || query.isActive !== '' || query.isMainWarehouse !== ''

  return (
    <>
      <PageHeader
        title="Warehouses"
        subtitle="View and manage warehouses."
        actions={
          <>
            <MoreActionsMenu onRefresh={() => void load()} onExport={exportCsv} />
            {canCreate ? (
              <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>
                <Icon name="plus" />
                New Warehouse
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
              aria-label="Search warehouses"
              placeholder="Search by warehouse code or name..."
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilters()
              }}
            />
          </div>

          <select
            aria-label="Branch / Site"
            className="filter-row__select"
            value={draftBranch}
            onChange={(e) => setDraftBranch(e.target.value)}
          >
            <option value="">All</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branchLabel(branch)}
              </option>
            ))}
          </select>

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
            aria-label="Is Main Warehouse"
            className="filter-row__select"
            value={draftMain}
            onChange={(e) => setDraftMain(e.target.value as Query['isMainWarehouse'])}
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
          <table className="data-table branches-table warehouses-table">
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
                  No warehouses found.
                  {filtered ? ' Try clearing the filters to see every warehouse.' : ''}
                </EmptyRow>
              ) : (
                rows.map((warehouse, index) => (
                  <tr key={warehouse.id}>
                    <td className="col-index">{(query.page - 1) * query.pageSize + index + 1}</td>
                    <td className="mono">{warehouse.warehouseCode}</td>
                    <td>{warehouse.warehouseName}</td>
                    <td title={warehouse.branchCode}>{warehouse.branchName}</td>
                    <td className="branches-table__address">{warehouse.address ?? <span className="muted">-</span>}</td>
                    <td>
                      <MainFlagCell isMain={warehouse.isMainWarehouse} />
                    </td>
                    <td>
                      <StatusPill isActive={warehouse.isActive} />
                    </td>
                    <td className="col-actions">
                      <RowActions
                        code={warehouse.warehouseCode}
                        isActive={warehouse.isActive}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        isProtected={warehouse.isMainWarehouse}
                        protectedDeactivateTitle="The main warehouse cannot be deactivated"
                        protectedDeleteTitle="The main warehouse cannot be deleted"
                        onEdit={() => setDialog({ kind: 'edit', warehouse })}
                        onToggleStatus={() => setDialog({ kind: 'status', warehouse })}
                        onDelete={() => setDialog({ kind: 'delete', warehouse })}
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
        <WarehouseFormModal
          mode="create"
          onClose={() => setDialog(null)}
          onSaved={() => void afterSave('Warehouse created successfully.')}
        />
      ) : null}

      {dialog?.kind === 'edit' ? (
        <WarehouseFormModal
          mode="edit"
          warehouse={dialog.warehouse}
          onClose={() => setDialog(null)}
          onSaved={() => void afterSave('Warehouse updated successfully.')}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          title="Delete warehouse"
          message={`Delete warehouse ${dialog.warehouse.warehouseCode} - ${dialog.warehouse.warehouseName}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void confirmDelete(dialog.warehouse)}
        />
      ) : null}

      {dialog?.kind === 'status' ? (
        <ConfirmDialog
          title={dialog.warehouse.isActive ? 'Deactivate warehouse' : 'Activate warehouse'}
          message={
            dialog.warehouse.isActive
              ? `Deactivate ${dialog.warehouse.warehouseCode} - ${dialog.warehouse.warehouseName}? It will no longer be selectable.`
              : `Activate ${dialog.warehouse.warehouseCode} - ${dialog.warehouse.warehouseName}?`
          }
          confirmLabel={dialog.warehouse.isActive ? 'Deactivate' : 'Activate'}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void setStatus(dialog.warehouse, !dialog.warehouse.isActive)}
        />
      ) : null}

      {dialog?.kind === 'referenced' ? (
        <Modal
          title="Warehouse cannot be deleted"
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
                onClick={() => void setStatus(dialog.warehouse, false)}
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
