import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { IconBox, IconDeviceFloppy, IconExternalLink } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { containersApi, type AvailablePoLineDto, type ContainerDto, type SaveContainerRequest } from '../../api/logistics/containers'
import { containerTypesApi, type ContainerTypeLookupDto } from '../../api/masterdata/containerTypes'
import { portLabel, portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import { fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, numberInputValue } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'

/** The order the container is created from: its id and where its goods land. */
export interface ContainerOrder {
  id: number
  documentNumber: string | null
  branchId: number
  warehouseId: number
}

interface AddContainerModalProps {
  opened: boolean
  onClose: () => void
  order: ContainerOrder
  /** The reader may confirm a load above capacity (containers.overcapacity). */
  canOverCapacity: boolean
  /** open = "Save and open": the host navigates to the new container. */
  onSaved: (container: ContainerDto, open: boolean) => void
}

interface LoadRow {
  line: AvailablePoLineDto
  quantity: number | ''
  oilIncluded: boolean
  oilQtyPerUnit: number | ''
}

/**
 * "Add Container…" on an approved purchase order: a container of a type, loaded with the order's
 * lines in PIECES.
 *
 * THE AVAILABLE QUANTITY IS THE SERVER'S: ordered − invoiced without a container − loaded in other
 * containers (available-po-lines). Every row starts at what is available; "Fill one container" takes
 * the lines in list order until the type's capacity is reached. Over capacity the bar turns orange —
 * a warning, never a block: saving asks for confirmation and sends allowOverCapacity only when the
 * reader holds containers.overcapacity; otherwise the server's 409 message is shown.
 */
export function AddContainerModal({ opened, onClose, order, canOverCapacity, onSaved }: AddContainerModalProps) {
  const fullScreen = useMediaQuery('(max-width: 48em)')

  const [types, setTypes] = useState<ContainerTypeLookupDto[]>([])
  const [ports, setPorts] = useState<PortLookupDto[]>([])
  const [rows, setRows] = useState<LoadRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState<'save' | 'open' | null>(null)

  const [typeId, setTypeId] = useState<string | null>(null)
  const [containerNo, setContainerNo] = useState('')
  const [sealNo, setSealNo] = useState('')
  const [orderDate, setOrderDate] = useState<string | null>(isoDate(new Date()))
  const [portOfLoadingId, setPortOfLoadingId] = useState<string | null>(null)
  const [portOfDestinationId, setPortOfDestinationId] = useState<string | null>(null)
  const [eta, setEta] = useState<string | null>(null)
  const [typeError, setTypeError] = useState<string | null>(null)

  useEffect(() => {
    if (!opened) return
    // Mounted only while open (the host renders it conditionally), so the state starts empty.
    let live = true
    containerTypesApi.lookup(true).then((list) => live && setTypes(list)).catch(() => {})
    portsApi.lookup(true).then((list) => live && setPorts(list)).catch(() => {})
    containersApi
      .availablePoLines({ purchaseOrderId: order.id })
      .then((lines) => {
        if (!live) return
        setRows(
          lines.map((line) => ({
            line,
            quantity: line.availableBase > 0 ? line.availableBase : '',
            oilIncluded: (line.itemOilQtyPerUnit ?? 0) > 0,
            oilQtyPerUnit: line.itemOilQtyPerUnit ?? '',
          })),
        )
      })
      .catch((err: unknown) => live && setLoadError(err instanceof ApiError ? err.message : 'The order lines could not be loaded.'))
    return () => {
      live = false
    }
  }, [opened, order.id])

  const type = types.find((t) => String(t.id) === typeId) ?? null
  const capacity = type?.maxUnits ?? null
  const loaded = useMemo(() => (rows ?? []).reduce((sum, row) => sum + Number(row.quantity || 0), 0), [rows])
  const over = capacity !== null && loaded > capacity
  const percent = capacity ? (loaded * 100) / capacity : 0

  function patch(poLineId: number, next: Partial<LoadRow>) {
    setRows((current) => current?.map((row) => (row.line.poLineId === poLineId ? { ...row, ...next } : row)) ?? null)
  }

  /** The lines in list order, each up to what is available, until the capacity is used. */
  function fillOneContainer() {
    if (!rows || capacity === null) return
    let left = capacity
    setRows(
      rows.map((row) => {
        const take = Math.max(0, Math.min(row.line.availableBase, left))
        left -= take
        return { ...row, quantity: take > 0 ? take : '' }
      }),
    )
  }

  async function save(open: boolean, allowOverCapacity = false) {
    if (!typeId) {
      setTypeError('Container Type is required.')
      return
    }
    if (!orderDate) {
      notify.error('Order Date is required.')
      return
    }
    const picked = (rows ?? []).filter((row) => Number(row.quantity || 0) > 0)
    if (picked.length === 0) {
      notify.error('Load at least one line.')
      return
    }
    const tooMuch = picked.find((row) => Number(row.quantity) > row.line.maxHereBase)
    if (tooMuch) {
      notify.error(`${tooMuch.line.itemCode}: at most ${formatNumber(tooMuch.line.maxHereBase)} pieces can be loaded.`)
      return
    }

    if (over && !allowOverCapacity) {
      if (canOverCapacity) {
        const go = await confirm({
          title: 'Load above capacity?',
          message: `A ${type?.typeCode} holds ${formatNumber(capacity)} pieces and ${formatNumber(loaded)} are loaded. Save it above its capacity?`,
          confirmLabel: 'Save over capacity',
        })
        if (!go) return
        allowOverCapacity = true
      }
    }

    const request: SaveContainerRequest = {
      purchaseOrderId: order.id,
      containerNo: containerNo.trim() ? containerNo.trim().toUpperCase() : null,
      containerTypeId: Number(typeId),
      sealNo: sealNo.trim() || null,
      customsSealNo: null,
      description: null,
      orderDate,
      shippingMethod: 'Sea',
      countryOfOrigin: null,
      forwarderId: null,
      transporterId: null,
      shippingLine: null,
      vesselName: null,
      voyageNo: null,
      bookingNo: null,
      portOfLoadingId: portOfLoadingId ? Number(portOfLoadingId) : null,
      portOfDestinationId: portOfDestinationId ? Number(portOfDestinationId) : null,
      finalDestinationId: null,
      dispatchDate: null,
      eta,
      freeDays: null,
      grossWeightKg: null,
      volumeCbm: null,
      packages: null,
      blNo: null,
      blDate: null,
      blNotes: null,
      maxUnits: null,
      branchId: order.branchId,
      warehouseId: order.warehouseId,
      truckNo: null,
      waybillNo: null,
      declarationNo: null,
      feriNo: null,
      actualPortArrival: null,
      borderCrossingDate: null,
      customsReleaseDate: null,
      statusNote: null,
      notes: null,
      lines: picked.map((row) => ({
        poLineId: row.line.poLineId,
        quantityBase: Number(row.quantity),
        oilIncluded: row.oilIncluded,
        oilQtyPerUnit: row.oilIncluded && row.oilQtyPerUnit !== '' ? Number(row.oilQtyPerUnit) : null,
        notes: null,
      })),
      allowOverCapacity,
      rowVersion: null,
    }

    setSaving(open ? 'open' : 'save')
    try {
      const created = await containersApi.create(request)
      notify.success(`Container ${created.containerRef} created.`)
      onSaved(created, open)
    } catch (err) {
      // OVER_CAPACITY without the right, ALLOCATION_EXCEEDS_INVOICE, DUPLICATE…: the server's sentence.
      notify.error(err instanceof ApiError ? err.message : 'The container could not be saved.')
    } finally {
      setSaving(null)
    }
  }

  const typeOptions = types.map((t) => ({
    value: String(t.id),
    label: `${t.typeCode} - ${t.typeName}${t.maxUnits ? ` (${formatNumber(t.maxUnits)} pcs)` : ''}`,
  }))
  const portOptions = ports.map((p) => ({ value: String(p.id), label: portLabel(p) }))

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700}>Add Container - {order.documentNumber ?? `order #${order.id}`}</Text>}
      size="90rem"
      fullScreen={fullScreen}
      closeOnClickOutside={saving === null}
    >
      <Stack gap="md">
        <div>
          <Title order={6} mb="xs">
            Container
          </Title>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
            <Select
              label="Type"
              withAsterisk
              data={typeOptions}
              value={typeId}
              onChange={(next) => {
                setTypeId(next)
                setTypeError(null)
              }}
              error={typeError}
              searchable
              nothingFoundMessage="Nothing matches"
              data-autofocus
            />
            <TextInput label="Container No." placeholder="MSKU1234567" maxLength={20} value={containerNo} onChange={(e) => setContainerNo(e.currentTarget.value)} />
            <TextInput label="Seal No." maxLength={30} value={sealNo} onChange={(e) => setSealNo(e.currentTarget.value)} />
            <DateInput
              label="Order Date"
              withAsterisk
              valueFormat="DD/MM/YYYY"
              value={fromIsoDate(orderDate)}
              onChange={(next) => setOrderDate(next ? isoDate(new Date(next)) : null)}
            />
            <Select label="Port of Loading" data={portOptions} value={portOfLoadingId} onChange={setPortOfLoadingId} searchable clearable />
            <Select label="Port of Destination" data={portOptions} value={portOfDestinationId} onChange={setPortOfDestinationId} searchable clearable />
            <DateInput
              label="ETA"
              valueFormat="DD/MM/YYYY"
              clearable
              value={fromIsoDate(eta)}
              onChange={(next) => setEta(next ? isoDate(new Date(next)) : null)}
            />
          </SimpleGrid>
          <Text fz="xs" c="dimmed" mt={6}>
            Branch and warehouse are the order's.
          </Text>
        </div>

        <div>
          <Group justify="space-between" mb={4} wrap="wrap">
            <Text fz="sm" fw={600}>
              Capacity
            </Text>
            <Text fz="sm" c={over ? 'orange' : undefined} fw={over ? 700 : 400} data-capacity-label>
              {capacity === null
                ? `${formatNumber(loaded)} pcs loaded - pick a type for its capacity`
                : `${formatNumber(loaded)} / ${formatNumber(capacity)} pcs (${formatNumber(percent, 0)} %)${over ? ' - over capacity' : ''}`}
            </Text>
          </Group>
          <Progress value={Math.min(100, percent)} color={over ? 'orange' : 'blue'} size="lg" radius="xl" />
        </div>

        <div>
          <Group justify="space-between" mb="xs" wrap="wrap">
            <Title order={6}>Lines of this order</Title>
            <Button size="xs" variant="light" leftSection={<IconBox size={14} />} disabled={capacity === null || !rows?.length} onClick={fillOneContainer}>
              Fill one container
            </Button>
          </Group>
          {loadError ? <Alert color="red">{loadError}</Alert> : null}
          {rows === null && !loadError ? <Loader size="sm" /> : null}
          {rows && rows.length === 0 ? (
            <Text fz="sm" c="dimmed" ta="center" py="md">
              Nothing is left to load on this order.
            </Text>
          ) : null}
          {rows && rows.length > 0 ? (
            <ScrollArea type="auto">
              <Table miw={1050} verticalSpacing={4} striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Item code</Table.Th>
                    <Table.Th>Model</Table.Th>
                    <Table.Th ta="right">Ordered</Table.Th>
                    <Table.Th ta="right">Loaded elsewhere</Table.Th>
                    <Table.Th ta="right">Invoiced w/o container</Table.Th>
                    <Table.Th ta="right">Available</Table.Th>
                    <Table.Th w={140}>Load qty (pcs)</Table.Th>
                    <Table.Th>Oil</Table.Th>
                    <Table.Th w={120}>Oil qty/unit</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((row) => {
                    const qty = Number(row.quantity || 0)
                    const tooMuch = qty > row.line.maxHereBase
                    return (
                      <Table.Tr key={row.line.poLineId}>
                        <Table.Td>
                          <Text fz="sm" fw={600}>
                            {row.line.itemCode}
                          </Text>
                          <Text fz="xs" c="dimmed">
                            {row.line.itemName}
                          </Text>
                        </Table.Td>
                        <Table.Td>{row.line.model ?? '—'}</Table.Td>
                        <Table.Td ta="right">{formatNumber(row.line.orderedBase)}</Table.Td>
                        <Table.Td ta="right">{formatNumber(row.line.loadedElsewhereBase)}</Table.Td>
                        <Table.Td ta="right">{formatNumber(row.line.invoicedDirectBase)}</Table.Td>
                        <Table.Td ta="right" fw={600}>
                          {formatNumber(row.line.availableBase)}
                        </Table.Td>
                        <Table.Td>
                          <NumberInput
                            size="xs"
                            min={0}
                            max={row.line.maxHereBase}
                            allowDecimal={false}
                            allowNegative={false}
                            thousandSeparator=","
                            value={row.quantity}
                            error={tooMuch ? `Max ${formatNumber(row.line.maxHereBase)}` : undefined}
                            onChange={(next) => patch(row.line.poLineId, { quantity: numberInputValue(next) ?? '' })}
                            aria-label={`Load quantity of ${row.line.itemCode}`}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Checkbox
                            checked={row.oilIncluded}
                            onChange={(e) => patch(row.line.poLineId, { oilIncluded: e.currentTarget.checked })}
                            aria-label={`Oil included for ${row.line.itemCode}`}
                          />
                        </Table.Td>
                        <Table.Td>
                          <NumberInput
                            size="xs"
                            min={0}
                            decimalScale={2}
                            disabled={!row.oilIncluded}
                            value={row.oilQtyPerUnit}
                            onChange={(next) => patch(row.line.poLineId, { oilQtyPerUnit: numberInputValue(next) ?? '' })}
                            aria-label={`Oil per unit for ${row.line.itemCode}`}
                          />
                        </Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          ) : null}
        </div>

        <Group justify="flex-end" gap="xs" wrap="wrap">
          <Button variant="default" onClick={onClose} disabled={saving !== null}>
            Cancel
          </Button>
          <Button variant="light" leftSection={<IconExternalLink size={16} />} loading={saving === 'open'} disabled={saving === 'save'} onClick={() => void save(true)}>
            Save and open
          </Button>
          <Button leftSection={<IconDeviceFloppy size={16} />} loading={saving === 'save'} disabled={saving === 'open'} onClick={() => void save(false)}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
