import { useCallback, useState } from 'react'
import { Alert, Badge, Button, Paper, Select, Text, TextInput } from '@mantine/core'
import { IconFilterOff, IconPlus, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  allocationMethodLabel,
  chargeTypesApi,
  CHARGE_ALLOCATION_METHODS,
  type ChargeTypeDto,
} from '../../api/purchase/chargeTypes'
import { useAuth } from '../../auth/useAuth'
import { formatNumber } from '../../components/format'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { ChargeTypeFormModal } from './ChargeTypeFormModal'

/** The filters the reader edits. Paging and sorting are the grid's own, held by useGridQuery. */
interface Filters {
  search: string
  allocationMethod: string | null
  includeInLandedCost: string | null
  isActive: string | null
}

const NO_FILTERS: Filters = { search: '', allocationMethod: null, includeInLandedCost: null, isActive: null }

type Dialog = { kind: 'create' } | { kind: 'edit'; chargeType: ChargeTypeDto } | null

export function ChargeTypesPage() {
  const { hasPermission } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)

  // One permission covers the whole page: charge types are setup, and the reader who may see them
  // is the reader who maintains them. The lookup the charge lines use is open to everyone.
  const canManage = hasPermission(PERMISSIONS.chargeTypesManage)

  /**
   * The grid's whole query. No Apply button: the search box settles 350ms after the last keystroke,
   * every other control lands at once, and the hook guarantees one request per settled state with
   * the newest one winning.
   */
  const grid = useGridQuery<Filters, ChargeTypeDto, Awaited<ReturnType<typeof chargeTypesApi.list>>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'chargeCode', direction: 'asc' },
    paging: 'server',
    errorMessage: 'The charge types could not be loaded.',
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        chargeTypesApi.list(
          {
            search: filters.search.trim() || undefined,
            allocationMethod: filters.allocationMethod ?? undefined,
            includeInLandedCost:
              filters.includeInLandedCost === null ? undefined : filters.includeInLandedCost === 'true',
            isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
            sortBy: ACCESSOR_TO_SORT[sortStatus.columnAccessor as string] ?? 'ChargeCode',
            sortDir: sortStatus.direction,
            page,
            pageSize,
          },
          signal,
        ),
      [],
    ),
  })

  const { filters, setFilter, data, loading, error } = grid
  const load = grid.reload

  async function afterSave(message: string) {
    setDialog(null)
    notify.success(message)
    await load()
  }

  async function setStatus(chargeType: ChargeTypeDto, isActive: boolean) {
    try {
      await chargeTypesApi.setActive(chargeType.id, isActive, chargeType.rowVersion)
      await afterSave(isActive ? 'Charge type activated.' : 'Charge type deactivated.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONCURRENCY') {
        notify.error(err.messages[0] as string)
        await load()
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The charge type could not be updated.')
    }
  }

  async function handleToggleStatus(chargeType: ChargeTypeDto) {
    const activating = !chargeType.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate charge type' : 'Deactivate charge type',
      message: activating
        ? `Activate ${chargeType.chargeCode} - ${chargeType.chargeName}?`
        : `Deactivate ${chargeType.chargeCode} - ${chargeType.chargeName}? It will no longer be offered on a ` +
          'charge line.',
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (confirmed) await setStatus(chargeType, activating)
  }

  async function handleDelete(chargeType: ChargeTypeDto) {
    const confirmed = await confirm({
      title: 'Delete charge type',
      message: `Delete charge type ${chargeType.chargeCode} - ${chargeType.chargeName}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    try {
      await chargeTypesApi.remove(chargeType.id)
      await afterSave('Charge type deleted successfully.')
    } catch (err) {
      // The icon is already disabled for a type in use, so IN_USE only reaches here when the row in
      // hand is out of date - somebody charged it since this page was loaded. Offer the way out.
      if (err instanceof ApiError && err.code === 'IN_USE') {
        const deactivate = await confirm({
          title: 'Charge type cannot be deleted',
          message: err.messages[0] as string,
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) await setStatus(chargeType, false)
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The charge type could not be deleted.')
    }
  }

  const columns: DataTableColumn<ChargeTypeDto>[] = [
    rowNumberColumn<ChargeTypeDto>(grid.page, grid.pageSize),
    /* No header funnels on this grid: it pages on the server, and the endpoint takes one free-text
       parameter matching code OR name, so a box on the Charge Code header could only narrow by
       something other than the column it sits on. Every parameter the API does take is in the
       filter bar under its own name. See docs/frontend-conventions.md. */
    {
      accessor: 'chargeCode',
      title: 'Charge Code',
      sortable: true,
      width: 130,
      render: (c) => (
        <Text fw={600} fz="sm">
          {c.chargeCode}
        </Text>
      ),
    },
    { accessor: 'chargeName', title: 'Charge Name', sortable: true, width: 200 },
    {
      accessor: 'allocationMethod',
      title: 'Allocation Method',
      sortable: true,
      width: 170,
      render: (c) => allocationMethodLabel(c.allocationMethod),
    },
    {
      accessor: 'includeInLandedCost',
      title: 'Include in Landed Cost',
      width: 180,
      render: (c) => <YesNo value={c.includeInLandedCost} />,
    },
    {
      accessor: 'isRecoverableTax',
      title: 'Recoverable Tax',
      width: 150,
      render: (c) => <YesNo value={c.isRecoverableTax} />,
    },
    {
      accessor: 'isActive',
      title: 'Status',
      sortable: true,
      width: 120,
      render: (c) => <StatusBadge active={c.isActive} />,
    },
    {
      accessor: 'description',
      title: 'Description',
      // No width: it takes whatever the fixed columns leave, so the grid fits a laptop.
      render: (c) =>
        c.description ? (
          <Text fz="sm" c="dimmed" lineClamp={2}>
            {c.description}
          </Text>
        ) : (
          <Text c="dimmed">—</Text>
        ),
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      render: (chargeType) => (
        <RowActions
          label={chargeType.chargeCode}
          edit={{ visible: canManage, onClick: () => setDialog({ kind: 'edit', chargeType }) }}
          toggleStatus={{
            visible: canManage,
            active: chargeType.isActive,
            onClick: () => void handleToggleStatus(chargeType),
          }}
          remove={{
            visible: canManage,
            // A charge type that has been used is history, not a mistake: the icon stays where the
            // reader expects it and says why it cannot be pressed, rather than vanishing and
            // leaving them hunting for a delete that is simply not there on this row.
            disabled: !chargeType.canDelete,
            disabledReason: `Used in ${formatNumber(chargeType.usageCount)} transactions - deactivate instead`,
            onClick: () => void handleDelete(chargeType),
          }}
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
        title="Charge Types"
        subtitle="Maintain purchase related charge types and allocation rules"
        actions={
          canManage ? (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'create' })}>
              New Charge Type
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput
            placeholder="Charge code or name"
            leftSection={<IconSearch size={16} />}
            aria-label="Search"
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
            // Enter sends what is typed now instead of waiting out the debounce.
            onKeyDown={(e) => {
              if (e.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>

        {/* Every one of these offers "All" as the empty state: a cleared dropdown is the filter
            being off, which is the same thing and one fewer row in each list. */}
        <FilterBar.Col span={2}>
          <Select
            aria-label="Allocation method"
            placeholder="All"
            data={ALLOCATION_OPTIONS}
            value={filters.allocationMethod}
            onChange={(value) => setFilter('allocationMethod', value)}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={3}>
          <Select
            aria-label="Cost impact"
            placeholder="All"
            data={COST_IMPACT_OPTIONS}
            value={filters.includeInLandedCost}
            onChange={(value) => setFilter('includeInLandedCost', value)}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            aria-label="Status"
            placeholder="All"
            data={STATUS_OPTIONS}
            value={filters.isActive}
            onChange={(value) => setFilter('isActive', value)}
            clearable
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
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
        <Alert color="red" mb="md" title="Could not load charge types">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<ChargeTypeDto>
          storeKey="purchase.chargeTypes"
          records={data?.items ?? []}
          columns={columns}
          totalRecords={data?.totalCount ?? 0}
          page={grid.page}
          recordsPerPage={grid.pageSize}
          onPageChange={grid.setPage}
          onRecordsPerPageChange={grid.setPageSize}
          sortStatus={grid.sortStatus}
          onSortStatusChange={grid.setSortStatus}
          fetching={loading}
          // Enter on the selected row does what its pencil does.
          onRowActivate={canManage ? ({ record }) => setDialog({ kind: 'edit', chargeType: record }) : undefined}
          noRecordsText={
            filtered
              ? 'No charge types found. Try clearing the filters to see every charge type.'
              : 'No charge types found.'
          }
        />
      </Paper>

      {dialog ? (
        <ChargeTypeFormModal
          mode={dialog.kind}
          chargeType={dialog.kind === 'edit' ? dialog.chargeType : undefined}
          onClose={() => setDialog(null)}
          onSaved={() =>
            void afterSave(
              dialog.kind === 'create' ? 'Charge type created successfully.' : 'Charge type updated successfully.',
            )
          }
        />
      ) : null}
    </>
  )
}

/** The two boolean columns read as pills so a scan down them is a scan down one colour. */
function YesNo({ value }: { value: boolean }) {
  return (
    <Badge variant="light" color={value ? 'green' : 'gray'}>
      {value ? 'Yes' : 'No'}
    </Badge>
  )
}

const ALLOCATION_OPTIONS = CHARGE_ALLOCATION_METHODS.map((method) => ({
  value: method,
  label: allocationMethodLabel(method),
}))

/** "Cost impact" in the reader's words: `includeInLandedCost` is what the API calls the same thing. */
const COST_IMPACT_OPTIONS = [
  { value: 'true', label: 'Included in landed cost' },
  { value: 'false', label: 'Not included' },
]

const STATUS_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
]

/** Grid accessor -> the name the search procedure sorts by. */
const ACCESSOR_TO_SORT: Record<string, string> = {
  chargeCode: 'ChargeCode',
  chargeName: 'ChargeName',
  allocationMethod: 'AllocationMethod',
  isActive: 'IsActive',
  createdAtUtc: 'CreatedAtUtc',
}
