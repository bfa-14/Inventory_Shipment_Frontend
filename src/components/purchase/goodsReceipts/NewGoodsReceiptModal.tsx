import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks'
import { IconBox, IconChevronRight, IconFileInvoice, IconSearch, IconTruckDelivery } from '@tabler/icons-react'
import { ApiError } from '../../../api/http'
import { containerStatusColour, containerStatusLabel } from '../../../api/logistics/containers'
import { partiesApi } from '../../../api/masterdata/parties'
import { goodsReceiptsApi, type ReceivableContainerDto, type ReceivableDocumentDto } from '../../../api/purchase/goodsReceipts'
import type { PartyLookupDto } from '../../../api/types'
import { useAuth } from '../../../auth/useAuth'
import { refreshGoodsReceiptsWaiting } from '../../../hooks/useGoodsReceiptsWaiting'
import { PERMISSIONS } from '../../../navigation'
import { routes } from '../../../routes'
import { dateLabel } from '../../documents/documentKind'
import { formatNumber } from '../../format'
import { partyLabel } from '../../sales/salesLines'
import { confirm } from '../../ui/confirm'
import { notify } from '../../ui/notify'
import { MANUAL_HINT, notDispatchedText } from './goodsReceiptModel'
import type { ReceiveGoodsSource } from './ReceiveGoodsModal'

export interface NewGoodsReceiptModalProps {
  opened: boolean
  onClose(): void
  /** "From a purchase order…": the order picked. The host opens ReceiveGoodsModal for it. */
  onPickOrder(order: ReceiveGoodsSource): void
}

type Step = 'choose' | 'order' | 'container' | 'manual'

/**
 * "+ New" on Purchase › Goods Receipts: where the goods come from (rule 16).
 *
 * - "From a purchase order…": the supplier, then its approved orders with something to receive; the order
 *   picked opens the shared "Receive goods" dialog (the lines behave as on the order page, 0 on an order in containers).
 * - "From a container…": a confirmed container with no goods receipt yet (the server's list, `receivable-containers`:
 *   status 2-5, no draft or posted receipt, delivered ones first); its draft is created at once and opened.
 * - "Without an order": a supplier is required, then a new receipt typed by hand opens.
 */
export function NewGoodsReceiptModal({ opened, onClose, onPickOrder }: NewGoodsReceiptModalProps) {
  const fullScreen = useMediaQuery('(max-width: 768px)')
  return (
    <Modal opened={opened} onClose={onClose} title="New goods receipt" size={900} fullScreen={fullScreen} centered={!fullScreen}>
      {opened ? <ChooserBody onClose={onClose} onPickOrder={onPickOrder} /> : null}
    </Modal>
  )
}

function ChooserBody({ onClose, onPickOrder }: Omit<NewGoodsReceiptModalProps, 'opened'>) {
  const [step, setStep] = useState<Step>('choose')
  const [suppliers, setSuppliers] = useState<PartyLookupDto[] | null>(null)

  useEffect(() => {
    partiesApi
      .lookup({ partyType: 'Supplier', activeOnly: false })
      .then(setSuppliers)
      .catch(() => {
        setSuppliers([])
        notify.error('Suppliers could not be loaded.')
      })
  }, [])

  const supplierData = useMemo(
    () => (suppliers ?? []).map((s) => ({ value: String(s.id), label: `${partyLabel(s)}${s.isActive ? '' : ' (inactive)'}` })),
    [suppliers],
  )

  if (step === 'order') return <FromOrderStep supplierData={supplierData} suppliers={suppliers} onBack={() => setStep('choose')} onPickOrder={onPickOrder} />
  if (step === 'container') return <FromContainerStep onBack={() => setStep('choose')} onClose={onClose} />
  if (step === 'manual') return <ManualStep supplierData={supplierData} onBack={() => setStep('choose')} onClose={onClose} />

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Where do the goods come from?
      </Text>
      <Choice
        icon={<IconFileInvoice size={22} />}
        title="From a purchase order…"
        text="Goods of an approved order that arrived without a container: choose the supplier, then the order."
        onClick={() => setStep('order')}
      />
      {/* The goods receipt create permission is enough (the server's list of receivable containers). */}
      <Choice
        icon={<IconTruckDelivery size={22} />}
        title="From a container…"
        text="A confirmed container with no goods receipt yet. Completing a container's Delivery movement also creates its draft."
        onClick={() => setStep('container')}
      />
      <Choice
        icon={<IconBox size={22} />}
        title="Without an order"
        text="Goods of a supplier with no purchase order, at a typed cost."
        onClick={() => setStep('manual')}
      />
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
      </Group>
    </Stack>
  )
}

function Choice({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick(): void }) {
  return (
    <UnstyledButton onClick={onClick} data-choice={title} className="app-choice-button" w="100%">
      <Paper withBorder radius="md" p="md" className="app-choice">
        <Group wrap="nowrap" gap="md">
          <Text c="brand.6" style={{ display: 'flex' }}>
            {icon}
          </Text>
          <Stack gap={2} style={{ flex: 1 }}>
            <Text fw={600}>{title}</Text>
            <Text size="sm" c="dimmed">
              {text}
            </Text>
          </Stack>
          <IconChevronRight size={18} />
        </Group>
      </Paper>
    </UnstyledButton>
  )
}

/* ── From a purchase order… ──────────────────────────────────────────────────────────────────── */


function FromOrderStep({
  supplierData,
  suppliers,
  onBack,
  onPickOrder,
}: {
  supplierData: { value: string; label: string }[]
  suppliers: PartyLookupDto[] | null
  onBack(): void
  onPickOrder(order: ReceiveGoodsSource): void
}) {
  const [supplierId, setSupplierId] = useState<string | null>(null)
  /** The answer, with the supplier it is for: an answer for the previous pick is never shown under the new one. */
  const [result, setResult] = useState<{ supplierId: string; orders: ReceivableDocumentDto[] | null; error: string | null } | null>(null)
  const current = result !== null && result.supplierId === supplierId ? result : null
  const loaded = current?.orders ?? null
  const error = current?.error ?? null

  useEffect(() => {
    if (supplierId === null) return
    const controller = new AbortController()
    goodsReceiptsApi
      .receivable({ supplierId: Number(supplierId) }, controller.signal)
      .then((answer) => setResult({ supplierId, orders: answer.documents, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setResult({ supplierId, orders: null, error: err instanceof ApiError ? err.message : "The supplier's orders could not be loaded." })
      })
    return () => controller.abort()
  }, [supplierId])

  /** The supplier's approved orders with something to receive, as the server totals them. */
  const orders = useMemo(() => (loaded ?? []).filter((o) => o.toReceiveBase > 0), [loaded])

  const supplier = suppliers?.find((s) => String(s.id) === supplierId)

  return (
    <Stack>
      <Text fw={600}>From a purchase order…</Text>
      <Select
        label="Supplier"
        placeholder="Choose the supplier"
        data={supplierData}
        value={supplierId}
        onChange={setSupplierId}
        searchable
        nothingFoundMessage="No supplier matches"
        withAsterisk
        data-autofocus
        disabled={suppliers === null}
      />

      {error && <Alert color="red">{error}</Alert>}

      {supplierId !== null && !error && loaded === null && (
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      )}

      {loaded !== null && orders.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="md">
          {supplier ? `${supplier.partyCode} has` : 'This supplier has'} no approved order with goods to receive.
        </Text>
      )}

      {orders.length > 0 && (
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Order</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Branch</Table.Th>
                <Table.Th ta="right">Lines</Table.Th>
                <Table.Th ta="right">To receive</Table.Th>
                <Table.Th ta="right">In containers</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {orders.map((order) => (
                <Table.Tr key={order.id}>
                  <Table.Td>
                    <Text fz="sm" fw={500}>
                      {order.documentNumber ?? `#${order.id}`}
                    </Text>
                  </Table.Td>
                  <Table.Td>{dateLabel(order.documentDate)}</Table.Td>
                  <Table.Td>{order.branchCode ?? order.branchName ?? '—'}</Table.Td>
                  <Table.Td ta="right">{formatNumber(order.lineCount)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(order.toReceiveBase)} pcs</Table.Td>
                  <Table.Td ta="right">{formatNumber(order.inContainersBase)} pcs</Table.Td>
                  <Table.Td ta="right">
                    <Button size="xs" onClick={() => onPickOrder({ kind: 'order', id: order.id, documentNumber: order.documentNumber })}>
                      Receive goods…
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Group justify="flex-start">
        <Button variant="default" onClick={onBack}>
          Back
        </Button>
      </Group>
    </Stack>
  )
}

/* ── From a container… ───────────────────────────────────────────────────────────────────────── */

function FromContainerStep({ onBack, onClose }: { onBack(): void; onClose(): void }) {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canViewContainers = hasPermission(PERMISSIONS.containersView)
  const [search, setSearch] = useState('')
  const [debounced] = useDebouncedValue(search, 350)
  /** The answer, with the search it is for: while a newer search runs, the loader shows instead of stale rows. */
  const [result, setResult] = useState<{ term: string; rows: ReceivableContainerDto[] | null; error: string | null } | null>(null)
  const current = result !== null && result.term === debounced ? result : null
  const containers = current?.rows ?? null
  const error = current?.error ?? null
  const [creating, setCreating] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const term = debounced
    void (async () => {
      try {
        // The server's list: status 2-5 and no draft or posted receipt (a draft that exists is opened, not created again).
        const rows = await goodsReceiptsApi.receivableContainers({ search: term.trim() || undefined }, controller.signal)
        if (controller.signal.aborted) return
        setResult({ term, rows: rows.filter((c) => c.canReceive), error: null })
      } catch (err) {
        if (controller.signal.aborted) return
        setResult({ term, rows: null, error: err instanceof ApiError ? err.message : 'The containers could not be loaded.' })
      }
    })()
    return () => controller.abort()
  }, [debounced])

  async function create(container: ReceivableContainerDto) {
    if (container.notDispatched) {
      const go = await confirm({
        title: `Receive ${container.containerRef}?`,
        message: notDispatchedText(container.containerRef),
        confirmLabel: 'Create draft',
      })
      if (!go) return
    }
    setCreating(container.containerId)
    try {
      const created = await goodsReceiptsApi.fromContainer({ containerId: container.containerId, post: false })
      notify.success('Draft goods receipt created')
      void refreshGoodsReceiptsWaiting()
      onClose()
      void navigate(routes.goodsReceipt(created.id))
    } catch (err) {
      // 63013 "Container … already has goods receipt …. Open it instead." and the rest: as the server says them.
      notify.error(err instanceof ApiError ? err.message : 'The goods receipt could not be created.')
    } finally {
      setCreating(null)
    }
  }

  return (
    <Stack>
      <Text fw={600}>From a container…</Text>
      <TextInput
        label="Search"
        placeholder="Container ref or no., order or supplier"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
        data-autofocus
      />

      {error && <Alert color="red">{error}</Alert>}

      {containers === null && !error ? (
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      ) : null}

      {containers !== null && containers.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="md">
          No confirmed container is waiting for a goods receipt{debounced.trim() ? ' with this search' : ''}.
        </Text>
      )}

      {containers !== null && containers.length > 0 && (
        <Table.ScrollContainer minWidth={720}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Container</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Branch</Table.Th>
                <Table.Th>Warehouse</Table.Th>
                <Table.Th>Orders</Table.Th>
                <Table.Th ta="right">Pieces</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {containers.map((c) => (
                <Table.Tr key={c.containerId}>
                  <Table.Td>
                    {canViewContainers ? (
                      <Anchor href={routes.container(c.containerId)} target="_blank" fz="sm" fw={500}>
                        {c.containerRef}
                      </Anchor>
                    ) : (
                      <Text fz="sm" fw={500}>
                        {c.containerRef}
                      </Text>
                    )}
                    <Text fz="xs" c="dimmed">
                      {c.containerNo ?? 'No container no. yet'}
                    </Text>
                    {c.deliveredDate ? (
                      <Text fz="xs" c="dimmed">
                        Delivered {dateLabel(c.deliveredDate)}
                        {c.deliveryPlaceName ? ` at ${c.deliveryPlaceName}` : ''}
                      </Text>
                    ) : null}
                    {c.notDispatched && (
                      <Text fz="xs" c="orange.7" maw={260}>
                        {notDispatchedText(c.containerRef)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      variant="light"
                      color={containerStatusColour(c.status)}
                      style={{ minWidth: 'max-content' }}
                    >
                      {containerStatusLabel(c.status)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{c.branchCode ?? c.branchName ?? '—'}</Table.Td>
                  <Table.Td>
                    {c.warehouseCode && c.warehouseInBranch !== false ? c.warehouseCode : <Text fz="sm" c="orange.7">to choose</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Text fz="sm" lineClamp={2}>
                      {c.orderNumbers ?? '—'}
                    </Text>
                    {c.supplierName ? (
                      <Text fz="xs" c="dimmed" lineClamp={1}>
                        {c.supplierName}
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td ta="right">{formatNumber(c.loadedBase)}</Table.Td>
                  <Table.Td ta="right">
                    <Button
                      size="xs"
                      loading={creating === c.containerId}
                      disabled={creating !== null && creating !== c.containerId}
                      onClick={() => void create(c)}
                    >
                      Create draft
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Group justify="flex-start">
        <Button variant="default" onClick={onBack} disabled={creating !== null}>
          Back
        </Button>
      </Group>
    </Stack>
  )
}

/* ── Without an order ────────────────────────────────────────────────────────────────────────── */

function ManualStep({
  supplierData,
  onBack,
  onClose,
}: {
  supplierData: { value: string; label: string }[]
  onBack(): void
  onClose(): void
}) {
  const navigate = useNavigate()
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function proceed() {
    if (supplierId === null) {
      setError('Choose the supplier the goods come from.')
      return
    }
    onClose()
    void navigate(routes.newGoodsReceipt(Number(supplierId)))
  }

  return (
    <Stack>
      <Text fw={600}>Without an order</Text>
      <Select
        label="Supplier"
        placeholder="Choose the supplier"
        data={supplierData}
        value={supplierId}
        onChange={(next) => {
          setError(null)
          setSupplierId(next)
        }}
        searchable
        nothingFoundMessage="No supplier matches"
        withAsterisk
        error={error}
        data-autofocus
      />
      <Text size="sm" c="dimmed">
        {MANUAL_HINT}
      </Text>
      <Group justify="space-between">
        <Button variant="default" onClick={onBack}>
          Back
        </Button>
        <Button onClick={proceed}>Continue</Button>
      </Group>
    </Stack>
  )
}
