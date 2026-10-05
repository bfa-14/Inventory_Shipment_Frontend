import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
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
import { fillOf, overCapacityMessage } from './containerFill'
import { ContainerFillLine } from './ContainerFillLine'
import { containerTypesApi, type ContainerTypeLookupDto } from '../../api/masterdata/containerTypes'
import { portLabel, portsApi, type PortLookupDto } from '../../api/masterdata/ports'
import { invoiceContainersApi, type InvoiceContainersCreatedDto } from '../../api/purchase/invoiceContainers'
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

/**
 * "Add container…" on an INVOICE shipped in containers (scripts 43 and 47): the order's form for ONE quantity of the
 * invoice's pieces outside containers - at most maxAddQty, the figures of the invoice's state - created on the order
 * and linked to the invoice. The server checks the same rules again and says which one failed.
 */
export interface ContainerInvoice {
  id: number
  documentNumber: string | null
  rowVersion: string | null
  /** The most a new container may take: per order line the lesser of the two figures below. */
  maxAddQty: number
  notInContainerQty: number
  orderLinesAvailableQty: number
  /** The items with pieces outside containers: a choice only on an invoice of several (made before script 45). */
  items: { itemId: number; itemCode: string; pcsPerContainer: number | null }[]
}

interface AddContainerModalProps {
  opened: boolean
  onClose: () => void
  order: ContainerOrder
  /** For this invoice of the order instead of the order itself. */
  invoice?: ContainerInvoice
  /** The reader may confirm a load above capacity (containers.overcapacity). */
  canOverCapacity: boolean
  /** open = "Save and open": the host navigates to the new container. Order mode. */
  onSaved?: (container: ContainerDto, open: boolean) => void
  /** Invoice mode: the container created and the invoice's containers after the link. */
  onInvoiceSaved?: (result: InvoiceContainersCreatedDto) => void
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
export function AddContainerModal({ opened, onClose, order, invoice, canOverCapacity, onSaved, onInvoiceSaved }: AddContainerModalProps) {
  const maxOf = (line: AvailablePoLineDto) => line.maxHereBase
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
  // Invoice mode: one quantity of one item, the oil as the order line has it (when the order is still open).
  const [qty, setQty] = useState<number | ''>(invoice ? invoice.maxAddQty : '')
  const [qtyError, setQtyError] = useState<string | null>(null)
  const [itemId, setItemId] = useState<string | null>(invoice?.items[0] ? String(invoice.items[0].itemId) : null)
  const [oilIncluded, setOilIncluded] = useState(false)
  const [oilQtyPerUnit, setOilQtyPerUnit] = useState<number | ''>('')

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
        // An invoice takes one quantity: the order lines only give the oil of its item (none once the order is closed).
        if (invoice) {
          const ofItem = lines.find((line) => String(line.itemId) === (invoice.items[0] ? String(invoice.items[0].itemId) : null))
          if (ofItem && (ofItem.itemOilQtyPerUnit ?? 0) > 0) {
            setOilIncluded(true)
            setOilQtyPerUnit(ofItem.itemOilQtyPerUnit ?? '')
          }
          setRows([])
          return
        }
        setRows(
          lines.map((line) => {
            const start = line.availableBase
            return {
              line,
              quantity: start > 0 ? start : '',
              oilIncluded: (line.itemOilQtyPerUnit ?? 0) > 0,
              oilQtyPerUnit: line.itemOilQtyPerUnit ?? '',
            }
          }),
        )
      })
      .catch((err: unknown) => live && setLoadError(err instanceof ApiError ? err.message : 'The order lines could not be loaded.'))
    return () => {
      live = false
    }
    // The invoice's pieces are read once per opening, as the dialog was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, order.id])

  const invoiceItem = invoice ? (invoice.items.find((i) => String(i.itemId) === itemId) ?? invoice.items[0] ?? null) : null
  /** The fill from the items' Container units (the API's pieces per container), as the server will judge it. */
  const fill = useMemo(
    () =>
      invoice
        ? fillOf(invoiceItem ? [{ itemId: invoiceItem.itemId, itemCode: invoiceItem.itemCode, quantity: Number(qty || 0), pcsPerContainer: invoiceItem.pcsPerContainer }] : [])
        : fillOf(
            (rows ?? []).map((row) => ({
              itemId: row.line.itemId,
              itemCode: row.line.itemCode,
              quantity: Number(row.quantity || 0),
              pcsPerContainer: row.line.pcPerContainer,
            })),
          ),
    [invoice, invoiceItem, qty, rows],
  )
  const canFillOne = invoice ? (invoiceItem?.pcsPerContainer ?? 0) > 0 && invoice.maxAddQty > 0 : (rows ?? []).some((row) => (row.line.pcPerContainer ?? 0) > 0)

  function patch(poLineId: number, next: Partial<LoadRow>) {
    setRows((current) => current?.map((row) => (row.line.poLineId === poLineId ? { ...row, ...next } : row)) ?? null)
  }

  /**
   * The lines in list order, each up to what is available, until the container is full by the items' Container
   * units (42 of an 84-piece item leave room for 60 of a 120-piece one). Lines of an item without one stay empty.
   */
  function fillOneContainer() {
    if (invoice) {
      const pcs = invoiceItem?.pcsPerContainer ?? 0
      if (pcs > 0) setQty(Math.min(pcs, invoice.maxAddQty))
      setQtyError(null)
      return
    }
    if (!rows) return
    let used = 0
    setRows(
      rows.map((row) => {
        const pcs = row.line.pcPerContainer ?? 0
        const room = pcs > 0 ? Math.floor((1 - used) * pcs + 1e-9) : 0
        const take = Math.max(0, Math.min(row.line.availableBase, room))
        if (pcs > 0) used += take / pcs
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
    if (invoice) {
      const wanted = Number(qty || 0)
      if (wanted < 1 || wanted > invoice.maxAddQty) {
        setQtyError(`Between 1 and ${formatNumber(invoice.maxAddQty)} pcs.`)
        return
      }
    }
    const picked = (rows ?? []).filter((row) => Number(row.quantity || 0) > 0)
    if (!invoice && picked.length === 0) {
      notify.error('Load at least one line.')
      return
    }
    const tooMuch = picked.find((row) => Number(row.quantity) > maxOf(row.line))
    if (tooMuch) {
      notify.error(`${tooMuch.line.itemCode}: at most ${formatNumber(maxOf(tooMuch.line))} pieces can be loaded.`)
      return
    }

    if (fill.over && !allowOverCapacity) {
      if (canOverCapacity) {
        const go = await confirm({
          title: 'Load above capacity?',
          message: overCapacityMessage(fill),
          confirmLabel: 'Save over capacity',
        })
        if (!go) return
        allowOverCapacity = true
      }
    }

    if (invoice) {
      setSaving('save')
      try {
        const result = await invoiceContainersApi.add(invoice.id, {
          rowVersion: invoice.rowVersion,
          quantityBase: Number(qty),
          itemId: itemId === null ? null : Number(itemId),
          oilIncluded,
          oilQtyPerUnit: oilIncluded && oilQtyPerUnit !== '' ? Number(oilQtyPerUnit) : null,
          containerNo: containerNo.trim() ? containerNo.trim().toUpperCase() : null,
          containerTypeId: Number(typeId),
          sealNo: sealNo.trim() || null,
          orderDate,
          shippingMethod: 'Sea',
          portOfLoadingId: portOfLoadingId ? Number(portOfLoadingId) : null,
          portOfDestinationId: portOfDestinationId ? Number(portOfDestinationId) : null,
          eta,
          allowOverCapacity,
        })
        notify.success(`Container ${result.created[0]?.containerRef ?? ''} created and linked to this invoice.`)
        onInvoiceSaved?.(result)
      } catch (err) {
        notify.error(err instanceof ApiError ? err.message : 'The container could not be saved.')
      } finally {
        setSaving(null)
      }
      return
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
      onSaved?.(created, open)
    } catch (err) {
      // OVER_CAPACITY without the right, ALLOCATION_EXCEEDS_INVOICE, DUPLICATE…: the server's sentence.
      notify.error(err instanceof ApiError ? err.message : 'The container could not be saved.')
    } finally {
      setSaving(null)
    }
  }

  const typeOptions = types.map((t) => ({
    value: String(t.id),
    label: `${t.typeCode} - ${t.typeName}`,
  }))
  const portOptions = ports.map((p) => ({ value: String(p.id), label: portLabel(p) }))

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Text fw={700}>
          Add Container - {invoice ? `invoice ${invoice.documentNumber ?? `draft #${invoice.id}`}, ` : ''}
          {order.documentNumber ?? `order #${order.id}`}
        </Text>
      }
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
          <Group justify="space-between" mb="xs" wrap="wrap">
            <Title order={6}>{invoice ? 'Pieces of this invoice not in a container yet' : 'Lines of this order'}</Title>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconBox size={14} />}
              disabled={!canFillOne}
              onClick={fillOneContainer}
            >
              Fill one container
            </Button>
          </Group>
          {invoice ? (
            <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
              {invoice.items.length > 1 ? (
                <Select
                  label="Item"
                  withAsterisk
                  data={invoice.items.map((i) => ({ value: String(i.itemId), label: i.itemCode }))}
                  value={itemId}
                  onChange={setItemId}
                  allowDeselect={false}
                />
              ) : null}
              <NumberInput
                label="Quantity (pcs)"
                withAsterisk
                min={1}
                max={invoice.maxAddQty}
                clampBehavior="strict"
                allowDecimal={false}
                allowNegative={false}
                thousandSeparator=","
                value={qty}
                onChange={(next) => {
                  setQty(numberInputValue(next) ?? '')
                  setQtyError(null)
                }}
                error={qtyError}
                description={`At most ${formatNumber(invoice.maxAddQty)} pcs: ${formatNumber(invoice.notInContainerQty)} not in a container on this invoice, the order allows ${formatNumber(invoice.orderLinesAvailableQty)} more.`}
                inputWrapperOrder={['label', 'input', 'description', 'error']}
              />
              <Checkbox label="Oil included" mt={{ base: 0, md: 30 }} checked={oilIncluded} onChange={(e) => setOilIncluded(e.currentTarget.checked)} />
              <NumberInput
                label="Oil qty/unit"
                min={0}
                decimalScale={2}
                disabled={!oilIncluded}
                value={oilQtyPerUnit}
                onChange={(next) => setOilQtyPerUnit(numberInputValue(next) ?? '')}
              />
            </SimpleGrid>
          ) : null}
          {loadError && !invoice ? <Alert color="red">{loadError}</Alert> : null}
          {rows === null && !loadError && !invoice ? <Loader size="sm" /> : null}
          {rows && rows.length === 0 && !invoice ? (
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
                    const tooMuch = qty > maxOf(row.line)
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
                            max={maxOf(row.line)}
                            allowDecimal={false}
                            allowNegative={false}
                            thousandSeparator=","
                            value={row.quantity}
                            error={tooMuch ? `Max ${formatNumber(maxOf(row.line))}` : undefined}
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
          {invoice || (rows && rows.length > 0) ? (
            <div style={{ marginTop: 'var(--mantine-spacing-sm)' }} data-capacity-label>
              <ContainerFillLine fill={fill} />
            </div>
          ) : null}
        </div>

        <Group justify="flex-end" gap="xs" wrap="wrap">
          <Button variant="default" onClick={onClose} disabled={saving !== null}>
            Cancel
          </Button>
          {!invoice && (
            <Button variant="light" leftSection={<IconExternalLink size={16} />} loading={saving === 'open'} disabled={saving === 'save'} onClick={() => void save(true)}>
              Save and open
            </Button>
          )}
          <Button leftSection={<IconDeviceFloppy size={16} />} loading={saving === 'save'} disabled={saving === 'open'} onClick={() => void save(false)}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
