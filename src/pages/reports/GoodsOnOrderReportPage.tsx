import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  Alert, Anchor, Badge, Button, Drawer, Group, Loader, Paper, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Table,
  Text, TextInput, Tooltip, UnstyledButton,
} from '@mantine/core'
import { IconFileExport, IconFilterOff, IconRefresh } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { itemsApi } from '../../api/inventory/items'
import { branchesApi } from '../../api/masterdata/branches'
import { itemFamiliesApi } from '../../api/masterdata/itemFamilies'
import { partiesApi } from '../../api/masterdata/parties'
import {
  goodsOnOrderReportApi,
  type GoodsOnOrderCellDto,
  type GoodsOnOrderQuery,
  type GoodsOnOrderReportResult,
  type GoodsOnOrderStageKind,
} from '../../api/reports/goodsOnOrder'
import type { BranchLookupDto, ItemFamilyLookupDto, ItemLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { dateLabel, isoDate } from '../../components/documents/documentKind'
import { formatDateTime, formatNumber } from '../../components/format'
import { partyLabel } from '../../components/sales/salesLines'
import { DateInput } from '../../components/ui/DateInput'
import { FilterBar } from '../../components/ui/FilterBar'
import { notify } from '../../components/ui/notify'
import { PageHeader } from '../../components/ui/PageHeader'
import { PERMISSIONS } from '../../navigation'
import { familyOptions } from '../inventory/lookups'

type Show = 'both' | 'qty' | 'containers'

/** What the drawer lists: one item (or a family, or everything) at one stage (or every stage). */
interface Pick {
  title: string
  itemId?: number
  family?: string
  stageKey?: string
}

const NO_FILTERS: GoodsOnOrderQuery = { supplierId: null, itemFamilyId: null, itemId: null, branchId: null, orderDateTo: '', search: '' }

/** The stage's colour in the header: where the goods are, as the Shipments board. */
const KIND_COLOUR: Record<GoodsOnOrderStageKind, string> = {
  Pending: 'gray', AtSea: 'blue', AtPort: 'cyan', OnTheRoad: 'orange', AtPlace: 'grape', Delivered: 'teal', Other: 'gray',
}

const count = (value: number) => formatNumber(value)

/** An estimated container count: "≈ 30", "≈ 186+" (an item without a container unit too), "?" when only such items. */
const estimateText = (cell: GoodsOnOrderCellDto) => {
  const total = cell.containers + (cell.estimatedContainers ?? 0)
  return total === 0 ? '?' : `≈ ${count(total)}${cell.estimateIncomplete ? '+' : ''}`
}

/**
 * Reports › Goods on Order (script 109): everything ordered and not received yet - the purchasing team's "MOVEMENT
 * SUMMARY". One row per item, grouped by top family (the vehicles apart from the spare parts); one Qty / Containers pair
 * PER STAGE THE GOODS ARE AT NOW. The columns are the server's: the stages the containers' movements put them at, in the
 * order of the journey (a new route or border post is a new column by itself), every order month in "Order pending".
 *
 * A container of two items counts in each item and once in every total. The containers of pieces not on a container yet
 * are estimated from the item's container unit ("≈", grey italics); an item without one adds "+". A figure opens the
 * containers and order lines behind it.
 */
export function GoodsOnOrderReportPage() {
  const { hasPermission } = useAuth()
  const [draft, setDraft] = useState<GoodsOnOrderQuery>(NO_FILTERS)
  const [applied, setApplied] = useState<GoodsOnOrderQuery>(NO_FILTERS)
  const [report, setReport] = useState<GoodsOnOrderReportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [show, setShow] = useState<Show>('both')
  const [pick, setPick] = useState<Pick | null>(null)

  const [suppliers, setSuppliers] = useState<PartyLookupDto[]>([])
  const [items, setItems] = useState<ItemLookupDto[]>([])
  const [families, setFamilies] = useState<ItemFamilyLookupDto[]>([])
  const [branches, setBranches] = useState<BranchLookupDto[]>([])

  useEffect(() => {
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: false }).then(setSuppliers).catch(() => {})
    itemsApi.lookup(false).then(setItems).catch(() => {})
    itemFamiliesApi.lookup(false).then(setFamilies).catch(() => {})
    branchesApi.lookup(false).then(setBranches).catch(() => {})
  }, [])

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const loaded = await goodsOnOrderReportApi.report(applied, signal)
      if (signal.aborted) return
      setReport(loaded)
    } catch (err) {
      if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
      setReport(null)
      setError(err instanceof ApiError ? err.messages.join(' ') : 'The report could not be loaded.')
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [applied])

  useEffect(() => {
    const controller = new AbortController()
    // Fetching is the "synchronize with an external system" case: loading has to show before the await.
    // eslint-disable-next-line react/set-state-in-effect
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function exportToExcel() {
    setExporting(true)
    try {
      await goodsOnOrderReportApi.exportToExcel(applied)
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The export could not be made.')
    } finally {
      setExporting(false)
    }
  }

  const stages = useMemo(() => report?.stages ?? [], [report])
  const canOpenContainers = hasPermission(PERMISSIONS.containersView)
  const canOpenOrders = hasPermission(PERMISSIONS.purchaseOrdersView)
  const showQty = show !== 'containers'
  const showContainers = show !== 'qty'
  const perStage = (showQty ? 1 : 0) + (showContainers ? 1 : 0)

  /** One stage's figures: Qty, then Containers ("≈ 30" when estimated; "+" when an item has no container unit). */
  function Figures({ cell, onOpen }: { cell: GoodsOnOrderCellDto | undefined; onOpen: () => void }) {
    if (!cell || (cell.quantity === 0 && cell.containers === 0)) {
      return (
        <>
          {showQty && <Table.Td ta="right" c="dimmed">–</Table.Td>}
          {showContainers && <Table.Td ta="right" c="dimmed">–</Table.Td>}
        </>
      )
    }
    const estimate = cell.estimatedContainers ?? 0
    const estimated = estimate > 0 || cell.estimateIncomplete
    const tip = [
      cell.containers > 0 ? `${count(cell.containers)} on containers` : null,
      estimate > 0 ? `≈ ${count(estimate)} for ${count(cell.piecesNotLoaded)} pcs not loaded yet (the item's container unit)` : null,
      cell.estimateIncomplete ? 'some pieces not loaded belong to an item without a container unit: their containers are unknown' : null,
    ].filter(Boolean).join(' · ')
    return (
      <>
        {showQty && (
          <Table.Td ta="right">
            <UnstyledButton fz="sm" onClick={onOpen} style={{ textDecoration: 'underline dotted' }}>{count(cell.quantity)}</UnstyledButton>
          </Table.Td>
        )}
        {showContainers && (
          <Table.Td ta="right">
            {estimated ? (
              <Tooltip label={tip} withArrow multiline w={280}>
                <UnstyledButton fz="sm" c="dimmed" fs="italic" onClick={onOpen}>
                  {estimateText(cell)}
                </UnstyledButton>
              </Tooltip>
            ) : (
              <UnstyledButton fz="sm" onClick={onOpen} style={{ textDecoration: 'underline dotted' }}>{count(cell.containers)}</UnstyledButton>
            )}
          </Table.Td>
        )}
      </>
    )
  }

  const pickedRows = useMemo(() => {
    if (!report || !pick) return []
    return report.rows.filter((r) =>
      (pick.itemId === undefined || r.itemId === pick.itemId)
      && (pick.family === undefined || (r.rootFamilyName ?? 'No family') === pick.family)
      && (pick.stageKey === undefined || report.stageKeys[r.rowKey] === pick.stageKey))
  }, [report, pick])

  const stageLabel = (key: string) => stages.find((s) => s.key === key)?.label ?? key

  const familyNames = useMemo(() => (report?.families ?? []).map((f) => f.rootFamilyName), [report])
  const mainFamily = report?.families.find((f) => f.rootFamilyName === 'Main Items')
  const notLoaded = report?.grandTotal.piecesNotLoaded ?? 0

  return (
    <div>
      <PageHeader
        title="Goods on Order"
        subtitle="Everything ordered and not received yet, per item and per stage of the journey. The columns are the stages the containers' movements put the goods at now."
        actions={
          <Button variant="default" leftSection={<IconFileExport size={16} />} onClick={() => void exportToExcel()}
            disabled={!report} loading={exporting}>
            Export to Excel
          </Button>
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <Select
            label="Supplier"
            placeholder="All suppliers"
            data={suppliers.map((s) => ({ value: String(s.id), label: partyLabel(s) }))}
            value={draft.supplierId === null ? null : String(draft.supplierId)}
            onChange={(next) => setDraft((d) => ({ ...d, supplierId: next ? Number(next) : null }))}
            searchable
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Item family"
            placeholder="All families"
            data={familyOptions(families)}
            value={draft.itemFamilyId === null ? null : String(draft.itemFamilyId)}
            onChange={(next) => setDraft((d) => ({ ...d, itemFamilyId: next ? Number(next) : null }))}
            searchable
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Item"
            placeholder="All items"
            data={items.map((i) => ({ value: String(i.id), label: `${i.itemCode} - ${i.itemName}` }))}
            value={draft.itemId === null ? null : String(draft.itemId)}
            onChange={(next) => setDraft((d) => ({ ...d, itemId: next ? Number(next) : null }))}
            searchable
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Select
            label="Branch"
            placeholder="All branches"
            data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
            value={draft.branchId === null ? null : String(draft.branchId)}
            onChange={(next) => setDraft((d) => ({ ...d, branchId: next ? Number(next) : null }))}
            clearable
          />
        </FilterBar.Col>
        <FilterBar.Col span={1.5}>
          <DateInput
            label="Order date to"
            placeholder="Any"
            valueFormat="DD/MM/YYYY"
            clearable
            value={draft.orderDateTo || null}
            onChange={(next) => setDraft((d) => ({ ...d, orderDateTo: next ? isoDate(next) : '' }))}
          />
        </FilterBar.Col>
        <FilterBar.Col span={1.5}>
          <TextInput
            label="Container or document"
            placeholder="Ref., no., PO, PI"
            value={draft.search}
            onChange={(e) => {
              const value = e.currentTarget.value
              setDraft((d) => ({ ...d, search: value }))
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') setApplied(draft) }}
          />
        </FilterBar.Col>
        <FilterBar.Col span={12}>
          <Group justify="space-between" gap="xs">
            <Group gap="xs">
              <Text fz="sm" c="dimmed">Show</Text>
              <SegmentedControl
                size="xs"
                value={show}
                onChange={(next) => setShow(next as Show)}
                data={[{ value: 'both', label: 'Qty + containers' }, { value: 'qty', label: 'Qty' }, { value: 'containers', label: 'Containers' }]}
              />
            </Group>
            <Group gap="xs">
              <Button variant="subtle" leftSection={<IconFilterOff size={16} />} onClick={() => { setDraft(NO_FILTERS); setApplied(NO_FILTERS) }}>
                Reset
              </Button>
              <Button leftSection={<IconRefresh size={16} />} onClick={() => setApplied({ ...draft })} loading={loading}>
                Refresh
              </Button>
            </Group>
          </Group>
        </FilterBar.Col>
      </FilterBar>

      {error && <Alert color="red" mb="md">{error}</Alert>}
      {loading && !report && <Group justify="center" py="xl"><Loader /></Group>}

      {report && (
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
            <Paper withBorder p="sm">
              <Text fz="xs" c="dimmed">Containers on the way</Text>
              <Text fz="xl" fw={500}>{count(report.grandTotal.containers)}</Text>
            </Paper>
            <Paper withBorder p="sm">
              <Text fz="xs" c="dimmed">Vehicles (Main Items)</Text>
              <Text fz="xl" fw={500}>{count(mainFamily?.total.quantity ?? 0)} pcs</Text>
            </Paper>
            <Paper withBorder p="sm">
              <Text fz="xs" c="dimmed">Other families</Text>
              {report.families.filter((f) => f.rootFamilyName !== 'Main Items').map((f) => (
                <Text fz="sm" key={f.rootFamilyName}><b>{count(f.total.quantity)}</b> {f.rootFamilyName}</Text>
              ))}
              {report.families.every((f) => f.rootFamilyName === 'Main Items') && <Text fz="xl" fw={500}>0</Text>}
            </Paper>
            <Paper withBorder p="sm">
              <Text fz="xs" c="dimmed">Still to load (no container)</Text>
              <Text fz="xl" fw={500}>{count(notLoaded)} pcs</Text>
              {(report.grandTotal.estimatedContainers ?? 0) > 0 && (
                <Text fz="xs" c="dimmed">≈ {count(report.grandTotal.estimatedContainers ?? 0)}{report.grandTotal.estimateIncomplete ? '+' : ''} containers</Text>
              )}
            </Paper>
          </SimpleGrid>

          {report.items.length === 0 ? (
            <Paper withBorder p="xl"><Text ta="center" c="dimmed">Nothing is ordered and not received for the selected criteria.</Text></Paper>
          ) : (
            <Paper withBorder radius="lg">
              <ScrollArea type="auto">
                <Table withColumnBorders striped={false} fz="sm" style={{ minWidth: 220 + (stages.length + 1) * perStage * 90 }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th rowSpan={2} style={{ minWidth: 220 }}>Model</Table.Th>
                      {stages.map((s) => (
                        <Table.Th key={s.key} colSpan={perStage} ta="center">
                          <Badge variant="light" color={KIND_COLOUR[s.kind]} style={{ textTransform: 'none', whiteSpace: 'normal', height: 'auto' }}>
                            {s.label}
                          </Badge>
                        </Table.Th>
                      ))}
                      <Table.Th colSpan={perStage} ta="center">Grand total</Table.Th>
                    </Table.Tr>
                    <Table.Tr>
                      {[...stages.map((s) => s.key), '__total'].map((key) => (
                        <FragmentHeader key={key} showQty={showQty} showContainers={showContainers} />
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {familyNames.map((family) => {
                      const totals = report.families.find((f) => f.rootFamilyName === family)
                      return (
                        <Fragment key={family}>
                          <Table.Tr style={{ background: 'var(--mantine-color-gray-light)' }}>
                            <Table.Td colSpan={1 + (stages.length + 1) * perStage} fw={500}>{family}</Table.Td>
                          </Table.Tr>
                          {report.items.filter((i) => (i.rootFamilyName ?? 'No family') === family).map((item) => (
                            <Table.Tr key={item.itemId}>
                              <Table.Td>
                                <UnstyledButton fz="sm" c="blue" td="underline" onClick={() => setPick({ title: `${item.itemCode} · ${item.itemName}`, itemId: item.itemId })}>
                                  {item.itemName}
                                </UnstyledButton>
                                <Text fz="xs" c="dimmed">{item.itemCode}{item.pcsPerContainer ? ` · ${formatNumber(item.pcsPerContainer)} per container` : ' · no container unit'}</Text>
                              </Table.Td>
                              {stages.map((s) => (
                                <Figures key={s.key} cell={item.cells[s.key]}
                                  onOpen={() => setPick({ title: `${item.itemCode} · ${s.label}`, itemId: item.itemId, stageKey: s.key })} />
                              ))}
                              <Figures cell={item.total} onOpen={() => setPick({ title: `${item.itemCode} · everything on order`, itemId: item.itemId })} />
                            </Table.Tr>
                          ))}
                          {totals && (
                            <Table.Tr fw={500} style={{ background: 'var(--mantine-color-gray-light)' }}>
                              <Table.Td>Total {family}</Table.Td>
                              {stages.map((s) => (
                                <Figures key={s.key} cell={totals.cells[s.key]}
                                  onOpen={() => setPick({ title: `${family} · ${s.label}`, family, stageKey: s.key })} />
                              ))}
                              <Figures cell={totals.total} onOpen={() => setPick({ title: `${family} · everything on order`, family })} />
                            </Table.Tr>
                          )}
                        </Fragment>
                      )
                    })}
                    <Table.Tr fw={500} style={{ borderTop: '2px solid var(--mantine-color-default-border)' }}>
                      <Table.Td>General total containers</Table.Td>
                      {[...stages.map((s) => ({ key: s.key, cell: report.totals[s.key] })), { key: '__total', cell: report.grandTotal }].map(({ key, cell }) => {
                        const estimate = cell?.estimatedContainers ?? 0
                        return (
                          <Table.Td key={key} colSpan={perStage} ta="right">
                            {!cell ? '–' : estimate > 0 || cell.estimateIncomplete
                              ? <Text span fz="sm" fs="italic" c="dimmed">{estimateText(cell)}</Text>
                              : count(cell.containers)}
                          </Table.Td>
                        )
                      })}
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Paper>
          )}

          <Text fz="xs" c="dimmed">
            A mixed container counts under each item it holds; the family totals and the general total count it once. ≈: pieces
            not on a container yet, estimated from the item's container unit; + : some of them have none, so their containers
            are unknown. Click a model or a figure for the containers and order lines behind it. Run{' '}
            {formatDateTime(report.generatedAtUtc)} by {report.generatedBy}.
          </Text>
        </Stack>
      )}

      <Drawer opened={pick !== null} onClose={() => setPick(null)} position="right" size="xl" title={pick?.title ?? ''}>
        {pick && (
          <Stack gap="xs">
            <Text fz="sm" c="dimmed">
              {count(pickedRows.reduce((sum, r) => sum + r.quantity, 0))} pcs ·{' '}
              {count(new Set(pickedRows.filter((r) => r.containerId !== null).map((r) => r.containerId)).size)} containers
              {pickedRows.some((r) => r.isPending) ? ` · ${count(pickedRows.filter((r) => r.isPending).reduce((s, r) => s + r.quantity, 0))} pcs still to load` : ''}
            </Text>
            <ScrollArea type="auto">
              <Table striped fz="sm" style={{ minWidth: 760 }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Container</Table.Th>
                    <Table.Th>Container no.</Table.Th>
                    <Table.Th>Item</Table.Th>
                    <Table.Th ta="right">Qty</Table.Th>
                    <Table.Th>Order</Table.Th>
                    {pick.stageKey === undefined && <Table.Th>Stage</Table.Th>}
                    <Table.Th>Dispatched</Table.Th>
                    <Table.Th>Arrived port</Table.Th>
                    <Table.Th>Left port</Table.Th>
                    <Table.Th>Trucks</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pickedRows.map((r) => (
                    <Table.Tr key={r.rowKey}>
                      <Table.Td>
                        {r.containerId === null ? <Text fz="sm" c="dimmed" fs="italic">Not loaded</Text>
                          : canOpenContainers ? <Anchor component={Link} to={`/logistics/containers/${r.containerId}`} fz="sm">{r.containerRef}</Anchor>
                            : r.containerRef}
                      </Table.Td>
                      <Table.Td>{r.containerNo ?? ''}</Table.Td>
                      <Table.Td>{r.itemCode}</Table.Td>
                      <Table.Td ta="right">{count(r.quantity)}</Table.Td>
                      <Table.Td>
                        {canOpenOrders ? <Anchor component={Link} to={`/purchase/orders/${r.purchaseOrderId}`} fz="sm">{r.poNumber}</Anchor> : r.poNumber}
                        <Text fz="xs" c="dimmed">{dateLabel(r.orderDate)}</Text>
                      </Table.Td>
                      {pick.stageKey === undefined && <Table.Td>{stageLabel(report?.stageKeys[r.rowKey] ?? '')}</Table.Td>}
                      <Table.Td>{r.dispatchDate ? dateLabel(r.dispatchDate) : ''}</Table.Td>
                      <Table.Td>{r.arrivedPortDate ? dateLabel(r.arrivedPortDate) : ''}</Table.Td>
                      <Table.Td>{r.leftPortDate ? dateLabel(r.leftPortDate) : ''}</Table.Td>
                      <Table.Td>{r.trucks ?? ''}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Stack>
        )}
      </Drawer>
    </div>
  )
}

/** The second header row of one stage: QTY. and / or CONTAINERS. */
function FragmentHeader({ showQty, showContainers }: { showQty: boolean; showContainers: boolean }) {
  return (
    <>
      {showQty && <Table.Th ta="right" fz="xs">Qty</Table.Th>}
      {showContainers && <Table.Th ta="right" fz="xs">Containers</Table.Th>}
    </>
  )
}
