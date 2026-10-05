import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconFileSpreadsheet, IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { CONTAINER_STATUSES, containerStatusColour } from '../../api/logistics/containers'
import {
  movementsApi,
  type MovementContainerCandidateDto,
  type MovementDto,
  type MovementPlaceQuery,
} from '../../api/logistics/movements'
import { partiesApi } from '../../api/masterdata/parties'
import { purchaseDocumentsApi } from '../../api/purchase/documents'
import type { PagedResult } from '../../api/types'
import { formatNumber } from '../format'
import { notify } from '../ui/notify'
import { ImportMovementContainersModal } from './ImportMovementContainersModal'
import {
  fromCandidate,
  fromMatch,
  fromSaved,
  matchAll,
  placeKey,
  placeText,
  WHOLE_BADGE,
  type CardContainer,
} from './movementContainers'

const CONTAINERS_ROUTE = '/logistics/containers'

/** The API's page ceiling: more candidates than this and the reader is asked to narrow the filters. */
const PAGE_SIZE = 200

/** Offloaded, closed and cancelled containers are never candidates. */
const STATUS_OPTIONS = CONTAINER_STATUSES.filter((s) => s.value <= 5).map((s) => ({
  value: String(s.value),
  label: s.label,
}))

type Option = { value: string; label: string }

interface MovementContainersCardProps {
  /** The saved movement; null = not saved yet. */
  movement: MovementDto | null
  /** A completed or cancelled movement, or a reader who may not change it: its containers, nothing to tick. */
  readOnly: boolean
  /** From, To and type on the page, saved or not: the place rules judge the containers against all three. */
  fromPlaceId: number | null
  toPlaceId: number | null
  movementTypeId: number | null
  fromName: string
  /** The ticked containers: what the movement holds once saved. */
  ticked: CardContainer[]
  /** Ticking, unticking, the import and a new From change it; the page counts it as an unsaved change. */
  onTickedChange: (next: CardContainer[]) => void
}

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`

/**
 * THE CARD IS THE LIST: the movement's containers, ticked and first, then the containers that can join it from the
 * From on the page (container-candidates, the place rules of script 49), unticked. Ticked = on this movement once
 * saved. A new From reloads the list at once and unticks the ticked ones that are not there any more. The switch
 * adds the containers that cannot be added, greyed, with the reason in red.
 */
export function MovementContainersCard({
  movement,
  readOnly,
  fromPlaceId,
  toPlaceId,
  movementTypeId,
  fromName,
  ticked,
  onTickedChange,
}: MovementContainersCardProps) {
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [purchaseOrderId, setPurchaseOrderId] = useState<string | null>(null)
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [includeBlocked, setIncludeBlocked] = useState(false)
  const [orders, setOrders] = useState<Option[]>([])
  const [suppliers, setSuppliers] = useState<Option[]>([])
  const [importOpen, setImportOpen] = useState(false)
  /** The last answer and the query it answers: loading is "the answer is for another query". */
  const [answer, setAnswer] = useState<{
    key: string
    data: PagedResult<MovementContainerCandidateDto> | null
    error: string | null
  } | null>(null)
  /** Saved containers judged for the place on the page (they are not candidates: they are on the movement). */
  const [judged, setJudged] = useState<Map<number, CardContainer>>(new Map())

  const movementId = movement?.id ?? null
  const query: MovementPlaceQuery | null =
    fromPlaceId === null ? null : { movementId, fromPlaceId, toPlaceId, movementTypeId }
  const key = query ? placeKey(query) : null
  const editable = !readOnly && query !== null

  // A typed search applies 350 ms after the last key; clearing applies at once.
  useEffect(() => {
    if (search.trim() === appliedSearch) return
    const timer = setTimeout(() => setAppliedSearch(search.trim()), search.trim() === '' ? 0 : 350)
    return () => clearTimeout(timer)
  }, [search, appliedSearch])

  useEffect(() => {
    if (readOnly) return
    partiesApi
      .lookup({ partyType: 'Supplier', activeOnly: false })
      .then((list) =>
        setSuppliers(list.map((p) => ({ value: String(p.id), label: `${p.partyCode} - ${p.partyName}` }))),
      )
      .catch(() => {})
    // The orders' own permission: without it the filter simply offers nothing.
    purchaseDocumentsApi
      .list({ documentTypeCode: 'PO', pageSize: 200, sortBy: 'DocumentDate', sortDir: 'desc' })
      .then((result) =>
        setOrders(
          result.items
            .filter((o) => o.documentNumber && o.status !== 'Draft' && o.status !== 'Cancelled')
            .map((o) => ({ value: String(o.id), label: `${o.documentNumber} - ${o.supplierName}` })),
        ),
      )
      .catch(() => {})
  }, [readOnly])

  /* ── the candidates of the From on the page, reloaded at once when it changes ── */

  const candidateQuery = useMemo(
    () =>
      query === null
        ? null
        : {
            movementId: query.movementId ?? undefined,
            fromPlaceId: query.fromPlaceId,
            toPlaceId: query.toPlaceId ?? undefined,
            movementTypeId: query.movementTypeId ?? undefined,
            search: appliedSearch || undefined,
            purchaseOrderId: purchaseOrderId === null ? undefined : Number(purchaseOrderId),
            supplierId: supplierId === null ? undefined : Number(supplierId),
            status: status === null ? undefined : Number(status),
            includeBlocked: includeBlocked || undefined,
            pageSize: PAGE_SIZE,
          },
    // query is rebuilt every render; its parts are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      movementId,
      fromPlaceId,
      toPlaceId,
      movementTypeId,
      appliedSearch,
      purchaseOrderId,
      supplierId,
      status,
      includeBlocked,
    ],
  )
  const candidateKey = candidateQuery ? JSON.stringify(candidateQuery) : null

  useEffect(() => {
    if (readOnly || candidateQuery === null || candidateKey === null) return
    const controller = new AbortController()
    movementsApi
      .containerCandidates(candidateQuery, controller.signal)
      .then((data) => setAnswer({ key: candidateKey, data, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setAnswer({
          key: candidateKey,
          data: null,
          error: err instanceof ApiError ? err.message : 'The containers could not be loaded.',
        })
      })
    return () => controller.abort()
  }, [readOnly, candidateQuery, candidateKey])

  /* ── the ticked and the saved containers judged for the place on the page ──
     A change of From, To or type is made by the reader: the ticked containers the server now refuses are unticked
     (and said so). The first judgement of a page that opens is not a change: refused ones stay ticked, in red. */

  const tickedRef = useRef(ticked)
  const onTickedRef = useRef(onTickedChange)
  useEffect(() => {
    tickedRef.current = ticked
    onTickedRef.current = onTickedChange
  })

  // Declared before the judging below, so it runs first: a new key that follows another one is the reader's change.
  const last = useRef<{ key: string; fromPlaceId: number } | null>(null)
  const untickFor = useRef<{ key: string; fromChanged: boolean } | null>(null)
  useEffect(() => {
    if (key === null || fromPlaceId === null) return
    if (last.current !== null && last.current.key !== key)
      untickFor.current = { key, fromChanged: last.current.fromPlaceId !== fromPlaceId }
    last.current = { key, fromPlaceId }
  }, [key, fromPlaceId])

  const saved = useMemo(() => movement?.containers ?? [], [movement])
  const toJudge = useMemo(() => {
    if (!editable || key === null) return []
    const list = new Map<number, string>()
    for (const c of ticked) if (c.place?.key !== key) list.set(c.containerId, c.containerRef)
    for (const c of saved)
      if (judged.get(c.containerId)?.place?.key !== key && !list.has(c.containerId))
        list.set(c.containerId, c.containerRef)
    return [...list]
  }, [editable, key, ticked, saved, judged])
  const judgeKey = toJudge.map(([id]) => id).join(',')

  useEffect(() => {
    if (query === null || key === null || toJudge.length === 0) return
    const controller = new AbortController()
    matchAll(
      query,
      toJudge.map(([, ref]) => ref),
      controller.signal,
    )
      .then((rows) => {
        const byId = new Map<number, CardContainer>()
        for (const r of rows) {
          const target = toJudge[r.rowNo - 1]
          if (target && r.containerId === target[0])
            byId.set(target[0], fromMatch({ ...r, containerId: target[0] }, key))
        }
        setJudged((current) => {
          const next = new Map(current)
          for (const [id, c] of byId) next.set(id, c)
          return next
        })
        const current = tickedRef.current
        const change = untickFor.current?.key === key ? untickFor.current : null
        if (change) untickFor.current = null
        const refused = change ? current.filter((c) => byId.get(c.containerId)?.place?.reason) : []
        const next = current
          .filter((c) => !refused.includes(c))
          .map((c) => {
            const fresh = byId.get(c.containerId)
            return fresh ? { ...fresh, currentLocation: c.currentLocation } : c
          })
        onTickedRef.current(next)
        if (change && refused.length > 0) {
          const unticked = plural(refused.length, 'container was', 'containers were')
          notify.warning(
            change.fromChanged
              ? `${unticked} unticked: ${refused.length === 1 ? 'it is' : 'they are'} not at ${fromName}.`
              : `${unticked} unticked: ${refused.length === 1 ? 'it cannot' : 'they cannot'} go on this movement.`,
          )
        }
      })
      .catch(() => {})
    return () => controller.abort()
    // judgeKey names the containers to judge; query and toJudge follow it and the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, judgeKey])

  /* ── the rows: ticked first, then the saved ones unticked, then the candidates ── */

  const tickedIds = useMemo(() => new Set(ticked.map((c) => c.containerId)), [ticked])
  const savedIds = useMemo(() => new Set(saved.map((c) => c.containerId)), [saved])
  const loading = editable && (answer === null || answer.key !== candidateKey)
  const candidates = answer && answer.key === candidateKey ? answer.data : null
  const rows: CardContainer[] = useMemo(() => {
    if (!editable || key === null) return ticked
    const unticked = saved
      .filter((c) => !tickedIds.has(c.containerId))
      .map((c) => judged.get(c.containerId) ?? fromSaved(c))
    const fresh = (candidates?.items ?? [])
      .filter((c) => !tickedIds.has(c.id) && !savedIds.has(c.id))
      .map((c) => fromCandidate(c, key))
    return [...ticked, ...unticked, ...fresh]
  }, [editable, key, ticked, saved, tickedIds, savedIds, judged, candidates])

  const judgedNow = (c: CardContainer) => (c.place !== null && c.place.key === key ? c.place : null)
  const selectable = (c: CardContainer) =>
    tickedIds.has(c.containerId) || (judgedNow(c) !== null && !judgedNow(c)?.reason && !judgedNow(c)?.unknown)
  const selectableRows = rows.filter(selectable)
  const allTicked = selectableRows.length > 0 && selectableRows.every((c) => tickedIds.has(c.containerId))
  const someTicked = selectableRows.some((c) => tickedIds.has(c.containerId))

  function toggle(c: CardContainer, on: boolean) {
    onTickedChange(on ? [...ticked, c] : ticked.filter((t) => t.containerId !== c.containerId))
  }

  function toggleAll(on: boolean) {
    if (on) onTickedChange([...ticked, ...selectableRows.filter((c) => !tickedIds.has(c.containerId))])
    else {
      const listed = new Set(selectableRows.map((c) => c.containerId))
      onTickedChange(ticked.filter((c) => !listed.has(c.containerId)))
    }
  }

  /** From the import: the valid numbers are ticked and come to the top. */
  function tickFromImport(list: CardContainer[]) {
    const fresh = list.filter((c) => !tickedIds.has(c.containerId))
    if (fresh.length === 0) return
    onTickedChange([...fresh, ...ticked])
    notify.info(`${plural(fresh.length, 'container', 'containers')} ticked - not saved yet.`)
  }

  const savedChanged =
    movement !== null && (ticked.length !== saved.length || ticked.some((c) => !savedIds.has(c.containerId)))

  return (
    <Paper radius="lg" p="md" withBorder data-movement-containers>
      <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
        <Title order={5}>
          Containers{' '}
          <Text span c="dimmed" fz="sm" fw={400}>
            ({formatNumber(ticked.length)})
          </Text>
        </Title>
        {readOnly ? null : (
          <Tooltip
            label="Choose the From first: only the containers that are there can be imported."
            disabled={query !== null}
            withArrow
          >
            <Button
              size="xs"
              variant="light"
              leftSection={<IconFileSpreadsheet size={14} />}
              data-disabled={query === null || undefined}
              onClick={(event) => (query === null ? event.preventDefault() : setImportOpen(true))}
            >
              Import from Excel…
            </Button>
          </Tooltip>
        )}
      </Group>

      {!readOnly && query === null ? (
        <Text c="dimmed" fz="sm" ta="center" py="md" data-choose-from>
          Choose the From: the containers that are there appear here.
        </Text>
      ) : (
        <>
          {editable ? (
            <>
              <Group gap="sm" align="flex-end" wrap="wrap" mb="xs">
                <TextInput
                  label="Search"
                  placeholder="Ref, container no., B/L, order, supplier"
                  leftSection={<IconSearch size={14} />}
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setAppliedSearch(search.trim())
                  }}
                  style={{ flex: '1 1 240px' }}
                />
                <Select
                  label="Purchase order"
                  placeholder="Any"
                  data={orders}
                  value={purchaseOrderId}
                  onChange={setPurchaseOrderId}
                  searchable
                  clearable
                  style={{ flex: '1 1 200px' }}
                />
                <Select
                  label="Supplier"
                  placeholder="Any"
                  data={suppliers}
                  value={supplierId}
                  onChange={setSupplierId}
                  searchable
                  clearable
                  style={{ flex: '1 1 200px' }}
                />
                <Select
                  label="Status"
                  placeholder="Any"
                  data={STATUS_OPTIONS}
                  value={status}
                  onChange={setStatus}
                  clearable
                  style={{ flex: '0 1 160px' }}
                />
              </Group>
              <Group justify="space-between" wrap="wrap" gap="xs" mb="xs">
                <Switch
                  label="Show the containers that cannot be added"
                  checked={includeBlocked}
                  onChange={(event) => setIncludeBlocked(event.currentTarget.checked)}
                />
                <Group gap="sm">
                  {loading ? <Loader size="xs" /> : null}
                  <Text fz="sm" fw={500} data-ticked-counter>
                    {formatNumber(ticked.length)} ticked of {formatNumber(selectableRows.length)}
                  </Text>
                </Group>
              </Group>
              {candidates && candidates.totalCount > candidates.items.length ? (
                <Alert color="blue" variant="light" py={6} mb="xs">
                  Showing {formatNumber(candidates.items.length)} of {formatNumber(candidates.totalCount)}: narrow the
                  filters.
                </Alert>
              ) : null}
              {answer?.error && answer.key === candidateKey ? (
                <Alert color="red" variant="light" mb="xs">
                  {answer.error}
                </Alert>
              ) : null}
              {savedChanged ? (
                <Text fz="xs" c="blue.7" mb="xs">
                  Not saved yet: save the movement to keep the ticked containers.
                </Text>
              ) : null}
            </>
          ) : null}

          {rows.length === 0 ? (
            <Text c="dimmed" fz="sm" ta="center" py="sm">
              {readOnly
                ? 'No container on this movement.'
                : loading
                  ? 'Reading the containers…'
                  : `No container at ${fromName} can join this movement${includeBlocked ? '.' : ': the switch shows the ones that cannot be added.'}`}
            </Text>
          ) : (
            <ScrollArea type="auto">
              <Table miw={1180} verticalSpacing={4} data-movement-container-rows>
                <Table.Thead>
                  <Table.Tr>
                    {editable ? (
                      <Table.Th w={36}>
                        <Checkbox
                          aria-label="Tick every container of the list"
                          checked={allTicked}
                          indeterminate={!allTicked && someTicked}
                          disabled={selectableRows.length === 0}
                          onChange={(event) => toggleAll(event.currentTarget.checked)}
                        />
                      </Table.Th>
                    ) : null}
                    <Table.Th>Container Ref.</Table.Th>
                    <Table.Th>Container No.</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Order(s)</Table.Th>
                    <Table.Th>Supplier(s)</Table.Th>
                    <Table.Th>Items</Table.Th>
                    <Table.Th ta="right">Pieces</Table.Th>
                    <Table.Th>Place</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Note</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((c) => {
                    const on = tickedIds.has(c.containerId)
                    const place = judgedNow(c)
                    const refused = editable ? (place?.reason ?? null) : null
                    const canTick = selectable(c)
                    return (
                      <Fragment key={c.containerId}>
                        <Table.Tr
                          data-container-row={c.containerRef}
                          data-ticked={on || undefined}
                          bg={on ? 'var(--mantine-color-blue-0)' : undefined}
                          style={{
                            ...(!on && refused ? { opacity: 0.75 } : {}),
                            ...(refused ? { borderBottom: 0 } : {}),
                          }}
                        >
                          {editable ? (
                            <Table.Td>
                              <Tooltip label={refused ?? ''} disabled={canTick || !refused} withArrow multiline w={280}>
                                <span>
                                  <Checkbox
                                    aria-label={`Tick ${c.containerRef}`}
                                    checked={on}
                                    disabled={!canTick}
                                    onChange={(event) => toggle(c, event.currentTarget.checked)}
                                  />
                                </span>
                              </Tooltip>
                            </Table.Td>
                          ) : null}
                          <Table.Td style={{ whiteSpace: 'nowrap' }}>
                            <Anchor component={Link} to={`${CONTAINERS_ROUTE}/${c.containerId}`} fz="sm" fw={600}>
                              {c.containerRef}
                            </Anchor>
                          </Table.Td>
                          <Table.Td style={{ whiteSpace: 'nowrap' }}>{c.containerNo ?? '—'}</Table.Td>
                          <Table.Td>{c.containerTypeCode || '—'}</Table.Td>
                          <Table.Td style={{ whiteSpace: 'nowrap' }}>{c.orderNumbers ?? '—'}</Table.Td>
                          <Table.Td>{c.supplierNames ?? '—'}</Table.Td>
                          <Table.Td>{c.itemSummary ?? '—'}</Table.Td>
                          <Table.Td ta="right">{formatNumber(c.pieces)}</Table.Td>
                          <Table.Td maw={260}>
                            <Text fz="sm">
                              {place && !place.unknown ? placeText(place) : (c.currentLocation ?? '—')}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            {c.statusName ? (
                              <Badge
                                color={containerStatusColour(c.status)}
                                variant={c.status === 7 ? 'filled' : 'light'}
                                styles={WHOLE_BADGE}
                              >
                                {c.statusName}
                              </Badge>
                            ) : (
                              '—'
                            )}
                          </Table.Td>
                          <Table.Td maw={320}>
                            {refused ? (
                              <Text fz="xs" c="red.7" data-container-reason>
                                {refused}
                              </Text>
                            ) : place?.note ? (
                              <Text fz="xs" c="dimmed" data-container-note>
                                {place.note}
                              </Text>
                            ) : null}
                          </Table.Td>
                        </Table.Tr>
                        {refused ? (
                          // The reason again across the row: on a narrow card the Note column is scrolled out of view.
                          <Table.Tr bg={on ? 'var(--mantine-color-blue-0)' : undefined}>
                            <Table.Td colSpan={editable ? 11 : 10} pt={0}>
                              <Text fz="xs" c="red.7">
                                {c.containerRef}: {refused}
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </>
      )}

      {importOpen && query !== null ? (
        <ImportMovementContainersModal
          query={query}
          movementNo={movement?.movementNo ?? null}
          fromName={fromName}
          tickedIds={tickedIds}
          savedIds={savedIds}
          onTick={tickFromImport}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
    </Paper>
  )
}
