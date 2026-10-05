import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconBoxMultiple, IconPencil, IconPencilOff, IconPlus, IconTrash, IconWand } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  containersApi,
  type AutoPlanDto,
  type AutoPlanRequest,
  type CreateContainersFromPlanRequest,
  type CreatedContainerDto,
  type PlanOrderLineDto,
} from '../../api/logistics/containers'
import { containerTypesApi, type ContainerTypeLookupDto } from '../../api/masterdata/containerTypes'
import { partiesApi } from '../../api/masterdata/parties'
import { portLabel, portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import { warehousesApi } from '../../api/masterdata/warehouses'
import { invoiceContainersApi } from '../../api/purchase/invoiceContainers'
import type { PartyLookupDto, WarehouseLookupDto } from '../../api/types'
import { fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { supplierLabel } from '../purchase/purchaseKind'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { fillColour, fillLabel, FULL_TOLERANCE, isOverFull } from './containerFill'

/** The approved order the containers are planned for. */
export interface AutoPlanOrder {
  id: number
  documentNumber: string | null
  branchId: number
  warehouseId: number
}

/**
 * The auto-plan of an INVOICE shipped in containers (script 43): the order's dialog, for the pieces the invoice has
 * outside containers; what it creates is linked to the invoice in the same transaction.
 */
export interface AutoPlanInvoice {
  id: number
  documentNumber: string | null
  rowVersion: string | null
}

interface AutoPlanModalProps {
  order: AutoPlanOrder
  /** Plan for this invoice of the order instead of the whole order. */
  invoice?: AutoPlanInvoice
  /** containers.overcapacity: may create containers above 100 % after one confirmation. */
  canOverCapacity: boolean
  /** containers.confirm: offers "Confirm the containers after creating them". */
  canConfirm: boolean
  onClose(): void
  onCreated(created: CreatedContainerDto[]): void
}

interface PlanLine {
  poLineId: number
  quantity: number | ''
}

interface PlanBox {
  key: string
  lines: PlanLine[]
}

/** The proposal being edited, and the mixing it was made with. */
interface Proposal {
  boxes: PlanBox[]
  mix: boolean
}

const DEFAULT_TYPE_CODE = '40HC'

const ITEMS_ROUTE = '/inventory/items'

/** "Container 3 of 30: …" → 3; the row numbered 3 in the table is that container. */
function containerInError(message: string): number | null {
  const match = /^Container (\d+) of \d+:/.exec(message)
  return match ? Number(match[1]) : null
}

/** "Order line 2 (…): …" → 2. */
function orderLineInError(message: string): number | null {
  const match = /^Order line (\d+) /.exec(message)
  return match ? Number(match[1]) : null
}

function qty(line: PlanLine): number {
  return Number(line.quantity || 0)
}

/**
 * "Auto-plan containers…" on an approved purchase order: every container of the order in one go
 * (an order of 30 containers is 30 dialogs otherwise).
 *
 * 1. PIECES PER CONTAINER PER ITEM: the item's Container unit (Item Definition), nothing else since
 *    script 50 - no typed number, no container type capacity. A line whose item has none says so in red
 *    with a link to the item, and the plan cannot be proposed until every item has one.
 * 2. THE PROPOSAL IS A DRAFT IN THE BROWSER. Containers can be edited (quantities, lines added or
 *    removed), removed or added empty. Fill = Σ quantity ÷ pieces per container, over capacity only
 *    above the SQL's tolerance, shown to one decimal. The footer compares what is planned with what
 *    each order line still allows; above it, Create is disabled.
 * 3. CREATE sends the non-empty containers numbered 1..N in the order shown — the # column shows the
 *    same numbers, so "Container 3 of 30" in an error is row #3 (it is highlighted). Containers above
 *    100 % need containers.overcapacity and ONE confirmation listing all of them; without the right
 *    the list is shown and Create stays disabled.
 */
export function AutoPlanModal({ order, invoice, canOverCapacity, canConfirm, onClose, onCreated }: AutoPlanModalProps) {
  // The order's endpoints, or the invoice's: the same dialog, the same proposal shape.
  const invoiceId = invoice?.id ?? null
  const invoiceRowVersion = invoice?.rowVersion ?? null
  const planner = useMemo(
    () =>
      invoiceId === null
        ? { autoPlan: containersApi.autoPlan, createFromPlan: containersApi.createFromPlan }
        : {
            autoPlan: (payload: AutoPlanRequest, signal?: AbortSignal) =>
              invoiceContainersApi.autoPlan(
                invoiceId,
                { containerTypeId: payload.containerTypeId, mixRemainders: payload.mixRemainders ?? true },
                signal,
              ),
            createFromPlan: async (payload: CreateContainersFromPlanRequest) => {
              const { purchaseOrderId: _order, ...rest } = payload
              return (await invoiceContainersApi.createFromPlan(invoiceId, { ...rest, rowVersion: invoiceRowVersion })).created
            },
          },
    [invoiceId, invoiceRowVersion],
  )
  const [types, setTypes] = useState<ContainerTypeLookupDto[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  const [forwarders, setForwarders] = useState<PartyLookupDto[]>([])

  // settings
  const [typeId, setTypeId] = useState<string | null>(null)
  const [orderDate, setOrderDate] = useState<string | null>(isoDate(new Date()))
  const [warehouseId, setWarehouseId] = useState<string | null>(String(order.warehouseId))
  const [portOfLoadingId, setPortOfLoadingId] = useState<string | null>(null)
  const [portOfDestinationId, setPortOfDestinationId] = useState<string | null>(null)
  const [finalDestinationId, setFinalDestinationId] = useState<string | null>(null)
  const [eta, setEta] = useState<string | null>(null)
  const [forwarderId, setForwarderId] = useState<string | null>(null)
  const [shippingLine, setShippingLine] = useState('')
  const [mix, setMix] = useState(true)
  const [confirmAfter, setConfirmAfter] = useState(false)

  // items
  const [orderLines, setOrderLines] = useState<PlanOrderLineDto[] | null>(null)
  const [linesError, setLinesError] = useState<string | null>(null)
  const [itemsError, setItemsError] = useState<string | null>(null)

  // proposal
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [proposing, setProposing] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorSeq, setErrorSeq] = useState<number | null>(null)
  const [errorLine, setErrorLine] = useState<number | null>(null)
  const nextKey = useRef(1)

  useEffect(() => {
    let live = true
    containerTypesApi
      .lookup(true)
      .then((list) => {
        if (!live) return
        setTypes(list)
        const standard = list.find((t) => t.typeCode === DEFAULT_TYPE_CODE)
        if (standard) setTypeId((current) => current ?? String(standard.id))
      })
      .catch(() => {})
    portsApi.lookup(true).then((list) => live && setPorts(list)).catch(() => {})
    warehousesApi.lookup(true, order.branchId, order.warehouseId).then((list) => live && setWarehouses(list)).catch(() => {})
    partiesApi.lookup({ partyType: 'Supplier' }).then((list) => live && setForwarders(list)).catch(() => {})
    return () => {
      live = false
    }
  }, [order.branchId, order.warehouseId])

  // The order lines and the pieces per container of their items (their Container units), for the chosen type.
  useEffect(() => {
    if (!typeId) return
    const controller = new AbortController()
    planner
      .autoPlan({ purchaseOrderId: order.id, containerTypeId: Number(typeId), mixRemainders: true }, controller.signal)
      .then((plan) => setOrderLines(plan.orderLines))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setOrderLines([])
        setLinesError(err instanceof ApiError ? err.message : 'The order lines could not be loaded.')
      })
    return () => controller.abort()
  }, [order.id, typeId, planner])

  /** Another type: the lines are asked again and the proposal is dropped. */
  function changeType(next: string | null) {
    if (next === typeId) return
    setTypeId(next)
    setOrderLines(null)
    setLinesError(null)
    setProposal(null)
    setEditingKey(null)
  }

  /* ── the proposal ────────────────────────────────────────────────────────────────────────── */

  const lineById = useMemo(() => new Map((orderLines ?? []).map((line) => [line.poLineId, line])), [orderLines])
  /** The pieces per container of every item: its Container unit, from the API. */
  const capacityOf = useMemo(
    () => new Map((orderLines ?? []).filter((line) => (line.pcsPerContainer ?? 0) > 0).map((line) => [line.itemId, line.pcsPerContainer as number])),
    [orderLines],
  )
  /** A line still to load whose item has no Container unit: no plan until it has one. */
  const blockedLine = (orderLines ?? []).find((line) => line.availableBase > 0 && !(line.pcsPerContainer ?? 0))

  /** Every container with its figures; `number` is its place among the non-empty ones (1..N). */
  const boxes = useMemo(() => {
    let number = 0
    return (proposal?.boxes ?? []).map((box) => {
      const loaded = box.lines.filter((line) => qty(line) > 0)
      let fill = 0
      for (const line of loaded) {
        const item = lineById.get(line.poLineId)
        const cap = item ? capacityOf.get(item.itemId) : undefined
        fill += cap ? qty(line) / cap : 0
      }
      const items = new Set(loaded.map((line) => lineById.get(line.poLineId)?.itemId))
      return {
        box,
        loaded,
        number: loaded.length > 0 ? ++number : null,
        units: loaded.reduce((sum, line) => sum + qty(line), 0),
        itemCount: items.size,
        fill,
        pct: fill * 100,
      }
    })
  }, [proposal, lineById, capacityOf])

  const planned = useMemo(() => {
    const totals = new Map<number, number>()
    for (const box of proposal?.boxes ?? []) {
      for (const line of box.lines) totals.set(line.poLineId, (totals.get(line.poLineId) ?? 0) + qty(line))
    }
    return totals
  }, [proposal])

  const toCreate = boxes.filter((b) => b.number !== null)
  const overBoxes = toCreate.filter((b) => isOverFull(b.fill))
  const overLines = (orderLines ?? []).filter((line) => (planned.get(line.poLineId) ?? 0) > line.availableBase)
  const full = toCreate.filter((b) => b.itemCount === 1 && b.fill >= 1 / FULL_TOLERANCE).length
  const mixed = toCreate.filter((b) => b.itemCount > 1).length
  const partial = toCreate.length - full - mixed
  const pieces = toCreate.reduce((sum, b) => sum + b.units, 0)

  const stale = proposal !== null && proposal.mix !== mix

  async function propose() {
    if (!typeId || !orderLines || blockedLine) return
    setItemsError(null)

    setProposing(true)
    setError(null)
    setErrorSeq(null)
    setErrorLine(null)
    try {
      const plan: AutoPlanDto = await planner.autoPlan({
        purchaseOrderId: order.id,
        containerTypeId: Number(typeId),
        mixRemainders: mix,
      })
      setOrderLines(plan.orderLines)
      if (plan.message) {
        // An item lost its Container unit since the dialog opened: no proposal, the lines say which one.
        setProposal(null)
        setItemsError(plan.message)
        return
      }
      setProposal({
        mix,
        boxes: plan.containers.map((container) => ({
          key: `box-${nextKey.current++}`,
          lines: plan.lines
            .filter((line) => line.seq === container.seq)
            .map((line) => ({ poLineId: line.poLineId, quantity: line.quantityBase })),
        })),
      })
      setEditingKey(null)
      if (plan.containers.length === 0) notify.info('Nothing is left to load on this order.')
    } catch (err) {
      setItemsError(err instanceof ApiError ? err.message : 'The proposal could not be made.')
    } finally {
      setProposing(false)
    }
  }

  function patchBox(key: string, change: (box: PlanBox) => PlanBox) {
    setProposal((current) => (current ? { ...current, boxes: current.boxes.map((box) => (box.key === key ? change(box) : box)) } : current))
  }

  function removeBox(key: string) {
    setProposal((current) => (current ? { ...current, boxes: current.boxes.filter((box) => box.key !== key) } : current))
    if (editingKey === key) setEditingKey(null)
  }

  function addEmptyBox() {
    const key = `box-${nextKey.current++}`
    setProposal((current) => (current ? { ...current, boxes: [...current.boxes, { key, lines: [] }] } : current))
    setEditingKey(key)
  }

  /** An order line added to a container: what is still unplanned, at most what still fits. */
  function addLine(key: string, poLineId: number, fill: number) {
    const line = lineById.get(poLineId)
    if (!line) return
    const remaining = Math.max(0, line.availableBase - (planned.get(poLineId) ?? 0))
    const cap = capacityOf.get(line.itemId) ?? 0
    const fits = cap > 0 ? Math.floor((1 - fill) * cap + 1e-9) : 0
    const quantity = fits > 0 ? Math.min(remaining, fits) : remaining
    patchBox(key, (box) => ({ ...box, lines: [...box.lines, { poLineId, quantity }] }))
  }

  async function create() {
    if (!proposal || !typeId) return
    if (toCreate.length === 0) {
      setError('Every container is empty: nothing to create.')
      return
    }
    let allowOverCapacity = false
    if (overBoxes.length > 0) {
      if (!canOverCapacity) return
      const go = await confirm({
        title: 'Create containers above capacity?',
        message: `${overBoxes.map((b) => `#${b.number} ${fillLabel(b.pct)}`).join(', ')} - create anyway?`,
        confirmLabel: 'Create anyway',
      })
      if (!go) return
      allowOverCapacity = true
    }

    setCreating(true)
    setError(null)
    setErrorSeq(null)
    setErrorLine(null)
    try {
      const created = await planner.createFromPlan({
        purchaseOrderId: order.id,
        containerTypeId: Number(typeId),
        orderDate,
        warehouseId: warehouseId ? Number(warehouseId) : null,
        portOfLoadingId: portOfLoadingId ? Number(portOfLoadingId) : null,
        portOfDestinationId: portOfDestinationId ? Number(portOfDestinationId) : null,
        finalDestinationId: finalDestinationId ? Number(finalDestinationId) : null,
        eta,
        forwarderId: forwarderId ? Number(forwarderId) : null,
        shippingLine: shippingLine.trim() || null,
        containers: toCreate.map((b) => ({
          seq: b.number ?? 0,
          lines: b.loaded.map((line) => ({ poLineId: line.poLineId, quantityBase: qty(line) })),
        })),
        allowOverCapacity,
        confirm: canConfirm && confirmAfter,
      })
      const refs = created.map((c) => c.containerRef)
      notify.success(
        created.length === 1
          ? `1 container created: ${refs[0]}`
          : `${formatNumber(created.length)} containers created: ${refs[0]} ... ${refs[refs.length - 1]}`,
      )
      onCreated(created)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The containers could not be created.'
      setError(message)
      setErrorSeq(containerInError(message))
      setErrorLine(orderLineInError(message))
    } finally {
      setCreating(false)
    }
  }

  /* ── rendering ───────────────────────────────────────────────────────────────────────────── */

  const typeOptions = types.map((t) => ({
    value: String(t.id),
    label: `${t.typeCode} - ${t.typeName}`,
  }))
  const portOptions = ports.map((p) => ({ value: String(p.id), label: portLabel(p) }))
  const warehouseOptions = warehouses.map((w) => ({ value: String(w.id), label: `${w.warehouseCode} - ${w.warehouseName}` }))
  const forwarderOptions = forwarders.map((p) => ({ value: String(p.id), label: supplierLabel(p) }))
  const createBlocked = creating || proposal === null || toCreate.length === 0 || overLines.length > 0 || (overBoxes.length > 0 && !canOverCapacity)

  return (
    <Modal
      opened
      onClose={onClose}
      fullScreen
      closeOnClickOutside={false}
      title={
        <Text fw={700}>
          Auto-plan containers - {invoice ? `invoice ${invoice.documentNumber ?? `draft #${invoice.id}`}, ` : ''}
          {order.documentNumber ?? `order #${order.id}`}
        </Text>
      }
    >
      <Stack gap="md">
        <Paper withBorder radius="lg" p="md">
          <Title order={6} mb="xs">
            Settings
          </Title>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
            <Select
              label="Container type"
              withAsterisk
              data={typeOptions}
              value={typeId}
              onChange={changeType}
              searchable
              nothingFoundMessage="Nothing matches"
            />
            <DateInput
              label="Order date"
              valueFormat="DD/MM/YYYY"
              value={fromIsoDate(orderDate)}
              onChange={(next) => setOrderDate(next ? isoDate(new Date(next)) : null)}
            />
            <Select label="Offloading warehouse" data={warehouseOptions} value={warehouseId} onChange={setWarehouseId} searchable />
            <Select label="Port of loading" data={portOptions} value={portOfLoadingId} onChange={setPortOfLoadingId} searchable clearable />
            <Select label="Port of destination" data={portOptions} value={portOfDestinationId} onChange={setPortOfDestinationId} searchable clearable />
            <Select label="Final destination" data={portOptions} value={finalDestinationId} onChange={setFinalDestinationId} searchable clearable />
            <DateInput label="ETA" valueFormat="DD/MM/YYYY" clearable value={fromIsoDate(eta)} onChange={(next) => setEta(next ? isoDate(new Date(next)) : null)} />
            <Select label="Forwarder" data={forwarderOptions} value={forwarderId} onChange={setForwarderId} searchable clearable nothingFoundMessage="Nothing matches" />
            <TextInput label="Shipping line" maxLength={100} value={shippingLine} onChange={(e) => setShippingLine(e.currentTarget.value)} />
          </SimpleGrid>
          <Group mt="md" gap="xl" wrap="wrap">
            <Switch label="Mix the rest of the items in shared containers" checked={mix} onChange={(e) => setMix(e.currentTarget.checked)} />
            {canConfirm ? (
              <Switch label="Confirm the containers after creating them" checked={confirmAfter} onChange={(e) => setConfirmAfter(e.currentTarget.checked)} />
            ) : null}
          </Group>
        </Paper>

        <Paper withBorder radius="lg" p="md">
          <Group justify="space-between" mb="xs" wrap="wrap">
            <Title order={6}>Items</Title>
            <Tooltip label="Set the Container unit of every item in Item Definition first." disabled={!blockedLine} withArrow>
              <Button
                leftSection={<IconWand size={16} />}
                onClick={(event) => (blockedLine ? event.preventDefault() : void propose())}
                loading={proposing}
                disabled={!typeId || !orderLines || orderLines.length === 0}
                data-disabled={blockedLine ? true : undefined}
                aria-disabled={blockedLine ? true : undefined}
                data-propose
              >
                Propose
              </Button>
            </Tooltip>
          </Group>
          {!typeId ? (
            <Text fz="sm" c="dimmed">
              Choose the container type first.
            </Text>
          ) : null}
          {linesError ? <Alert color="red">{linesError}</Alert> : null}
          {typeId && orderLines === null && !linesError ? <Loader size="sm" /> : null}
          {orderLines && orderLines.length > 0 ? (
            <ScrollArea type="auto">
              <Table miw={880} verticalSpacing={4} striped data-plan-items>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Item code</Table.Th>
                    <Table.Th>Model</Table.Th>
                    <Table.Th ta="right">Ordered</Table.Th>
                    <Table.Th ta="right">Available</Table.Th>
                    <Table.Th w={320}>Pieces per container</Table.Th>
                    <Table.Th ta="right">Containers needed</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {orderLines.map((line) => {
                    const pcs = line.pcsPerContainer ?? 0
                    return (
                      <Table.Tr key={line.poLineId}>
                        <Table.Td>
                          <Text fz="sm" fw={600}>
                            {line.itemCode}
                          </Text>
                          <Text fz="xs" c="dimmed">
                            {line.itemName}
                          </Text>
                        </Table.Td>
                        <Table.Td>{line.model ?? '—'}</Table.Td>
                        <Table.Td ta="right">{formatNumber(line.orderedBase)}</Table.Td>
                        <Table.Td ta="right" fw={600}>
                          {formatNumber(line.availableBase)}
                        </Table.Td>
                        <Table.Td data-plan-pcs={line.itemCode}>
                          {pcs > 0 ? (
                            <Text fz="sm">
                              {formatNumber(pcs)} per container{' '}
                              <Text span c="dimmed" fz="xs">
                                (Item Definition)
                              </Text>
                            </Text>
                          ) : line.availableBase > 0 ? (
                            <Text fz="sm" c="red.7">
                              {line.capacityMessage ?? `Line ${line.poLineNumber} (${line.itemCode}): set its Container unit in Item Definition first.`}{' '}
                              <Anchor component={Link} to={`${ITEMS_ROUTE}/${line.itemId}`} target="_blank" fz="sm" fw={600}>
                                Open {line.itemCode}
                              </Anchor>
                            </Text>
                          ) : (
                            <Text fz="sm" c="dimmed">
                              —
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td ta="right">{pcs > 0 ? formatNumber(line.availableBase / pcs, 2) : '—'}</Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          ) : null}
          {orderLines && orderLines.length === 0 && !linesError ? (
            <Text fz="sm" c="dimmed">
              This order has no line to load.
            </Text>
          ) : null}
          {itemsError ? (
            <Alert color="red" mt="sm">
              {itemsError}
            </Alert>
          ) : null}
        </Paper>

        {proposal ? (
          <Paper withBorder radius="lg" p="md" data-plan-proposal>
            <Group justify="space-between" mb="xs" wrap="wrap">
              <Title order={6}>Proposal</Title>
              <Text fz="sm" fw={600} data-plan-summary>
                {formatNumber(toCreate.length)} container{toCreate.length === 1 ? '' : 's'} - {formatNumber(full)} full
                {mixed > 0 ? `, ${formatNumber(mixed)} mixed` : ''}
                {partial > 0 ? `, ${formatNumber(partial)} part-filled` : ''} - {formatNumber(pieces)} pieces
              </Text>
            </Group>
            {stale ? (
              <Alert color="yellow" mb="sm">
                The mixing changed since this proposal. Propose again to use it; Create sends the proposal as it is.
              </Alert>
            ) : null}

            <ScrollArea type="auto">
              <Table miw={760} verticalSpacing={4} data-plan-containers>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={50}>#</Table.Th>
                    <Table.Th>Items</Table.Th>
                    <Table.Th ta="right" w={90}>
                      Units
                    </Table.Th>
                    <Table.Th w={200}>Fill %</Table.Th>
                    <Table.Th w={90} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {boxes.map((b) => {
                    const editing = editingKey === b.box.key
                    const inError = errorSeq !== null && b.number === errorSeq
                    return (
                      <Fragment key={b.box.key}>
                        <Table.Tr bg={inError ? 'var(--mantine-color-red-0)' : editing ? 'var(--mantine-color-blue-0)' : undefined} data-plan-row={b.number ?? 'empty'}>
                          <Table.Td fw={700}>{b.number ?? '—'}</Table.Td>
                          <Table.Td>
                            {b.loaded.length === 0 ? (
                              <Text fz="sm" c="dimmed">
                                Empty - not created
                              </Text>
                            ) : (
                              <Group gap={4}>
                                {b.loaded.map((line) => (
                                  <Badge key={line.poLineId} variant="light" color="gray" tt="none">
                                    {lineById.get(line.poLineId)?.itemCode ?? line.poLineId} × {formatNumber(qty(line))}
                                  </Badge>
                                ))}
                              </Group>
                            )}
                          </Table.Td>
                          <Table.Td ta="right">{formatNumber(b.units)}</Table.Td>
                          <Table.Td>
                            {b.loaded.length > 0 ? (
                              <Group gap={6} wrap="nowrap">
                                <Progress value={Math.min(100, b.pct)} color={fillColour(b.pct)} size="lg" radius="xl" style={{ flex: 1 }} />
                                <Text fz="xs" fw={600} c={isOverFull(b.fill) ? 'red.7' : undefined} w={56} ta="right">
                                  {fillLabel(b.pct)}
                                </Text>
                              </Group>
                            ) : null}
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4} wrap="nowrap" justify="flex-end">
                              <Tooltip label={editing ? 'Close' : 'Edit'} withArrow>
                                <ActionIcon variant="subtle" aria-label={editing ? 'Close the editor' : `Edit container ${b.number ?? ''}`} onClick={() => setEditingKey(editing ? null : b.box.key)}>
                                  {editing ? <IconPencilOff size={16} /> : <IconPencil size={16} />}
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="Remove" withArrow>
                                <ActionIcon variant="subtle" color="red" aria-label={`Remove container ${b.number ?? ''}`} onClick={() => removeBox(b.box.key)}>
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                        {editing ? (
                          <Table.Tr bg="var(--mantine-color-blue-0)">
                            <Table.Td colSpan={5}>
                              <ContainerLinesEditor
                                lines={b.box.lines}
                                orderLines={orderLines ?? []}
                                planned={planned}
                                capacityOf={capacityOf}
                                onQuantity={(poLineId, value) =>
                                  patchBox(b.box.key, (box) => ({
                                    ...box,
                                    lines: box.lines.map((line) => (line.poLineId === poLineId ? { ...line, quantity: value } : line)),
                                  }))
                                }
                                onRemove={(poLineId) => patchBox(b.box.key, (box) => ({ ...box, lines: box.lines.filter((line) => line.poLineId !== poLineId) }))}
                                onAdd={(poLineId) => addLine(b.box.key, poLineId, b.fill)}
                              />
                            </Table.Td>
                          </Table.Tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Button mt="xs" size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={addEmptyBox}>
              Add empty container
            </Button>

            <Title order={6} mt="md" mb={4}>
              Planned / available per order line
            </Title>
            <ScrollArea type="auto">
              <Table miw={520} verticalSpacing={2} data-plan-footer>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Line</Table.Th>
                    <Table.Th>Item</Table.Th>
                    <Table.Th ta="right">Planned</Table.Th>
                    <Table.Th ta="right">Available</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(orderLines ?? []).map((line) => {
                    const done = planned.get(line.poLineId) ?? 0
                    const over = done > line.availableBase || errorLine === line.poLineNumber
                    return (
                      <Table.Tr key={line.poLineId} bg={over ? 'var(--mantine-color-red-0)' : undefined} data-over={over || undefined}>
                        <Table.Td>{line.poLineNumber}</Table.Td>
                        <Table.Td>{line.itemCode}</Table.Td>
                        <Table.Td ta="right" c={over ? 'red' : undefined} fw={over ? 700 : 400}>
                          {formatNumber(done)}
                        </Table.Td>
                        <Table.Td ta="right">{formatNumber(line.availableBase)}</Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>
        ) : null}

        {/* Sticky at the bottom of the modal's own scroll: a fixed footer would be trapped by the modal's transform. */}
        <Paper
          withBorder
          p="sm"
          radius="lg"
          shadow="sm"
          style={{ position: 'sticky', bottom: 0, zIndex: 5, background: 'var(--mantine-color-body)' }}
          data-plan-actions
        >
          <Stack gap={6}>
            {error ? (
              <Alert color="red" py={6} data-plan-error>
                {error}
              </Alert>
            ) : null}
            {proposal && overLines.length > 0 ? (
              <Text fz="sm" c="red">
                More is planned than the order allows on {overLines.map((l) => `line ${l.poLineNumber} (${l.itemCode})`).join(', ')}.
              </Text>
            ) : null}
            {proposal && overBoxes.length > 0 && !canOverCapacity ? (
              <Text fz="sm" c="orange">
                Above capacity: {overBoxes.map((b) => `#${b.number} ${fillLabel(b.pct)}`).join(', ')}. Creating containers above 100 % needs the
                containers.overcapacity permission.
              </Text>
            ) : null}
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={onClose} disabled={creating}>
                Cancel
              </Button>
              <Button leftSection={<IconBoxMultiple size={16} />} loading={creating} disabled={createBlocked} onClick={() => void create()} data-plan-create>
                Create {formatNumber(toCreate.length)} container{toCreate.length === 1 ? '' : 's'}
              </Button>
            </Group>
          </Stack>
        </Paper>
      </Stack>
    </Modal>
  )
}

interface ContainerLinesEditorProps {
  lines: PlanLine[]
  orderLines: PlanOrderLineDto[]
  planned: Map<number, number>
  capacityOf: Map<number, number>
  onQuantity(poLineId: number, value: number | ''): void
  onRemove(poLineId: number): void
  onAdd(poLineId: number): void
}

/** The lines of one proposed container: quantities, remove, and "Add line" from what is not planned yet. */
function ContainerLinesEditor({ lines, orderLines, planned, capacityOf, onQuantity, onRemove, onAdd }: ContainerLinesEditorProps) {
  const inBox = new Set(lines.map((line) => line.poLineId))
  const addable = orderLines.filter((line) => !inBox.has(line.poLineId) && line.availableBase - (planned.get(line.poLineId) ?? 0) > 0)

  return (
    <Stack gap={6} py={4} data-plan-editor>
      {lines.length === 0 ? (
        <Text fz="sm" c="dimmed">
          No line yet.
        </Text>
      ) : null}
      {lines.map((line) => {
        const orderLine = orderLines.find((l) => l.poLineId === line.poLineId)
        const cap = orderLine ? capacityOf.get(orderLine.itemId) : undefined
        return (
          <Group key={line.poLineId} gap="xs" wrap="nowrap">
            <Text fz="sm" fw={600} w={160} truncate>
              {orderLine?.itemCode ?? line.poLineId}
            </Text>
            <NumberInput
              size="xs"
              w={120}
              min={0}
              allowDecimal={false}
              allowNegative={false}
              thousandSeparator=","
              value={line.quantity}
              onChange={(next) => onQuantity(line.poLineId, numberInputValue(next) ?? '')}
              aria-label={`Quantity of ${orderLine?.itemCode ?? line.poLineId}`}
            />
            <Text fz="xs" c="dimmed" visibleFrom="sm">
              {cap ? `${formatNumber(cap)} per container` : ''}
            </Text>
            <Tooltip label="Remove line" withArrow>
              <ActionIcon variant="subtle" color="red" aria-label={`Remove ${orderLine?.itemCode ?? line.poLineId}`} onClick={() => onRemove(line.poLineId)}>
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )
      })}
      <Select
        size="xs"
        w={320}
        maw="100%"
        placeholder={addable.length === 0 ? 'Every order line is planned' : 'Add line…'}
        disabled={addable.length === 0}
        data={addable.map((line) => ({
          value: String(line.poLineId),
          label: `${line.itemCode} - line ${line.poLineNumber} (${formatNumber(line.availableBase - (planned.get(line.poLineId) ?? 0))} not planned)`,
        }))}
        value={null}
        onChange={(next) => {
          if (next) onAdd(Number(next))
        }}
        aria-label="Add line"
      />
    </Stack>
  )
}
