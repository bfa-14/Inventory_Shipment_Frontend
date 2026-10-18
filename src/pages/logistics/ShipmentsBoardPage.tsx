import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  CloseButton,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Select,
  Switch,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconFilterOff, IconLayoutKanban, IconList, IconRefresh, IconSearch } from '@tabler/icons-react'
import dayjs from 'dayjs'
import type { ContainerDto } from '../../api/logistics/containers'
import { shipmentsApi, type ShipmentBoardDto, type ShipmentBoardQuery, type ShipmentCardDto, type ShipmentPhase } from '../../api/logistics/shipments'
import { branchesApi } from '../../api/masterdata/branches'
import { portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import type { BranchLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { ContainerSelectionBar } from '../../components/logistics/ContainerSelectionBar'
import { ShipmentColumn } from '../../components/logistics/shipments/ShipmentColumn'
import { ShipmentDrawer } from '../../components/logistics/shipments/ShipmentDrawer'
import { ShipmentsList } from '../../components/logistics/shipments/ShipmentsList'
import type { CardLinks } from '../../components/logistics/shipments/ShipmentCard'
import { boardColumns, CARDS_STEP, isSelectableCard, withIds } from '../../components/logistics/shipments/shipmentBoard'
import { placeOptionGroups } from '../../components/logistics/shipStep'
import { useNextStep } from '../../components/logistics/useNextStep'
import { loadNothing, loadPurchaseOrders, loadSuppliers, resolvePurchaseDocument } from '../../components/purchase/documentSearch'
import { branchLabel, formatNumber } from '../../components/format'
import { FilterBar } from '../../components/ui/FilterBar'
import { PageHeader } from '../../components/ui/PageHeader'
import { SearchSelect } from '../../components/ui/SearchSelect'
import { useGridQuery } from '../../hooks/useGridQuery'
import { PERMISSIONS } from '../../navigation'

/** The board reads itself again this long after its last answer, while the tab is visible and no dialog is open. */
const REFRESH_MS = 60_000
/** How often that is looked at: a dialog closed or a tab come back gets its refresh within this. */
const REFRESH_CHECK_MS = 15_000

/** Board or List: the reader's last choice, kept in this browser only. */
const VIEW_KEY = 'inventory_shipment.shipments.view'
type View = 'board' | 'list'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board'
  } catch {
    return 'board'
  }
}

function storeView(view: View) {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // A browser that refuses storage still works; the board simply opens as the board.
  }
}

/** A dialog or a drawer is open (Mantine marks both): the board is not read again under the reader's feet. */
function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null
}

interface Filters {
  search: string
  supplierId: string | null
  purchaseOrderId: string | null
  branchId: string | null
  placeId: string | null
  lateOnly: boolean
  withPlannedLeg: boolean
  showReceived: boolean
}

const NO_FILTERS: Filters = {
  search: '',
  supplierId: null,
  purchaseOrderId: null,
  branchId: null,
  placeId: null,
  lateOnly: false,
  withPlannedLeg: false,
  showReceived: false,
}

const id = (value: string | null) => (value === null ? undefined : Number(value))

function toQuery(filters: Filters): ShipmentBoardQuery {
  return {
    search: filters.search.trim() || undefined,
    supplierId: id(filters.supplierId),
    purchaseOrderId: id(filters.purchaseOrderId),
    branchId: id(filters.branchId),
    placeId: id(filters.placeId),
    lateOnly: filters.lateOnly || undefined,
    withPlannedLeg: filters.withPlannedLeg || undefined,
    showReceived: filters.showReceived || undefined,
  }
}

/**
 * LOGISTICS › SHIPMENTS (script 82, shipment phase 3): every container on its way, one column by stage - At supplier, At
 * sea, At port, On the road, At border / customs, Delivered, to receive, and with "Show received (30 days)" the ones
 * received since - grouped by ship, leg, place or warehouse. The column of a container is the server's, from the same
 * movements as its next step.
 *
 * - NO DRAG-AND-DROP, ON PURPOSE: every move writes a movement with its dates, so every move goes through the Next step
 *   dialogs - a card's "Next step: …", its drawer, or the selection bar for many.
 * - THE SELECTION is the containers' ids: ticked cards, a whole group (a ship) or a column, kept across every reload and
 *   narrowed to the cards still on the board. The selection bar is the Containers list's own.
 * - 50 CARDS A COLUMN, then "Show 50 more"; "List" shows the same rows as one table for 300 or more.
 * - A PHONE sees one column at a time, picked from a row of tabs with the counts.
 * - IT READS ITSELF AGAIN after every action, on Refresh, and a minute after its last answer while the tab is visible
 *   and no dialog is open.
 */
export function ShipmentsBoardPage() {
  const { hasPermission } = useAuth()
  const canViewOrders = hasPermission(PERMISSIONS.purchaseOrdersView)
  const canViewContainers = hasPermission(PERMISSIONS.containersView)
  const links: CardLinks = useMemo(
    () => ({
      movements: hasPermission(PERMISSIONS.movementsView),
      orders: hasPermission(PERMISSIONS.purchaseOrdersView),
      receipts: hasPermission(PERMISSIONS.goodsReceiptsView),
    }),
    [hasPermission],
  )
  // One column at a time below 62em: six columns of cards do not fit a phone or a narrow tablet.
  const wide = useMediaQuery('(min-width: 62em)', true, { getInitialValueInEffect: false })

  const [view, setView] = useState<View>(readView)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  /** When the board was last asked for: the minute's refresh counts from it. */
  const askedAt = useRef(0)

  const grid = useGridQuery<Filters, ShipmentCardDto, ShipmentBoardDto>({
    initialFilters: NO_FILTERS,
    debounced: ['search'],
    initialSort: { columnAccessor: 'containerRef', direction: 'asc' },
    paging: 'client',
    errorMessage: 'The shipments could not be loaded.',
    fetcher: useCallback(async ({ filters, signal }) => {
      askedAt.current = Date.now()
      const board = await shipmentsApi.board(toQuery(filters), signal)
      if (!signal.aborted) setUpdatedAt(new Date())
      return board
    }, []),
  })
  const { filters, setFilter, data, loading, error, reload } = grid

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  useEffect(() => {
    branchesApi.lookup(false).then(setBranches).catch(() => {})
    portsApi.lookup(false).then(setPorts).catch(() => {})
  }, [])
  const branchOptions = useMemo(() => branches.map((b) => ({ value: String(b.id), label: branchLabel(b) })), [branches])
  const placeOptions = useMemo(() => placeOptionGroups(ports, [filters.placeId]), [ports, filters.placeId])

  /* ── the board ───────────────────────────────────────────────────────────────────────────── */

  const cards = useMemo(() => data?.containers ?? [], [data])
  const columns = useMemo(() => (data ? boardColumns(data.columns, data.containers) : []), [data])
  const titles = useMemo(() => Object.fromEntries((data?.columns ?? []).map((c) => [c.phase, c.title])) as Partial<Record<ShipmentPhase, string>>, [data])
  const selectable = useMemo(() => cards.filter(isSelectableCard), [cards])

  /* THE SELECTION IS IDS, narrowed to the cards still on the board at every settled answer (in the render that brings
     it, so no tick is ever drawn on a card that left). */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set())
  const [judged, setJudged] = useState<ShipmentBoardDto | null>(null)
  if (data !== judged) {
    setJudged(data)
    if (data && selectedIds.size > 0) {
      const onBoard = new Set(data.containers.filter(isSelectableCard).map((c) => c.id))
      const kept = [...selectedIds].filter((cid) => onBoard.has(cid))
      if (kept.length !== selectedIds.size) setSelectedIds(new Set(kept))
    }
  }
  const selectedRows = useMemo(() => selectable.filter((c) => selectedIds.has(c.id)), [selectable, selectedIds])
  const select = useCallback((ids: number[], on: boolean) => setSelectedIds((current) => withIds(current, ids, on)), [])
  const setSelectedRows = useCallback((rows: ShipmentCardDto[]) => setSelectedIds(new Set(rows.map((r) => r.id))), [])

  /* Folded groups and drawn cards per column: the reader's, kept across the reloads. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const [limits, setLimits] = useState<Partial<Record<ShipmentPhase, number>>>({})

  /* ── the next step, the drawer ───────────────────────────────────────────────────────────── */

  // A card's step, its drawer's and the selection bar's all end with the board read again.
  const nextStep = useNextStep(reload, 'shipments')
  const [drawerCard, setDrawerCard] = useState<ShipmentCardDto | null>(null)
  // (82) A container's step reads the container (its dialog's GET needs View Containers): without that permission the
  // board does not offer it - like the drawer's route - and the selection bar says why (the bulk dialog reads the
  // movement types with it too).
  const stepOf = (card: ShipmentCardDto) => (canViewContainers ? nextStep.action(card) : null)

  /* ── the refresh ─────────────────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const due = () => Date.now() - askedAt.current >= REFRESH_MS
    const check = () => {
      if (document.visibilityState === 'visible' && due() && !dialogOpen()) reload()
    }
    const timer = setInterval(check, REFRESH_CHECK_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [reload])

  /* ── the phone's one column ──────────────────────────────────────────────────────────────── */

  const [tab, setTab] = useState<ShipmentPhase | null>(null)
  const shownTab = columns.find((c) => c.phase === tab)?.phase ?? columns.find((c) => c.cards.length > 0)?.phase ?? columns[0]?.phase ?? null

  const emptyText = grid.isDefault ? 'No container is on its way.' : 'No container matches these filters.'
  const orderLoader = canViewOrders ? loadPurchaseOrders : loadNothing

  const column = (phase: ShipmentPhase, bodyHeight?: string) => {
    const col = columns.find((c) => c.phase === phase)
    if (!col) return null
    return (
      <ShipmentColumn
        column={col}
        selected={selectedIds}
        onSelect={select}
        onOpen={setDrawerCard}
        stepOf={stepOf}
        onStep={(card) => nextStep.run(card)}
        links={links}
        isFolded={(key) => folded.has(`${phase}|${key}`)}
        onFold={(key, fold) =>
          setFolded((current) => {
            const next = new Set(current)
            if (fold) next.add(`${phase}|${key}`)
            else next.delete(`${phase}|${key}`)
            return next
          })
        }
        limit={limits[phase] ?? CARDS_STEP}
        onLimit={(next) => setLimits((current) => ({ ...current, [phase]: next }))}
        bodyHeight={bodyHeight}
      />
    )
  }

  return (
    <div>
      <PageHeader
        title="Shipments"
        subtitle="Every container on its way, by stage: tick them, then Next step…"
        breadcrumbs={[{ label: 'Logistics' }, { label: 'Shipments' }]}
        actions={
          <>
            {updatedAt ? (
              <Text fz="xs" c="dimmed" data-shipments-updated>
                Updated {dayjs(updatedAt).format('HH:mm')}
              </Text>
            ) : null}
            <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={reload} loading={loading && data !== null} data-shipments-refresh>
              Refresh
            </Button>
            <SegmentedControl
              value={view}
              onChange={(next) => {
                setView(next as View)
                storeView(next as View)
              }}
              data={[
                {
                  value: 'board',
                  label: (
                    <Group gap={6} wrap="nowrap">
                      <IconLayoutKanban size={16} />
                      Board
                    </Group>
                  ),
                },
                {
                  value: 'list',
                  label: (
                    <Group gap={6} wrap="nowrap">
                      <IconList size={16} />
                      List
                    </Group>
                  ),
                },
              ]}
              data-shipments-view
            />
          </>
        }
      />

      <FilterBar>
        <FilterBar.Col span={3}>
          <TextInput
            label="Search"
            placeholder="Ref, container no., B/L, vessel or order no."
            leftSection={<IconSearch size={16} />}
            value={filters.search}
            onChange={(e) => setFilter('search', e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') grid.commitFilters()
            }}
            rightSection={filters.search ? <CloseButton size="sm" aria-label="Clear search" onClick={() => setFilter('search', '')} /> : null}
            data-shipments-search
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <SearchSelect
            label="Supplier"
            placeholder="All suppliers"
            load={loadSuppliers}
            value={filters.supplierId}
            onChange={(next) => setFilter('supplierId', next)}
            clearable
            nothingFoundMessage="No supplier matches"
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <SearchSelect
            label="Purchase order"
            placeholder="Type an order no. or supplier"
            load={orderLoader}
            resolve={canViewOrders ? resolvePurchaseDocument : undefined}
            value={filters.purchaseOrderId}
            onChange={(next) => setFilter('purchaseOrderId', next)}
            clearable
            nothingFoundMessage="No order matches"
          />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select label="Branch" placeholder="All branches" data={branchOptions} value={filters.branchId} onChange={(next) => setFilter('branchId', next)} clearable searchable nothingFoundMessage="No branch matches" />
        </FilterBar.Col>
        <FilterBar.Col span={3}>
          <Select label="Place" placeholder="Any place" data={placeOptions} value={filters.placeId} onChange={(next) => setFilter('placeId', next)} clearable searchable nothingFoundMessage="No place matches" data-shipments-place />
        </FilterBar.Col>
        <FilterBar.Col span={7}>
          <Group gap="lg" wrap="wrap" mb={8}>
            <Switch label="Late only" checked={filters.lateOnly} onChange={(e) => setFilter('lateOnly', e.currentTarget.checked)} data-shipments-late />
            <Switch label="With a planned leg" checked={filters.withPlannedLeg} onChange={(e) => setFilter('withPlannedLeg', e.currentTarget.checked)} data-shipments-planned />
            <Switch label="Show received (30 days)" checked={filters.showReceived} onChange={(e) => setFilter('showReceived', e.currentTarget.checked)} data-shipments-received />
          </Group>
        </FilterBar.Col>
        <FilterBar.Col span={2}>
          <Button variant="default" leftSection={<IconFilterOff size={16} />} onClick={grid.clearFilters} disabled={grid.isDefault}>
            Clear Filters
          </Button>
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md">
          {error}
        </Alert>
      ) : null}

      <ContainerSelectionBar rows={selectable} selected={selectedRows} onSelectedChange={setSelectedRows} onChanged={reload} returnQuery="?from=shipments" />

      {data === null ? (
        loading ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : null
      ) : view === 'list' ? (
        <ShipmentsList
          canOpenContainers={canViewContainers}
          cards={cards}
          titles={titles}
          selected={selectedRows}
          onSelectedChange={setSelectedRows}
          onOpen={setDrawerCard}
          stepOf={stepOf}
          onStep={(card) => nextStep.run(card)}
          links={links}
          fetching={loading}
          emptyText={emptyText}
        />
      ) : cards.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl" data-shipments-empty>
          {emptyText}
        </Text>
      ) : wide ? (
        // Side by side, each column scrolling on its own so its header stays in view; seven columns scroll sideways inside
        // the board, never the page.
        <div style={{ overflowX: 'auto', paddingBottom: 4 }} data-shipments-board>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {columns.map((c) => (
              <div key={c.phase} style={{ flex: '1 0 184px', minWidth: 184 }}>
                {column(c.phase, 'max(360px, calc(100dvh - 380px))')}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div data-shipments-board data-shipments-phone>
          <Tabs value={shownTab} onChange={(next) => setTab(next as ShipmentPhase)} variant="pills" mb="sm">
            <ScrollArea type="auto" scrollbars="x" offsetScrollbars="x">
              <Tabs.List style={{ flexWrap: 'nowrap' }}>
                {columns.map((c) => (
                  <Tabs.Tab
                    key={c.phase}
                    value={c.phase}
                    rightSection={
                      <Badge size="xs" variant="light" color={c.count > 0 ? 'brand' : 'gray'} circle={c.count < 10}>
                        {formatNumber(c.count)}
                      </Badge>
                    }
                    style={{ whiteSpace: 'nowrap' }}
                    data-shipments-tab={c.phase}
                  >
                    {c.title}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </ScrollArea>
          </Tabs>
          {shownTab ? column(shownTab) : null}
        </div>
      )}

      {drawerCard ? (
        <ShipmentDrawer
          key={drawerCard.id}
          card={drawerCard}
          columnTitle={titles[drawerCard.phase] ?? drawerCard.phase}
          onClose={() => setDrawerCard(null)}
          stepOf={(container: ContainerDto) => (canViewContainers ? nextStep.action(container) : null)}
          onStep={(container: ContainerDto) => {
            // The step's dialog is the only one on screen: the drawer closes first.
            setDrawerCard(null)
            nextStep.run(container)
          }}
          links={links}
          canViewContainer={canViewContainers}
        />
      ) : null}

      {nextStep.dialogs}
    </div>
  )
}
