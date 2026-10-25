import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Drawer,
  Grid,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks'
import { IconPlus, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  transferLevelsApi,
  type TransferBelowMinItemDto,
  type TransferBelowMinResult,
  type TransferBelowMinUnitDto,
  type TransferFillResult,
  type TransferOrderDto,
} from '../../api/inventory/transfers'
import { brandsApi } from '../../api/masterdata/brands'
import { itemFamiliesApi } from '../../api/masterdata/itemFamilies'
import type { BrandLookupDto, ItemFamilyLookupDto } from '../../api/types'
import { brandLabel, familyOptions } from '../../pages/inventory/lookups'
import { unitLabel } from '../documents/documentKind'
import { formatNumber } from '../format'
import { notify } from '../ui/notify'
import { countLabel, isStaleOrderError, STALE_ORDER } from './transferLevels'

interface AddBelowMinDrawerProps {
  opened: boolean
  /** A SAVED draft, as the page holds it (the toolbar is disabled while the page has unsaved changes). */
  order: TransferOrderDto
  onClose(): void
  /** Added: the server's answer, the order re-read in it. */
  onApplied(result: TransferFillResult): void
  /** Refused because the order changed meanwhile: the page reads it again. */
  onStale(): void
}

/**
 * (91) "Add items below Min - {To}" (3.6.5): the destination's stock levels, to add the items it lacks as new lines.
 *
 * IT REMOUNTS ON OPEN (LoadItemsDrawer's way), so every visit starts from the defaults and from fresh figures. Each row is
 * an item with a level at To (only those below Min by default), where To stands, what From has available, and the
 * server's proposal for each of the item's units (inventory.fn_TransferFill_Plan, the very rule of Fill to Max): the
 * Need rounded up to whole units, capped at what From has. PRE-TICKED: below Min, not on the order, the base unit
 * filled. NOT TICKABLE: an item already on the order ("on the order: use Fill to Max"), or a unit the plan cannot fill.
 *
 * "Add {n} items" posts the ticked items, each once, in the unit chosen, with the ORDER's row version
 * (POST …/fill-to-max with addItems): the server works the plan out again and adds one line per item at the end.
 */
export function AddBelowMinDrawer(props: AddBelowMinDrawerProps) {
  const phone = useMediaQuery('(max-width: 48em)')
  return (
    <Drawer
      opened={props.opened}
      onClose={props.onClose}
      position="right"
      size={phone ? '100%' : 'min(1100px, 100%)'}
      title={`Add items below Min - ${props.order.to.code}`}
      padding="md"
    >
      {props.opened && <AddBelowMin {...props} phone={phone === true} />}
    </Drawer>
  )
}

function AddBelowMin({ order, onClose, onApplied, onStale, phone }: AddBelowMinDrawerProps & { phone: boolean }) {
  const from = order.from.code
  const to = order.to.code

  const [families, setFamilies] = useState<ItemFamilyLookupDto[]>([])
  const [brands, setBrands] = useState<BrandLookupDto[]>([])
  const [familyId, setFamilyId] = useState<string | null>(null)
  const [brandId, setBrandId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 350)
  /** The search Enter applied at once (the conventions' Filtering): it wins while the box still holds it. */
  const [entered, setEntered] = useState<string | null>(null)
  const appliedSearch = entered !== null && entered === search ? entered : debouncedSearch
  const [onlyBelowMin, setOnlyBelowMin] = useState(true)

  /**
   * THE ANSWER REMEMBERS WHICH FILTERS IT IS FOR, and "loading" is derived from it: the table is dimmed while the filters
   * on screen are not the ones answered (a search still being typed included), and never stays dimmed when a search is
   * typed and erased before it was sent (it was a state set on every keystroke, cleared only by an answer).
   */
  const wanted = JSON.stringify([appliedSearch.trim(), familyId, brandId, onlyBelowMin])
  const [result, setResult] = useState<TransferBelowMinResult & { key: string | null }>({ key: null, items: [], units: [] })
  const loading = result.key !== wanted || search.trim() !== appliedSearch.trim()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** The unit chosen per item (its base unit until changed), and the items ticked. */
  const [unitByItem, setUnitByItem] = useState<Map<number, number>>(() => new Map())
  const [ticked, setTicked] = useState<Set<number>>(() => new Set())
  /** Items already shown once: a filter that brings one back keeps what the reader chose for it. */
  const seen = useRef(new Set<number>())

  useEffect(() => {
    itemFamiliesApi
      .lookup()
      .then(setFamilies)
      .catch(() => {})
    brandsApi
      .lookup()
      .then(setBrands)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const key = wanted
    const query = JSON.parse(key) as [string, string | null, string | null, boolean]
    // The last request wins: the previous one is aborted by this effect's cleanup.
    transferLevelsApi
      .belowMin(
        order.id,
        {
          search: query[0],
          itemFamilyId: query[1] === null ? undefined : Number(query[1]),
          brandId: query[2] === null ? undefined : Number(query[2]),
          onlyBelowMin: query[3],
        },
        controller.signal,
      )
      .then((answer) => {
        const fresh = answer.items.filter((item) => !seen.current.has(item.itemId))
        for (const item of fresh) seen.current.add(item.itemId)
        if (fresh.length > 0) {
          setUnitByItem((current) => {
            const next = new Map(current)
            for (const item of fresh) next.set(item.itemId, item.baseUnitId)
            return next
          })
          // Pre-ticked: below Min, not on the order, its base unit filled.
          setTicked((current) => {
            const next = new Set(current)
            for (const item of fresh) {
              const base = answer.units.find((u) => u.itemId === item.itemId && u.itemUnitId === item.baseUnitId)
              if (item.isBelowMin && !item.onOrder && base?.outcome === 'Filled') next.add(item.itemId)
            }
            return next
          })
        }
        setResult({ key, items: answer.items, units: answer.units })
        setError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setResult({ key, items: [], units: [] })
        setError(err instanceof ApiError ? err.message : 'The items below Min could not be read.')
      })
    return () => controller.abort()
  }, [order.id, wanted])

  const unitsByItem = useMemo(() => {
    const map = new Map<number, TransferBelowMinUnitDto[]>()
    for (const unit of result.units) {
      const list = map.get(unit.itemId) ?? []
      list.push(unit)
      map.set(unit.itemId, list)
    }
    return map
  }, [result.units])

  function unitOf(item: TransferBelowMinItemDto): TransferBelowMinUnitDto | undefined {
    const units = unitsByItem.get(item.itemId) ?? []
    const chosen = unitByItem.get(item.itemId) ?? item.baseUnitId
    return units.find((u) => u.itemUnitId === chosen) ?? units.find((u) => u.isBaseUnit) ?? units[0]
  }

  const tickable = (item: TransferBelowMinItemDto) => !item.onOrder && unitOf(item)?.outcome === 'Filled'

  function tick(item: TransferBelowMinItemDto, checked: boolean) {
    setTicked((current) => {
      const next = new Set(current)
      if (checked && tickable(item)) next.add(item.itemId)
      else next.delete(item.itemId)
      return next
    })
  }

  /** Another unit: its own proposal; a unit the plan cannot fill takes the tick away. */
  function chooseUnit(item: TransferBelowMinItemDto, itemUnitId: number) {
    setUnitByItem((current) => new Map(current).set(item.itemId, itemUnitId))
    const unit = (unitsByItem.get(item.itemId) ?? []).find((u) => u.itemUnitId === itemUnitId)
    if (unit?.outcome !== 'Filled') tick(item, false)
  }

  // Only what is on screen counts and is sent: a filter that hides a ticked item leaves it out.
  const tickedItems = result.items.filter((item) => ticked.has(item.itemId) && tickable(item))

  async function add() {
    if (tickedItems.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const addItems = tickedItems.map((item) => ({ itemId: item.itemId, itemUnitId: unitOf(item)?.itemUnitId ?? null }))
      onApplied(await transferLevelsApi.fillToMax(order.id, order.rowVersion, addItems))
    } catch (err) {
      if (isStaleOrderError(err)) {
        notify.error(STALE_ORDER)
        onStale()
        onClose()
        return
      }
      setError(err instanceof ApiError ? err.message : 'The items could not be added.')
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) onStale()
    } finally {
      setBusy(false)
    }
  }

  /* ── the cells ── */

  /** "2 BOX = 24 pcs", "20 PC"; "—" when the unit is not filled. */
  function proposed(unit: TransferBelowMinUnitDto | undefined) {
    if (!unit || unit.outcome !== 'Filled' || unit.proposedQuantity === null) return '—'
    const head = `${formatNumber(unit.proposedQuantity)} ${unit.unitName}`
    return unit.packingFormula > 1 ? `${head} = ${formatNumber(unit.proposedBase)} pcs` : head
  }

  /** "capped", "nothing available at {From}", "on the order: use Fill to Max", "{From} goes below its own Min". */
  function note(item: TransferBelowMinItemDto, unit: TransferBelowMinUnitDto | undefined): string {
    const parts: string[] = []
    if (item.onOrder) parts.push('on the order: use Fill to Max')
    if (unit?.outcome === 'NothingAvailable') parts.push(`nothing available at ${from}`)
    if (unit?.outcome === 'AtOrAboveMin') parts.push('at or above Min')
    if (unit?.outcome === 'Inactive') parts.push('inactive item')
    if (unit?.isCapped) parts.push('capped')
    if (unit?.fromBelowMinAfter) parts.push(`${from} goes below its own Min`)
    return parts.join(' · ')
  }

  function unitSelect(item: TransferBelowMinItemDto) {
    const units = unitsByItem.get(item.itemId) ?? []
    const unit = unitOf(item)
    return (
      <Select
        aria-label={`Unit of ${item.itemCode}`}
        size="xs"
        data={units.map((u) => ({ value: String(u.itemUnitId), label: unitLabel(u.unitName, u.packingFormula) }))}
        value={unit ? String(unit.itemUnitId) : null}
        onChange={(next) => {
          if (next) chooseUnit(item, Number(next))
        }}
        allowDeselect={false}
        disabled={busy || units.length <= 1}
        comboboxProps={{ withinPortal: true }}
        // "Box (x12)" whole: at 90 px it read "Box (x1…".
        w={phone ? '100%' : 108}
      />
    )
  }

  function tickBox(item: TransferBelowMinItemDto) {
    const can = tickable(item)
    return (
      <Checkbox
        aria-label={`Add ${item.itemCode}`}
        checked={can && ticked.has(item.itemId)}
        disabled={!can || busy}
        onChange={(event) => tick(item, event.currentTarget.checked)}
      />
    )
  }

  const level = (value: number | null) => (value === null ? '—' : formatNumber(value))
  const comingIn = (item: TransferBelowMinItemDto) => item.toInOnTheWayBase + item.toInToDispatchBase
  const comingInHint = (item: TransferBelowMinItemDto) =>
    `${formatNumber(item.toInOnTheWayBase)} on the way · ${formatNumber(item.toInToDispatchBase)} still to dispatch`

  function projected(item: TransferBelowMinItemDto) {
    return (
      <Text
        fz="sm"
        ta={phone ? undefined : 'right'}
        fw={item.isBelowMin ? 700 : 400}
        c={item.isBelowMin ? 'red' : undefined}
      >
        {formatNumber(item.toProjectedBeforeBase)}
      </Text>
    )
  }

  const empty = onlyBelowMin ? `No item is below its Min at ${to}.` : `No item has a level at ${to}.`
  const items = result.items

  return (
    <Stack gap="md" data-add-below-min>
      <Grid align="flex-end">
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Select
            label="Family"
            placeholder="All families"
            data={familyOptions(families)}
            value={familyId}
            onChange={setFamilyId}
            clearable
            searchable
            comboboxProps={{ withinPortal: true }}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Select
            label="Brand"
            placeholder="All brands"
            data={brands.map((b) => ({ value: String(b.id), label: brandLabel(b) }))}
            value={brandId}
            onChange={setBrandId}
            clearable
            searchable
            comboboxProps={{ withinPortal: true }}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 12, md: 6 }}>
          <TextInput
            label="Search"
            placeholder="Item code or name"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setEntered(event.currentTarget.value)
            }}
            data-autofocus
          />
        </Grid.Col>
        <Grid.Col span={12}>
          <Switch
            label="Only items below Min"
            description={`Off: every item with a level at ${to}`}
            checked={onlyBelowMin}
            onChange={(event) => setOnlyBelowMin(event.currentTarget.checked)}
          />
        </Grid.Col>
      </Grid>

      {error && <Alert color="red">{error}</Alert>}

      {loading && items.length === 0 ? (
        <Group justify="center" py="lg">
          <Loader size="sm" />
        </Group>
      ) : phone ? (
        <Stack gap="sm">
          {items.map((item) => {
            const unit = unitOf(item)
            const remark = note(item, unit)
            return (
              <Paper key={item.itemId} withBorder radius="md" p="sm" data-below-min-item={item.itemCode}>
                <Group gap="xs" wrap="nowrap" align="flex-start">
                  <Box mt={2}>{tickBox(item)}</Box>
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text fz="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
                      {item.itemCode}
                    </Text>
                    <Text fz="xs" c="dimmed">
                      {item.itemName}
                    </Text>
                    <Text fz="xs" c={item.isBelowMin ? 'red' : 'dimmed'} mt={4}>
                      {[
                        `On hand ${formatNumber(item.toOnHandBase)}`,
                        `Coming in ${formatNumber(comingIn(item))}`,
                        `Going out ${formatNumber(item.toOutToDispatchBase)}`,
                        `Projected ${formatNumber(item.toProjectedBeforeBase)}`,
                        `Min ${level(item.toMinBase)} / Max ${level(item.toMaxBase)}`,
                        `Need ${level(item.needBase)}`,
                        `Available at ${from} ${formatNumber(item.availableFromBase)}`,
                      ].join(' · ')}
                    </Text>
                  </Box>
                </Group>
                <Group gap="xs" mt="xs" wrap="nowrap" align="flex-end">
                  <Box style={{ flex: 1 }}>
                    <Text fz="xs" c="dimmed">
                      Unit
                    </Text>
                    {unitSelect(item)}
                  </Box>
                  <Box style={{ flex: 1 }}>
                    <Text fz="xs" c="dimmed">
                      Proposed
                    </Text>
                    <Text fz="sm" fw={500}>
                      {proposed(unit)}
                    </Text>
                  </Box>
                </Group>
                {remark ? (
                  <Text fz="xs" c={unit?.isCapped || unit?.fromBelowMinAfter ? 'orange.7' : 'dimmed'} mt={4}>
                    {remark}
                  </Text>
                ) : null}
              </Paper>
            )
          })}
          {items.length === 0 && !loading ? (
            <Text ta="center" c="dimmed" py="md" fz="sm">
              {empty}
            </Text>
          ) : null}
        </Stack>
      ) : (
        /* 1040: inside the drawer's 1100 px (its padding left out), so no row scrolls sideways at 1440. */
        <Table.ScrollContainer minWidth={1040}>
          <Table verticalSpacing="xs" horizontalSpacing="xs" striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36} />
                <Table.Th w={152}>Item</Table.Th>
                <Table.Th w={118}>Unit</Table.Th>
                <Table.Th w={70} ta="right">
                  On hand at {to}
                </Table.Th>
                <Table.Th w={66} ta="right">
                  Coming in
                </Table.Th>
                <Table.Th w={60} ta="right">
                  Going out
                </Table.Th>
                <Table.Th w={72} ta="right">
                  Projected
                </Table.Th>
                <Table.Th w={48} ta="right">
                  Min
                </Table.Th>
                <Table.Th w={48} ta="right">
                  Max
                </Table.Th>
                <Table.Th w={52} ta="right">
                  Need
                </Table.Th>
                <Table.Th w={80} ta="right">
                  Available at {from}
                </Table.Th>
                <Table.Th w={110} ta="right">
                  Proposed
                </Table.Th>
                <Table.Th w={140}>Note</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody style={loading ? { opacity: 0.5 } : undefined}>
              {items.map((item) => {
                const unit = unitOf(item)
                const remark = note(item, unit)
                return (
                  <Table.Tr key={item.itemId} data-below-min-item={item.itemCode}>
                    <Table.Td>{tickBox(item)}</Table.Td>
                    <Table.Td>
                      <Text fz="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
                        {item.itemCode}
                      </Text>
                      <Text fz="xs" c="dimmed" lineClamp={1}>
                        {item.itemName}
                      </Text>
                    </Table.Td>
                    <Table.Td>{unitSelect(item)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(item.toOnHandBase)}</Table.Td>
                    <Table.Td ta="right">
                      <Tooltip label={comingInHint(item)} withArrow withinPortal={false} floatingStrategy="fixed">
                        <span>{formatNumber(comingIn(item))}</span>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td ta="right">{formatNumber(item.toOutToDispatchBase)}</Table.Td>
                    <Table.Td ta="right">{projected(item)}</Table.Td>
                    <Table.Td ta="right">{level(item.toMinBase)}</Table.Td>
                    <Table.Td ta="right">{level(item.toMaxBase)}</Table.Td>
                    <Table.Td ta="right">{level(item.needBase)}</Table.Td>
                    <Table.Td ta="right">{formatNumber(item.availableFromBase)}</Table.Td>
                    <Table.Td ta="right">
                      <Text fz="sm" fw={500} style={{ whiteSpace: 'nowrap' }}>
                        {proposed(unit)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text fz="xs" c={unit?.isCapped || unit?.fromBelowMinAfter ? 'orange.7' : 'dimmed'}>
                        {remark}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
              {items.length === 0 && !loading ? (
                <Table.Tr>
                  <Table.Td colSpan={13}>
                    <Text ta="center" c="dimmed" py="lg" fz="sm">
                      {empty}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : null}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Group
        justify="space-between"
        pos="sticky"
        bottom={0}
        bg="var(--mantine-color-body)"
        py="sm"
        wrap="wrap"
        gap="xs"
        style={{ borderTop: '1px solid var(--mantine-color-gray-3)', zIndex: 2 }}
      >
        <Text fz="sm" c="dimmed" data-below-min-count>
          {formatNumber(items.length)} item(s), {formatNumber(tickedItems.length)} ticked
        </Text>
        <Group gap="xs">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            leftSection={<IconPlus size={16} />}
            disabled={tickedItems.length === 0}
            loading={busy}
            onClick={() => void add()}
            data-below-min-add
          >
            {countLabel('Add', tickedItems.length, 'item')}
          </Button>
        </Group>
      </Group>
    </Stack>
  )
}
