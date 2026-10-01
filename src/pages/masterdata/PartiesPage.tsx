import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Group, Paper, Select, Text, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconEye, IconFilterOff, IconPlus, IconRefresh, IconSearch, IconTableExport } from '@tabler/icons-react'
import { fetchAllPages, type AllRows } from '../../api/fetchAllPages'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import { partiesApi } from '../../api/masterdata/parties'
import type { BranchLookupDto, PartyDto, PartyTypeName } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { formatDateTime } from '../../components/format'
import { downloadCsv } from '../../components/masterdata/csv'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { useDataGrid, type GridColumnMeta } from '../../components/ui/grid/useDataGrid'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { PARTY_TYPES, partyTypesOf } from './partyTypes'
import { PartyFormModal } from './PartyFormModal'

/** The filters the reader edits. Paging and sorting are the grid's own, held by useGridQuery. */
interface Filters {
  search: string
  partyType: string | null
  branchId: string | null
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', partyType: null, branchId: null, isActive: null }

/** Below this the Phone and Branch columns are dropped; both stay in the modal. */
const NARROW = '(max-width: 768px)'

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; party: PartyDto }
  | { kind: 'view'; party: PartyDto }
  | null

export function PartiesPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const narrow = useMediaQuery(NARROW)

  const canCreate = hasPermission(PERMISSIONS.partiesCreate)
  const canEdit = hasPermission(PERMISSIONS.partiesEdit)
  const canDelete = hasPermission(PERMISSIONS.partiesDelete)

  // The Branch filter offers the active branches; a failure leaves the dropdown empty rather than
  // breaking the page, since the grid itself does not depend on it.
  useEffect(() => {
    let cancelled = false
    void branchesApi
      .lookup()
      .then((rows) => {
        if (!cancelled) setBranches(rows)
      })
      .catch(() => {
        if (!cancelled) setBranches([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * The grid's whole query. No Apply button: the search box settles 350ms after the last keystroke,
   * every other control lands at once, and the hook guarantees one request per settled state with
   * the newest one winning.
   */
  const grid = useGridQuery<Filters, PartyDto, AllRows<PartyDto>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'partyCode', direction: 'asc' },
    // The whole table comes back in one go, so turning a page or re-sorting must not ask again.
    paging: 'client',
    errorMessage: 'The parties could not be loaded.',
    fetcher: useCallback(
      ({ filters, signal }) =>
        fetchAllPages((page, pageSize) =>
          partiesApi.search(
            {
              search: filters.search.trim() || undefined,
              partyType: (filters.partyType as PartyTypeName | null) ?? undefined,
              branchId: numberOrUndefined(filters.branchId),
              isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
              page,
              pageSize,
            },
            signal,
          ),
        ),
      [],
    ),
  })

  const { filters, setFilter, data, loading, error } = grid
  const load = grid.reload
  const rows = useMemo(() => data?.items ?? [], [data])

  /* THE ENGINE HOLDS THE WHOLE TABLE AND ANSWERS FOR EVERY COLUMN: typed filters, multi-column sort,
     paging, footer totals over all the filtered rows, CSV. The bar above the grid still narrows what
     is loaded from the server; the column filters then narrow what was loaded. */
  const engine = useDataGrid({
    rows,
    columns: GRID_COLUMNS,
    storeKey: 'masterdata.parties',
    sort: [{ accessor: 'partyCode', direction: 'asc' }],
  })

  // A filter that leaves three rows must not strand the reader on page 4 of the old result.
  // A string rather than a keyof: Party Type is a column without a field behind it.

  function exportCsv() {
    downloadCsv(
      'parties.csv',
      ['Party Code', 'Party Name', 'Party Type', 'Phone', 'Email', 'Branch', 'Status', 'Created'],
      // What the reader is looking at, funnels and all - not the whole table behind them.
      engine.rows.map((p) => [
        p.partyCode,
        p.partyName,
        partyTypesOf(p)
          .map((t) => t.label)
          .join(' / '),
        p.phone ?? '',
        p.email ?? '',
        p.branchName ?? '',
        p.isActive ? 'Active' : 'Inactive',
        formatDateTime(p.createdAtUtc),
      ]),
    )
  }

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function handleDelete(party: PartyDto) {
    const confirmed = await confirm({
      title: 'Delete party',
      message: `Delete party ${party.partyCode} - ${party.partyName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await partiesApi.remove(party.id)
      await afterSave('Party deleted successfully.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REFERENCED') {
        const deactivate = await confirm({
          title: 'Party cannot be deleted',
          message: err.messages[0] as string,
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) await setStatus(party, false)
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The party could not be deleted.')
    }
  }

  async function setStatus(party: PartyDto, isActive: boolean) {
    try {
      await partiesApi.setStatus(party.id, isActive)
      await afterSave(isActive ? 'Party activated.' : 'Party deactivated.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONCURRENCY') {
        notify.error(err.messages[0] as string)
        await load()
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The party could not be updated.')
    }
  }

  async function handleToggleStatus(party: PartyDto) {
    const activating = !party.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate party' : 'Deactivate party',
      message: activating
        ? `Activate ${party.partyCode} - ${party.partyName}?`
        : `Deactivate ${party.partyCode} - ${party.partyName}? It will no longer be selectable.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (confirmed) await setStatus(party, activating)
  }

  const columns: DataTableColumn<PartyDto>[] = [
    rowNumberColumn<PartyDto>(engine.page, engine.pageSize),
    /* Party Code, Party Name and Email carry no header funnel: this grid pages on the server and
       the search endpoint takes one free-text parameter matching code, name, phone, mobile OR
       e-mail, so a box on any one of those headers could only narrow by something other than the
       column it sits on. The filter bar's search box is that parameter, under its own name. */
    {
      accessor: 'partyCode',
      title: 'Party Code',
      width: 130,
      render: (p) => <Text fw={600}>{p.partyCode}</Text>,
    },
    {
      accessor: 'partyName',
      title: 'Party Name',
      width: 190,
    },
    {
      accessor: 'partyType',
      title: 'Party Type',
      // Sorts on the joined text the badges read as, so parties group by their first type.
      // A party may hold several types, so the cell is a set of badges. The funnel matches the
      // joined text rather than offering combinations, and the tick list is built from what the
      // rows actually hold.
      width: 190,
      render: (p) => {
        const types = partyTypesOf(p)
        if (types.length === 0) return <Text c="dimmed">—</Text>
        return (
          <Group gap={4} wrap="wrap">
            {types.map((t) => (
              <Badge key={t.value} size="sm" color={t.color} variant="light">
                {t.label}
              </Badge>
            ))}
          </Group>
        )
      },
    },
    ...(narrow
      ? []
      : [
          {
            accessor: 'phone',
            title: 'Phone',
            width: 130,
            // No tick list: a phone number is very nearly one value per row.
            render: (p: PartyDto) => p.phone ?? <Text c="dimmed">—</Text>,
          } satisfies DataTableColumn<PartyDto>,
        ]),
    {
      accessor: 'email',
      title: 'Email',
      // No tick list: an e-mail is one value per row.
      // No width: it takes whatever the fixed columns leave.
      render: (p) => p.email ?? <Text c="dimmed">—</Text>,
    },
    ...(narrow
      ? []
      : [
          {
            accessor: 'branchName',
            title: 'Branch',
            width: 150,
            // The funnel is single-select: the API filters by one branch id, and a list that let
            // three be ticked and then sent one would be lying about what it did.
            render: (p: PartyDto) => p.branchName ?? <Text c="dimmed">—</Text>,
          } satisfies DataTableColumn<PartyDto>,
        ]),
    {
      accessor: 'isActive',
      title: 'Status',
      // Caption + sort arrows + funnel all share this header, so it is wider than the pill needs.
      width: 130,
      render: (p) => <StatusBadge active={p.isActive} />,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 150,
      textAlign: 'right',
      render: (party) => (
        <RowActions
          label={party.partyCode}
          custom={[
            {
              icon: <IconEye size={17} />,
              tooltip: 'View',
              color: 'gray',
              onClick: () => setDialog({ kind: 'view', party }),
            },
          ]}
          edit={{ visible: canEdit, onClick: () => setDialog({ kind: 'edit', party }) }}
          toggleStatus={{
            visible: canEdit,
            active: party.isActive,
            onClick: () => void handleToggleStatus(party),
          }}
          remove={{ visible: canDelete, onClick: () => void handleDelete(party) }}
        />
      ),
    },
  ]

  // "Filtered" for the empty-state wording: it should say "try clearing the filters" only when
  // there are filters to clear.
  const filtered = !grid.isDefault

  return (
    <>
      <PageHeader
        title="Parties"
        subtitle="View and manage suppliers, clients, salesmen and employees."
        actions={
          <>
            <MoreActionsMenu
              actions={[
                { label: 'Refresh', icon: <IconRefresh size={16} />, onClick: () => void load() },
                { label: 'Export CSV', icon: <IconTableExport size={16} />, onClick: exportCsv },
              ]}
            />
            {canCreate ? (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
                New Party
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={4}>
          <TextInput
            placeholder="Search by party code, name, phone or email..."
            leftSection={<IconSearch size={16} />}
            label="Search"
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
            // Enter sends what is typed now instead of waiting out the debounce.
            onKeyDown={(e) => {
              if (e.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            label="Party type"
            placeholder="All types"
            data={PARTY_TYPE_OPTIONS}
            value={filters.partyType}
            onChange={(value) => setFilter('partyType', value)}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={3}>
          <Select
            label="Branch"
            placeholder="All branches"
            data={branches.map((b) => ({ value: String(b.id), label: branchLabel(b) }))}
            value={filters.branchId}
            onChange={(value) => setFilter('branchId', value)}
            searchable
            clearable
            nothingFoundMessage="No branch found"
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            label="Status"
            placeholder="All"
            data={STATUS_OPTIONS}
            value={filters.isActive}
            onChange={(value) => setFilter('isActive', value)}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={3}>
          <Button
            variant="default"
            leftSection={<IconFilterOff size={16} />}
            onClick={grid.clearFilters}
            disabled={grid.isDefault}
          >
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load parties">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<PartyDto>
          storeKey="masterdata.parties"
          engine={engine}
          exportFileName="parties"
          columns={columns}
          fetching={loading}
          // Enter on the selected row does what its first icon does: open the record. A reader who
          // may edit lands in the editable form, everyone else in the read-only one.
          onRowActivate={({ record }) =>
            setDialog(canEdit ? { kind: 'edit', party: record } : { kind: 'view', party: record })
          }
          noRecordsText={
            filtered ? 'No parties found. Try clearing the filters to see every party.' : 'No parties found.'
          }
        />
      </Paper>

      {dialog ? (
        <PartyFormModal
          mode={dialog.kind}
          party={dialog.kind === 'create' ? undefined : dialog.party}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(dialog.kind === 'create' ? 'Party created successfully.' : 'Party updated successfully.')
          }
        />
      ) : null}
    </>
  )
}

const STATUS_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
]

const PARTY_TYPE_OPTIONS = PARTY_TYPES.map((t) => ({ value: t.value, label: t.label }))

/**
 * What each column SHOWS for a party - the text its header filter matches and its funnel lists.
 * A party may hold several types, so Party Type is matched against the badges joined together.
 */
/**
 * What each column IS, for the grid engine: its kind (so a number compares as a number and a date
 * as a date), and what it shows. How a cell LOOKS stays in the column definitions below.
 */
const GRID_COLUMNS: GridColumnMeta<PartyDto>[] = [
  { accessor: 'partyCode', summary: 'count' },
  { accessor: 'partyName' },
  { accessor: 'partyType', text: (p) => partyTypesOf(p).map((t) => t.label).join(', ') },
  { accessor: 'phone', text: (p) => p.phone ?? '' },
  { accessor: 'email', text: (p) => p.email ?? '' },
  { accessor: 'branchName', text: (p) => p.branchName ?? '' },
  { accessor: 'isActive', kind: 'boolean', text: (p) => (p.isActive ? 'Active' : 'Inactive') },
]

function branchLabel(branch: BranchLookupDto): string {
  return `${branch.branchCode} - ${branch.branchName}`
}

function numberOrUndefined(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
