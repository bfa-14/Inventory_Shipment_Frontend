import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Alert, Anchor, Badge, Button, Group, Paper, Select, Text, TextInput } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconEye, IconFileExport, IconFilterOff, IconPlus, IconSearch, IconSend } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  CHARGE_STATUSES,
  chargeStatusColour,
  containerChargesApi,
  type ChargeStatusCode,
  type ContainerChargeListDto,
  type ContainerChargePageDto,
  type ContainerChargeQuery,
} from '../../api/logistics/containerCharges'
import { containersApi } from '../../api/logistics/containers'
import { movementsApi } from '../../api/logistics/movements'
import { currenciesApi } from '../../api/masterdata/currencies'
import { partiesApi } from '../../api/masterdata/parties'
import { allocationMethodLabel, chargeTypesApi } from '../../api/purchase/chargeTypes'
import { useAuth } from '../../auth/useAuth'
import { BulkActionsBar } from '../../components/documents/BulkActionsBar'
import { dateLabel, isoDate } from '../../components/documents/documentKind'
import { formatMoney, formatNumber } from '../../components/format'
import { ChargeDrawer } from '../../components/logistics/ChargeDrawer'
import { NewChargeModal } from '../../components/logistics/NewChargeModal'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { useBulkSelection } from '../../hooks/useBulkSelection'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'

export const CONTAINER_CHARGES_ROUTE = '/logistics/container-charges'

const CONTAINERS_ROUTE = '/logistics/containers'
const MOVEMENTS_ROUTE = '/logistics/movements'

interface Filters {
  search: string
  containerId: string | null
  movementId: string | null
  chargeTypeId: string | null
  providerId: string | null
  status: string | null
  dateFrom: string | null
  dateTo: string | null
}

const NO_FILTERS: Filters = {
  search: '',
  containerId: null,
  movementId: null,
  chargeTypeId: null,
  providerId: null,
  status: null,
  dateFrom: null,
  dateTo: null,
}

const ACCESSOR_TO_SORT: Record<string, string> = {
  chargeDate: 'ChargeDate',
  containerRef: 'ContainerRef',
  chargeName: 'ChargeName',
  amountBase: 'AmountBase',
  status: 'Status',
}

type Option = { value: string; label: string }

function toQuery(filters: Filters): ContainerChargeQuery {
  const id = (value: string | null) => (value === null ? undefined : Number(value))
  return {
    search: filters.search.trim() || undefined,
    containerId: id(filters.containerId),
    movementId: id(filters.movementId),
    chargeTypeId: id(filters.chargeTypeId),
    providerPartyId: id(filters.providerId),
    status: filters.status === null ? undefined : (Number(filters.status) as ChargeStatusCode),
    dateFrom: filters.dateFrom ?? undefined,
    dateTo: filters.dateTo ?? undefined,
  }
}

/**
 * Every container charge — freight, clearing, insurance — across the containers. A charge typed for
 * several containers is one row per container. The total under the grid is the whole filter's, from
 * the server, not the sum of the page. Ticked drafts are posted together, all or nothing.
 */
export function ContainerChargesPage() {
  const { hasPermission } = useAuth()
  const canCreate = hasPermission(PERMISSIONS.containerChargesCreate)
  const canPost = hasPermission(PERMISSIONS.containerChargesPost)

  const [containers, setContainers] = useState<Option[]>([])
  const [movements, setMovements] = useState<Option[]>([])
  const [chargeTypes, setChargeTypes] = useState<Option[]>([])
  const [providers, setProviders] = useState<Option[]>([])
  const [baseCode, setBaseCode] = useState('USD')
  const [openId, setOpenId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)

  const selection = useBulkSelection<ContainerChargeListDto>()

  const grid = useGridQuery<Filters, ContainerChargeListDto, ContainerChargePageDto>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'chargeDate', direction: 'desc' },
    errorMessage: 'The container charges could not be loaded.',
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        containerChargesApi.list(
          {
            ...toQuery(filters),
            sortBy: ACCESSOR_TO_SORT[sortStatus.columnAccessor as string] ?? 'ChargeDate',
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

  useEffect(() => {
    containersApi
      .list({ pageSize: 200, sortBy: 'ContainerRef', sortDir: 'desc' })
      .then((r) => setContainers(r.items.map((c) => ({ value: String(c.id), label: c.containerNo ? `${c.containerRef} (${c.containerNo})` : c.containerRef }))))
      .catch(() => {})
    movementsApi
      .list({ pageSize: 200 })
      .then((r) => setMovements(r.items.map((m) => ({ value: String(m.id), label: `${m.movementNo} - ${m.typeName}` }))))
      .catch(() => {})
    chargeTypesApi
      .lookup(false)
      .then((types) => setChargeTypes(types.map((t) => ({ value: String(t.id), label: `${t.chargeCode} - ${t.chargeName}` }))))
      .catch(() => {})
    partiesApi
      .lookup({ partyType: 'Supplier', activeOnly: false })
      .then((parties) => setProviders(parties.map((p) => ({ value: String(p.id), label: `${p.partyCode} - ${p.partyName}` }))))
      .catch(() => {})
    currenciesApi
      .lookup(false)
      .then((list) => {
        const base = list.find((c) => c.isBaseCurrency)
        if (base) setBaseCode(base.currencyCode)
      })
      .catch(() => {})
  }, [])

  const reload = grid.reload

  const changed = useCallback(() => {
    reload()
  }, [reload])

  async function bulkPost() {
    const count = selection.ids.length
    if (count === 0) return
    const go = await confirm({
      title: 'Post selected charges',
      message: `Post ${formatNumber(count)} ${count === 1 ? 'charge' : 'charges'}? All of them are posted, or none if one is refused.`,
      confirmLabel: 'Post',
    })
    if (!go) return
    setBulkBusy(true)
    try {
      await containerChargesApi.postMany(selection.ids)
      notify.success(`${formatNumber(count)} ${count === 1 ? 'charge' : 'charges'} posted.`)
      selection.clear()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The charges could not be posted.')
    } finally {
      setBulkBusy(false)
      reload()
    }
  }

  async function postOne(row: ContainerChargeListDto) {
    const go = await confirm({
      title: 'Post charge',
      message:
        row.containerStatus === 6
          ? `Post ${row.chargeName} on ${row.containerRef}? The container is offloaded: the item costs will be adjusted.`
          : `Post ${row.chargeName} on ${row.containerRef}? It is locked once posted.`,
      confirmLabel: 'Post',
    })
    if (!go) return
    try {
      await containerChargesApi.post(row.id, row.rowVersion)
      notify.success('Charge posted.')
      selection.removeIds([row.id])
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The charge could not be posted.')
    }
    reload()
  }

  async function remove(row: ContainerChargeListDto) {
    const go = await confirm({
      title: 'Delete draft',
      message: `Delete the ${row.chargeName} draft on ${row.containerRef}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    try {
      await containerChargesApi.remove(row.id)
      notify.success('Draft deleted.')
      selection.removeIds([row.id])
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The draft could not be deleted.')
    }
    reload()
  }

  async function exportToExcel() {
    try {
      await containerChargesApi.exportToExcel(toQuery(filters))
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The charges could not be exported.')
    }
  }

  const columns: DataTableColumn<ContainerChargeListDto>[] = [
      rowNumberColumn<ContainerChargeListDto>(grid.page, grid.pageSize),
      { accessor: 'chargeDate', title: 'Date', width: 110, sortable: true, render: (row) => dateLabel(row.chargeDate) },
      {
        accessor: 'containerRef',
        title: 'Container',
        width: 160,
        sortable: true,
        render: (row) => (
          <Anchor component={Link} to={`${CONTAINERS_ROUTE}/${row.containerId}`} fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
            {row.containerRef}
          </Anchor>
        ),
      },
      {
        accessor: 'movementNo',
        title: 'Movement',
        width: 170,
        render: (row) =>
          row.movementId ? (
            <Anchor component={Link} to={`${MOVEMENTS_ROUTE}/${row.movementId}`} fz="sm" style={{ whiteSpace: 'nowrap' }}>
              {row.movementNo ?? `#${row.movementId}`}
            </Anchor>
          ) : (
            '—'
          ),
      },
      {
        accessor: 'chargeName',
        title: 'Charge type',
        width: 190,
        sortable: true,
        render: (row) => (
          <div>
            <Text fz="sm" fw={500}>{row.chargeName}</Text>
            <Text fz="xs" c="dimmed">
              {row.chargeCode}
              {row.groupSize > 1 ? ` · 1 of ${formatNumber(row.groupSize)}` : ''}
            </Text>
          </div>
        ),
      },
      { accessor: 'description', title: 'Description', width: 180, render: (row) => row.description ?? '—' },
      { accessor: 'providerName', title: 'Provider', width: 170, render: (row) => row.providerName ?? '—' },
      { accessor: 'reference', title: 'Reference', width: 130, render: (row) => row.reference ?? '—' },
      {
        accessor: 'amount',
        title: 'Amount',
        width: 150,
        textAlign: 'right',
        render: (row) => <Text fz="sm" style={{ whiteSpace: 'nowrap' }}>{formatMoney(row.amount, row.currencyCode)}</Text>,
      },
      {
        accessor: 'amountBase',
        title: `Amount (${baseCode})`,
        width: 140,
        textAlign: 'right',
        sortable: true,
        render: (row) => <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{formatNumber(row.amountBase, 2)}</Text>,
      },
      { accessor: 'allocationMethod', title: 'Method', width: 140, render: (row) => allocationMethodLabel(row.allocationMethod) },
      { accessor: 'includeInLandedCost', title: 'In cost', width: 80, render: (row) => (row.includeInLandedCost ? 'Yes' : 'No') },
      {
        accessor: 'status',
        title: 'Status',
        width: 170,
        sortable: true,
        render: (row) => (
          <Group gap={4} wrap="nowrap">
            <Badge variant="light" color={chargeStatusColour(row.status)}>{row.statusName}</Badge>
            {row.adjustedAfterOffload && <Badge variant="light" color="orange" size="xs">after offload</Badge>}
          </Group>
        ),
      },
      { accessor: 'attachmentCount', title: 'Documents', width: 100, textAlign: 'center', render: (row) => formatNumber(row.attachmentCount) },
      {
        accessor: 'actions',
        title: 'Actions',
        width: 130,
        textAlign: 'right',
        render: (row) => (
          <RowActions
            label={`${row.chargeName} on ${row.containerRef}`}
            custom={[
              { icon: <IconEye size={16} />, tooltip: 'Open', onClick: () => setOpenId(row.id) },
              { icon: <IconSend size={16} />, tooltip: 'Post', visible: canPost && row.canPost, onClick: () => void postOne(row) },
            ]}
            remove={{ visible: canCreate && row.canDelete, onClick: () => void remove(row) }}
          />
        ),
      },
  ]

  return (
    <div>
      <PageHeader
        title="Container Charges"
        subtitle="Freight, clearing, insurance… on the containers: the real cost of every item."
        actions={
          <>
            <MoreActionsMenu actions={[{ label: 'Export to Excel', icon: <IconFileExport size={16} />, onClick: () => void exportToExcel() }]} />
            {canCreate ? (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>
                New charge
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput
            label="Search"
            placeholder="Container, charge, provider or reference"
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(event) => setFilter('search', event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select label="Container" placeholder="All containers" data={containers} value={filters.containerId} onChange={(next) => setFilter('containerId', next)} clearable searchable nothingFoundMessage="No container matches" />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select label="Movement" placeholder="All movements" data={movements} value={filters.movementId} onChange={(next) => setFilter('movementId', next)} clearable searchable nothingFoundMessage="No movement matches" />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select label="Charge type" placeholder="All types" data={chargeTypes} value={filters.chargeTypeId} onChange={(next) => setFilter('chargeTypeId', next)} clearable searchable nothingFoundMessage="No charge type matches" />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select label="Provider" placeholder="All providers" data={providers} value={filters.providerId} onChange={(next) => setFilter('providerId', next)} clearable searchable nothingFoundMessage="No provider matches" />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Status"
            placeholder="All"
            data={CHARGE_STATUSES.map((s) => ({ value: String(s.value), label: s.label }))}
            value={filters.status}
            onChange={(next) => setFilter('status', next)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date from"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateFrom ? new Date(filters.dateFrom) : null}
            onChange={(next) => setFilter('dateFrom', next ? isoDate(new Date(next)) : null)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <DateInput
            label="Date to"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            value={filters.dateTo ? new Date(filters.dateTo) : null}
            onChange={(next) => setFilter('dateTo', next ? isoDate(new Date(next)) : null)}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Button variant="default" fullWidth mt={25} leftSection={<IconFilterOff size={16} />} disabled={grid.isDefault} onClick={grid.clearFilters}>
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error && (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      )}

      <BulkActionsBar
        count={selection.ids.length}
        canPost={canPost}
        canDelete={false}
        busy={bulkBusy}
        onPost={() => void bulkPost()}
        onDelete={() => {}}
        onClear={selection.clear}
      />

      <Paper radius="lg" withBorder>
        <DataTable
          storeKey="logistics.containerCharges"
          records={data?.items ?? []}
          columns={columns}
          {...(canPost
            ? {
                selectedRecords: selection.selected,
                onSelectedRecordsChange: selection.setSelected,
                isRecordSelectable: (row: ContainerChargeListDto) => row.status === 1 && row.canPost,
              }
            : {})}
          totalRecords={data?.totalCount ?? 0}
          page={grid.page}
          recordsPerPage={grid.pageSize}
          onPageChange={grid.setPage}
          onRecordsPerPageChange={grid.setPageSize}
          sortStatus={grid.sortStatus}
          onSortStatusChange={grid.setSortStatus}
          fetching={loading}
          noRecordsText="No container charges match the filters."
          onRowClick={({ record }) => setOpenId(record.id)}
          pinLastColumn
        />
        <Group justify="flex-end" px="md" py="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
          <Text fz="sm">
            Total (base) of the filter: <Text span fw={700}>{formatMoney(data?.totalAmountBase ?? 0, baseCode)}</Text>
          </Text>
        </Group>
      </Paper>

      <NewChargeModal opened={adding} onClose={() => setAdding(false)} onCreated={changed} />

      <ChargeDrawer chargeId={openId} onClose={() => setOpenId(null)} onChanged={changed} />
    </div>
  )
}
