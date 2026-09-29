import { useCallback, useState } from 'react'
import { Alert, Anchor, Badge, Button, Paper, Select, Text, TextInput, Tooltip } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconEye, IconFilterOff, IconPlus, IconRefresh, IconSearch, IconTableExport } from '@tabler/icons-react'
import { Link, useNavigate } from 'react-router'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import type { ItemListDto, ItemSortBy } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { downloadCsv } from '../../components/masterdata/csv'
import { formatNumber } from '../../components/format'
import { columnFilter } from '../../components/ui/columnFilter'
import { confirm } from '../../components/ui/confirm'
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable'
import { FilterBar } from '../../components/ui/FilterBar'
import { triStateFilter, triStateQuery } from '../../components/ui/gridFilters'
import { MoreActionsMenu } from '../../components/ui/MoreActionsMenu'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { RowActions } from '../../components/ui/RowActions'
import { rowNumberColumn } from '../../components/ui/rowNumberColumn'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'
import { brandLabel, familyOptions, useItemLookups, warehouseOptions } from './lookups'

/** The filters the reader edits. Paging and sorting are the grid's own, held by useGridQuery. */
interface Filters {
  search: string
  itemFamilyId: string | null
  brandId: string | null
  defaultWarehouseId: string | null
  isActive: string | null
  isBivac: string | null
}

const NO_FILTERS: Filters = {
  search: '',
  itemFamilyId: null,
  brandId: null,
  defaultWarehouseId: null,
  isActive: null,
  isBivac: null,
}

/** Below this the Family and Warehouse columns are dropped; both stay on the details page. */
const NARROW = '(max-width: 768px)'

export function ItemsPage() {
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const lookups = useItemLookups()
  const narrow = useMediaQuery(NARROW)
  /* The cost column is for the desk, not the phone: below 1024 px the row has no room for it. */
  const wide = useMediaQuery('(min-width: 1024px)')
  const [busyId, setBusyId] = useState<number | null>(null)

  const canCreate = hasPermission(PERMISSIONS.itemsCreate)
  const canEdit = hasPermission(PERMISSIONS.itemsEdit)
  const canDelete = hasPermission(PERMISSIONS.itemsDelete)

  const grid = useGridQuery<Filters, ItemListDto, Awaited<ReturnType<typeof itemsApi.search>>>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'itemCode', direction: 'asc' },
    errorMessage: 'The items could not be loaded.',
    fetcher: useCallback(
      ({ filters, page, pageSize, sortStatus, signal }) =>
        itemsApi.search(
          {
            search: filters.search.trim() || undefined,
            itemFamilyId: numberOrUndefined(filters.itemFamilyId),
            brandId: numberOrUndefined(filters.brandId),
            defaultWarehouseId: numberOrUndefined(filters.defaultWarehouseId),
            isActive: filters.isActive === null ? undefined : filters.isActive === 'true',
            isBivac: filters.isBivac === null ? undefined : filters.isBivac === 'true',
            sortBy: ACCESSOR_TO_SORT[sortStatus.columnAccessor as string] ?? 'ItemCode',
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

  function exportCsv() {
    downloadCsv(
      'items.csv',
      ['Item Code', 'Item Name', 'Family', 'Brand', 'Base Unit', 'Default Warehouse', 'BIVAC', 'On Hand', 'Status'],
      (data?.items ?? []).map((i) => [
        i.itemCode,
        i.itemName,
        i.familyName,
        i.brandName,
        i.baseUnitName ?? '',
        i.warehouseName,
        i.isBivac ? 'Yes' : 'No',
        String(i.onHand),
        i.isActive ? 'Active' : 'Inactive',
      ]),
    )
  }

  async function afterChange(message: string) {
    notify.success(message)
    await load()
  }

  async function handleDelete(item: ItemListDto) {
    const confirmed = await confirm({
      title: 'Delete item',
      message: `Delete item ${item.itemCode} - ${item.itemName}? Its units and attachments go with it. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return

    setBusyId(item.id)
    try {
      await itemsApi.remove(item.id)
      await afterChange('Item deleted successfully.')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REFERENCED') {
        const deactivate = await confirm({
          title: 'Item cannot be deleted',
          message: err.messages[0] as string,
          confirmLabel: 'Deactivate instead',
        })
        if (deactivate) await setStatus(item, false)
        return
      }
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The item could not be deleted.')
    } finally {
      setBusyId(null)
    }
  }

  async function setStatus(item: ItemListDto, isActive: boolean) {
    setBusyId(item.id)
    try {
      await itemsApi.setStatus(item.id, isActive)
      await afterChange(isActive ? 'Item activated.' : 'Item deactivated.')
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.messages[0] as string) : 'The item could not be updated.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleToggleStatus(item: ItemListDto) {
    const activating = !item.isActive
    const confirmed = await confirm({
      title: activating ? 'Activate item' : 'Deactivate item',
      message: activating
        ? `Activate ${item.itemCode} - ${item.itemName}?`
        : `Deactivate ${item.itemCode} - ${item.itemName}? It will no longer be selectable on new documents.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
    })
    if (confirmed) await setStatus(item, activating)
  }

  const columns: DataTableColumn<ItemListDto>[] = [
    rowNumberColumn<ItemListDto>(grid.page, grid.pageSize),
    {
      accessor: 'itemCode',
      title: 'Item Code',
      sortable: true,
      width: 115,
      render: (item) => (
        <Anchor
          component={Link}
          to={`/inventory/items/${item.id}`}
          fw={600}
          fz="sm"
          // The row itself navigates too; this stops the click counting twice.
          onClick={(event) => event.stopPropagation()}
        >
          {item.itemCode}
        </Anchor>
      ),
    },
    {
      accessor: 'itemName',
      title: 'Item Name',
      sortable: true,
      // No width: it takes whatever the fixed columns leave, so all eleven fit a laptop. The name
      // is the column most likely to be clipped, so it carries the tooltip that gives it back.
      render: (item) => (
        <Tooltip label={item.itemName} withArrow position="top-start" openDelay={400}>
          <Text fz="sm" lineClamp={1}>
            {item.itemName}
          </Text>
        </Tooltip>
      ),
    },
    ...(narrow
      ? []
      : [
          {
            accessor: 'familyName',
            title: 'Family',
            sortable: true,
            width: 120,
            render: (item: ItemListDto) => (
              <Tooltip label={item.familyCode} withArrow position="top-start">
                <Text fz="sm" lineClamp={1}>
                  {item.familyName}
                </Text>
              </Tooltip>
            ),
          } satisfies DataTableColumn<ItemListDto>,
        ]),
    { accessor: 'brandName', title: 'Brand', sortable: true, width: 95 },
    {
      accessor: 'baseUnitName',
      title: 'Base Unit',
      width: 90,
      render: (item) =>
        item.baseUnitName ? (
          <Tooltip label={`SKU ${item.baseUnitSku ?? '-'}`} withArrow position="top-start">
            <Text fz="sm">{item.baseUnitName}</Text>
          </Tooltip>
        ) : (
          <Tooltip label="This item has no unit yet - open it and add its base unit." withArrow position="top-start">
            <Text c="dimmed">—</Text>
          </Tooltip>
        ),
    },
    ...(narrow
      ? []
      : [
          {
            accessor: 'warehouseName',
            title: 'Default Warehouse',
            sortable: true,
            width: 130,
            render: (item: ItemListDto) => (
              <Text fz="sm" lineClamp={1}>
                {item.warehouseName}
              </Text>
            ),
          } satisfies DataTableColumn<ItemListDto>,
        ]),
    {
      accessor: 'isBivac',
      title: 'BIVAC',
      width: 80,
      ...columnFilter({
        label: 'BIVAC',
        value: triStateFilter(filters.isBivac, 'BIVAC', '—'),
        onApply: (next) => setFilter('isBivac', triStateQuery(next, 'BIVAC')),
        options: BIVAC_VALUES,
        withText: false,
      }),
      render: (item) =>
        item.isBivac ? (
          <Badge variant="light" color="orange" size="sm">
            BIVAC
          </Badge>
        ) : (
          <Text c="dimmed">—</Text>
        ),
    },
    {
      accessor: 'onHand',
      title: 'On Hand',
      sortable: true,
      width: 85,
      textAlign: 'right',
      /* A REAL FIGURE NOW, read from the stock ledger. It used to carry a "coming soon" tooltip over
         a zero, which was honest then and would be a lie now that Inventory In / Out write movements.
         Zero is dimmed so "none in stock" reads differently from a number worth acting on. */
      render: (item) => (
        <Text fz="sm" fw={item.onHand > 0 ? 500 : 400} c={item.onHand > 0 ? undefined : 'dimmed'}>
          {formatNumber(item.onHand)}
        </Text>
      ),
    },
    ...(wide
      ? [
          {
            accessor: 'averageCost',
            title: 'Avg. Cost',
            width: 110,
            textAlign: 'right',
            render: (item: ItemListDto) => (
              <Text fz="sm" c={item.averageCost ? undefined : 'dimmed'}>
                {item.averageCost === null ? '—' : formatNumber(item.averageCost, 2)}
              </Text>
            ),
          } satisfies DataTableColumn<ItemListDto>,
          {
            accessor: 'inventoryValue',
            title: 'Inventory Value',
            width: 130,
            textAlign: 'right',
            render: (item: ItemListDto) => (
              <Text fz="sm" c={item.inventoryValue ? undefined : 'dimmed'}>
                {formatNumber(item.inventoryValue, 2)}
              </Text>
            ),
          } satisfies DataTableColumn<ItemListDto>,
        ]
      : []),
    {
      accessor: 'isActive',
      title: 'Status',
      sortable: true,
      width: 100,
      ...columnFilter({
        label: 'Status',
        value: triStateFilter(filters.isActive, 'Active', 'Inactive'),
        onApply: (next) => setFilter('isActive', triStateQuery(next, 'Active')),
        options: STATUS_VALUES,
        withText: false,
      }),
      render: (item) => <StatusBadge active={item.isActive} />,
    },
    {
      accessor: 'actions',
      title: 'Actions',
      width: 130,
      textAlign: 'right',
      render: (item) => (
        <RowActions
          label={item.itemCode}
          custom={[
            {
              icon: <IconEye size={17} />,
              tooltip: 'View',
              color: 'gray',
              onClick: () => void navigate(`/inventory/items/${item.id}`),
            },
          ]}
          edit={{
            visible: canEdit,
            onClick: () => void navigate(`/inventory/items/${item.id}?edit=1`),
          }}
          toggleStatus={{
            visible: canEdit,
            active: item.isActive,
            disabled: busyId === item.id,
            onClick: () => void handleToggleStatus(item),
          }}
          remove={{ visible: canDelete, disabled: busyId === item.id, onClick: () => void handleDelete(item) }}
        />
      ),
    },
  ]

  const filtered = !grid.isDefault

  return (
    <>
      <PageHeader
        title="Item Definition"
        subtitle="Every item the business buys, stores and sells, with its packing units and documents."
        actions={
          <>
            <MoreActionsMenu
              actions={[
                { label: 'Refresh', icon: <IconRefresh size={16} />, onClick: () => void load() },
                { label: 'Export CSV', icon: <IconTableExport size={16} />, onClick: exportCsv },
              ]}
            />
            {canCreate ? (
              <Button leftSection={<IconPlus size={16} />} component={Link} to="/inventory/items/new">
                New Item
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={4}>
          <TextInput
            placeholder="Search by code, name, SKU or barcode..."
            leftSection={<IconSearch size={16} />}
            label="Search"
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') grid.commitFilters()
            }}
          />
        </FilterBar.Col>

        <FilterBar.Col span={3}>
          <Select
            label="Family"
            placeholder="All families"
            /* Headings shown but greyed, as on the item card: an item is filed under a leaf, so
               those are the families worth narrowing by, while the branch above still tells the
               reader where they are. The old "Includes every sub-family" note went with the
               selectable headings - a leaf has no sub-families to include. */
            data={familyOptions(lookups.families, {
              leavesSelectableOnly: true,
              keepId: Number(filters.itemFamilyId) || null,
            })}
            value={filters.itemFamilyId}
            onChange={(value) => setFilter('itemFamilyId', value)}
            searchable
            clearable
            nothingFoundMessage="No family found"
          />
        </FilterBar.Col>

        <FilterBar.Col span={2}>
          <Select
            label="Brand"
            placeholder="All brands"
            data={lookups.brands.map((b) => ({ value: String(b.id), label: brandLabel(b) }))}
            value={filters.brandId}
            onChange={(value) => setFilter('brandId', value)}
            searchable
            clearable
            nothingFoundMessage="No brand found"
          />
        </FilterBar.Col>

        <FilterBar.Col span={3}>
          <Select
            label="Default warehouse"
            placeholder="All warehouses"
            // Grouped under their branch, as on the item card.
            data={warehouseOptions(lookups.warehouses)}
            value={filters.defaultWarehouseId}
            onChange={(value) => setFilter('defaultWarehouseId', value)}
            searchable
            clearable
            nothingFoundMessage="No warehouse found"
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

        <FilterBar.Col span={2}>
          <Select
            label="BIVAC"
            placeholder="All"
            data={BIVAC_OPTIONS}
            value={filters.isBivac}
            onChange={(value) => setFilter('isBivac', value)}
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

      {lookups.error ? (
        <Alert color="yellow" mb="md" title="Some filters are unavailable">
          {lookups.error}
        </Alert>
      ) : null}

      {error ? (
        <Alert color="red" mb="md" title="Could not load items">
          {error}
        </Alert>
      ) : null}

      <Paper radius="lg" p="md" withBorder>
        <DataTable<ItemListDto>
          storeKey="inventory.items"
          records={data?.items ?? []}
          /* This grid pages on the SERVER, so the footer can only add up the rows it was
             sent. Each figure says so under itself, rather than passing a total of ten
             off as a total of five hundred. */
          summaryRecords={data?.items ?? []}
          summaryScope="page"
          columns={columns}
          totalRecords={data?.totalCount ?? 0}
          page={grid.page}
          recordsPerPage={grid.pageSize}
          onPageChange={grid.setPage}
          onRecordsPerPageChange={grid.setPageSize}
          sortStatus={grid.sortStatus}
          onSortStatusChange={grid.setSortStatus}
          fetching={loading}
          onRowClick={({ record }) => void navigate(`/inventory/items/${record.id}`)}
          noRecordsText={filtered ? 'No items found. Try clearing the filters to see every item.' : 'No items found.'}
        />
      </Paper>
    </>
  )
}

function numberOrUndefined(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const STATUS_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
]

const BIVAC_OPTIONS = [
  { value: 'true', label: 'BIVAC only' },
  { value: 'false', label: 'Not BIVAC' },
]

/** The words each funnel offers - the labels above, as the cells print them. */
const STATUS_VALUES = ['Active', 'Inactive']
const BIVAC_VALUES = ['BIVAC', '—']

const ACCESSOR_TO_SORT: Record<string, ItemSortBy> = {
  onHand: 'OnHand',
  itemCode: 'ItemCode',
  itemName: 'ItemName',
  brandName: 'BrandName',
  familyName: 'FamilyName',
  warehouseName: 'WarehouseName',
  isActive: 'IsActive',
  createdAtUtc: 'CreatedAtUtc',
}
