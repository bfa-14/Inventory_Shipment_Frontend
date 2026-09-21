import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Drawer, Grid, Group, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconPlus, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { shortagesApi, type ShortageLiveRowDto } from '../../api/inventory/shortages'
import type { BrandLookupDto, ItemFamilyLookupDto } from '../../api/types'
import { brandLabel, familyOptions } from '../../pages/inventory/lookups'
import { unitLabel } from '../documents/documentKind'
import { formatNumber } from '../format'
import { DataTable, type DataTableColumn } from '../ui/DataTable'

/** The header values the live calculation runs with. */
export interface LoadItemsContext {
  warehouseId: number
  warehouseName: string
  supplierId: number | null
  supplierName: string
  leadTimeMonths: number
  monthsOfHistory: number
}

interface LoadItemsDrawerProps {
  opened: boolean
  onClose: () => void
  context: LoadItemsContext
  families: ItemFamilyLookupDto[]
  brands: BrandLookupDto[]
  /** Items already on the plan: shown, but not tickable. */
  existingItemIds: ReadonlySet<number>
  onAdd: (rows: ShortageLiveRowDto[]) => void
}

/**
 * "Load items": the live calculation for the plan's warehouse, to pick lines from.
 *
 * IT REMOUNTS ON OPEN, so every visit starts from the defaults — only shortages, only this
 * supplier's items — and from a fresh calculation: stock may have moved since the last look.
 */
export function LoadItemsDrawer(props: LoadItemsDrawerProps) {
  return (
    <Drawer opened={props.opened} onClose={props.onClose} position="right" size="min(1100px, 100%)" title="Load items" padding="md">
      {props.opened && <LoadItems {...props} />}
    </Drawer>
  )
}

function LoadItems({ onClose, context, families, brands, existingItemIds, onAdd }: LoadItemsDrawerProps) {
  const [familyId, setFamilyId] = useState<string | null>(null)
  const [brandId, setBrandId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [onlyShortages, setOnlyShortages] = useState(true)
  const [onlySupplier, setOnlySupplier] = useState(true)
  const [debouncedSearch] = useDebouncedValue(search, 350)

  const [rows, setRows] = useState<ShortageLiveRowDto[]>([])
  const [selected, setSelected] = useState<ShortageLiveRowDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supplierFilter = onlySupplier && context.supplierId !== null ? context.supplierId : undefined

  useEffect(() => {
    const controller = new AbortController()
    // The last request wins: the previous one is aborted by this effect's cleanup.
    shortagesApi
      .calculate(
        {
          warehouseId: context.warehouseId,
          supplierId: supplierFilter,
          leadTimeMonths: context.leadTimeMonths,
          monthsOfHistory: context.monthsOfHistory,
          itemFamilyId: familyId === null ? undefined : Number(familyId),
          brandId: brandId === null ? undefined : Number(brandId),
          search: debouncedSearch,
          onlyShortages,
        },
        controller.signal,
      )
      .then((result) => {
        setRows(result)
        // Every row that is actually short starts ticked; the ones already on the plan cannot be.
        setSelected(result.filter((row) => row.shortageBase > 0 && !existingItemIds.has(row.itemId)))
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setRows([])
        setSelected([])
        setError(err instanceof ApiError ? err.message : 'The items could not be calculated.')
        setLoading(false)
      })
    return () => controller.abort()
  }, [context.warehouseId, context.leadTimeMonths, context.monthsOfHistory, supplierFilter, familyId, brandId, debouncedSearch, onlyShortages, existingItemIds])

  /** A filter changed: the grid shows its spinner until the new rows arrive. */
  function refilter(apply: () => void) {
    setLoading(true)
    apply()
  }

  const columns: DataTableColumn<ShortageLiveRowDto>[] = [
    {
      accessor: 'itemCode',
      title: 'Item',
      width: 220,
      render: (row) => (
        <div>
          <Group gap={6} wrap="nowrap">
            <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>{row.itemCode}</Text>
            {existingItemIds.has(row.itemId) && <Badge size="xs" variant="light" color="gray">on the plan</Badge>}
          </Group>
          <Text fz="xs" c="dimmed" lineClamp={1}>{row.itemName}</Text>
        </div>
      ),
    },
    { accessor: 'currentInventoryBase', title: 'Current Inventory', width: 120, textAlign: 'right', render: (row) => formatNumber(row.currentInventoryBase) },
    { accessor: 'transitBase', title: 'Transit', width: 90, textAlign: 'right', render: (row) => formatNumber(row.transitBase) },
    { accessor: 'outstandingOrderBase', title: 'Outstanding', width: 110, textAlign: 'right', render: (row) => formatNumber(row.outstandingOrderBase) },
    { accessor: 'totalExpectedStockBase', title: 'Total Expected', width: 120, textAlign: 'right', render: (row) => formatNumber(row.totalExpectedStockBase) },
    { accessor: 'expectedMonthlySalesBase', title: 'Monthly Sales', width: 120, textAlign: 'right', render: (row) => formatNumber(row.expectedMonthlySalesBase, 2) },
    { accessor: 'expectedRequirementBase', title: 'Requirement', width: 120, textAlign: 'right', render: (row) => formatNumber(row.expectedRequirementBase, 2) },
    {
      accessor: 'shortageBase',
      title: 'Shortage',
      width: 100,
      textAlign: 'right',
      render: (row) => <Text fz="sm" fw={row.shortageBase > 0 ? 700 : 400} c={row.shortageBase > 0 ? 'red' : undefined}>{formatNumber(row.shortageBase)}</Text>,
    },
    { accessor: 'coverageMonths', title: 'Coverage', width: 100, textAlign: 'right', render: (row) => formatNumber(row.coverageMonths, 2) },
    {
      accessor: 'suggestedRequiredQty',
      title: 'Suggested',
      width: 130,
      textAlign: 'right',
      render: (row) => (row.suggestedRequiredQty > 0 ? `${formatNumber(row.suggestedRequiredQty)} ${unitLabel(row.purchaseUnitName, row.purchasePackingFormula)}` : '—'),
    },
    {
      accessor: 'supplierName',
      title: 'Supplier',
      width: 190,
      render: (row) =>
        row.supplierName === null ? (
          <Text fz="sm" c="dimmed">—</Text>
        ) : (
          <Group gap={6} wrap="nowrap">
            <Text fz="sm" lineClamp={1}>{row.supplierName}</Text>
            <Badge size="xs" variant="light" color={row.supplierIsDefault ? 'blue' : 'gray'}>{row.supplierIsDefault ? 'default' : 'last'}</Badge>
          </Group>
        ),
    },
  ]

  function addSelected() {
    onAdd(selected)
    onClose()
  }

  return (
    <Stack gap="md">
      <Text fz="sm" c="dimmed">
        Live figures for <b>{context.warehouseName}</b> — Lead Time (Month) {formatNumber(context.leadTimeMonths, Number.isInteger(context.leadTimeMonths) ? 0 : 2)},
        monthly sales from the last {formatNumber(context.monthsOfHistory)} month(s).
      </Text>

      <Grid align="flex-end">
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Select label="Family" placeholder="All families" data={familyOptions(families)} value={familyId} onChange={(next) => refilter(() => setFamilyId(next))} clearable searchable comboboxProps={{ withinPortal: true }} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Select label="Brand" placeholder="All brands" data={brands.map((b) => ({ value: String(b.id), label: brandLabel(b) }))} value={brandId} onChange={(next) => refilter(() => setBrandId(next))} clearable searchable comboboxProps={{ withinPortal: true }} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 12, md: 6 }}>
          <TextInput label="Search" placeholder="Item code or name" leftSection={<IconSearch size={16} />} value={search} onChange={(event) => refilter(() => setSearch(event.currentTarget.value))} data-autofocus />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <Switch label="Only shortages" description="Off: every item of the warehouse, short or not" checked={onlyShortages} onChange={(event) => refilter(() => setOnlyShortages(event.currentTarget.checked))} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <Switch
            label="Only this supplier's items"
            description={context.supplierId === null ? 'Choose a supplier on the plan to use this' : `Default (else last) supplier is ${context.supplierName}`}
            checked={onlySupplier && context.supplierId !== null}
            disabled={context.supplierId === null}
            onChange={(event) => refilter(() => setOnlySupplier(event.currentTarget.checked))}
          />
        </Grid.Col>
      </Grid>

      {error && <Alert color="red">{error}</Alert>}

      <div data-load-items-grid>
        <DataTable<ShortageLiveRowDto>
          records={rows}
          columns={columns}
          idAccessor="itemId"
          fetching={loading}
          selectedRecords={selected}
          onSelectedRecordsChange={setSelected}
          isRecordSelectable={(row) => !existingItemIds.has(row.itemId)}
          noRecordsText={onlyShortages ? 'Nothing is short with these settings.' : 'No items match.'}
        />
      </div>

      <Group justify="space-between" pos="sticky" bottom={0} bg="var(--mantine-color-body)" py="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-3)', zIndex: 2 }}>
        <Text fz="sm" c="dimmed">{formatNumber(rows.length)} item(s), {formatNumber(selected.length)} ticked</Text>
        <Group gap="xs">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button leftSection={<IconPlus size={16} />} disabled={selected.length === 0} onClick={addSelected} data-load-items-add>
            Add selected ({formatNumber(selected.length)})
          </Button>
        </Group>
      </Group>
    </Stack>
  )
}
