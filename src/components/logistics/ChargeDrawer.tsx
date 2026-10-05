import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Center,
  Divider,
  Drawer,
  FileButton,
  Group,
  Loader,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { IconCopy, IconDeviceFloppy, IconDownload, IconSend, IconTrash, IconUpload, IconX } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  ALLOCATION_METHODS,
  chargeStatusColour,
  containerChargesApi,
  type AllocationMethod,
  type ContainerChargeDto,
} from '../../api/logistics/containerCharges'
import { containersApi } from '../../api/logistics/containers'
import { AttachmentUploadDialog } from '../attachments/AttachmentUploadDialog'
import { ATTACHMENT_ACCEPT, attachmentTypeLabel, formatBytes } from '../attachments/attachmentRules'
import { movementsApi } from '../../api/logistics/movements'
import { currenciesApi } from '../../api/masterdata/currencies'
import { partiesApi } from '../../api/masterdata/parties'
import { allocationMethodLabel, chargeTypesApi, type ChargeTypeLookupDto } from '../../api/purchase/chargeTypes'
import { purchaseDocumentsApi } from '../../api/purchase/documents'
import type { CurrencyLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../navigation'
import { CancelReasonModal } from '../documents/CancelReasonModal'
import { dateLabel, stamp } from '../documents/documentKind'
import { currencyLabel, formatMoney, formatNumber, numberInputValue } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { ApplyChargeModal } from './ApplyChargeModal'

interface ChargeDrawerProps {
  chargeId: number | null
  onClose: () => void
  onChanged: () => void
}

interface Header {
  chargeTypeId: string | null
  method: AllocationMethod
  providerId: string | null
  reference: string
  description: string
  date: string
  currencyId: string | null
  rate: number | null
  amount: number | null
  notes: string
  movementId: string | null
}

const CONTAINERS_ROUTE = '/logistics/containers'
const MOVEMENTS_ROUTE = '/logistics/movements'
const OFFLOADED = 6

function headerOf(dto: ContainerChargeDto): Header {
  return {
    chargeTypeId: String(dto.chargeTypeId),
    method: dto.allocationMethod,
    providerId: dto.providerPartyId === null ? null : String(dto.providerPartyId),
    reference: dto.reference ?? '',
    description: dto.description ?? '',
    date: dto.chargeDate.slice(0, 10),
    currencyId: String(dto.currencyId),
    rate: dto.exchangeRate,
    amount: dto.amount,
    notes: dto.notes ?? '',
    movementId: dto.movementId === null ? null : String(dto.movementId),
  }
}

function manualOf(dto: ContainerChargeDto): Record<number, number | null> {
  return Object.fromEntries(dto.allocations.map((a) => [a.containerLineId, a.amountBase]))
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * One container charge, opened from the charges list or the container page.
 *
 * A DRAFT IS A FORM, a posted or cancelled charge is a record: the header fields become text. The
 * allocation table is the point of the drawer — what the charge adds to the cost of every item on
 * the container. With the Manual method the reader types that split, and Save waits until nothing
 * is left to allocate (the server refuses a split that does not add up anyway).
 *
 * THE PROVIDER'S INVOICE IS UPLOADED ONCE FOR THE WHOLE GROUP: the same charge typed for three
 * containers is three drafts, and the file lands on all three containers.
 */
export function ChargeDrawer({ chargeId, onClose, onChanged }: ChargeDrawerProps) {
  const narrow = useMediaQuery('(max-width: 48em)')

  return (
    <Drawer
      opened={chargeId !== null}
      onClose={onClose}
      position="right"
      size={narrow ? '100%' : 'xl'}
      title={<Text fw={700} fz="lg">Container charge</Text>}
    >
      {chargeId !== null && <ChargeBody key={chargeId} chargeId={chargeId} onClose={onClose} onChanged={onChanged} />}
    </Drawer>
  )
}

function ChargeBody({ chargeId, onClose, onChanged }: { chargeId: number; onClose: () => void; onChanged: () => void }) {
  const { hasPermission } = useAuth()
  const mayEdit = hasPermission(PERMISSIONS.containerChargesCreate)
  const mayPost = hasPermission(PERMISSIONS.containerChargesPost)
  const mayCancel = hasPermission(PERMISSIONS.containerChargesCancel)
  const mayAttach = hasPermission(PERMISSIONS.containerAttachmentsManage)

  const [dto, setDto] = useState<ContainerChargeDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [header, setHeader] = useState<Header | null>(null)
  const [manual, setManual] = useState<Record<number, number | null>>({})
  const [dirty, setDirty] = useState(false)

  const [chargeTypes, setChargeTypes] = useState<ChargeTypeLookupDto[]>([])
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  const [providers, setProviders] = useState<PartyLookupDto[]>([])
  const [movementOptions, setMovementOptions] = useState<{ value: string; label: string }[]>([])

  const [busy, setBusy] = useState<'save' | 'post' | 'cancel' | 'delete' | null>(null)
  /** The file picked for an upload: the shared dialog asks its type, date and note before it goes. */
  const [uploading, setUploading] = useState<{ file: File } | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [rateLoading, setRateLoading] = useState(false)

  const adopt = useCallback((next: ContainerChargeDto) => {
    setDto(next)
    setHeader(headerOf(next))
    setManual(manualOf(next))
    setDirty(false)
  }, [])

  const load = useCallback(async () => {
    try {
      adopt(await containerChargesApi.get(chargeId))
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'The charge could not be loaded.')
    }
  }, [chargeId, adopt])

  useEffect(() => {
    let alive = true
    containerChargesApi
      .get(chargeId)
      .then((next) => alive && adopt(next))
      .catch((err: unknown) => alive && setLoadError(err instanceof ApiError ? err.message : 'The charge could not be loaded.'))
    return () => {
      alive = false
    }
  }, [chargeId, adopt])

  const containerId = dto?.containerId ?? null
  const typeId = dto?.chargeTypeId ?? null
  const providerPartyId = dto?.providerPartyId ?? null
  const currentMovementId = dto?.movementId ?? null
  const currentMovementNo = dto?.movementNo ?? null

  useEffect(() => {
    if (containerId === null || typeId === null) return
    let alive = true
    chargeTypesApi.lookup(true, typeId).then((t) => alive && setChargeTypes(t)).catch(() => {})
    currenciesApi.lookup(true).then((c) => alive && setCurrencies(c)).catch(() => {})
    partiesApi
      .lookup({ partyType: 'Supplier', activeOnly: true, includeId: providerPartyId ?? undefined })
      .then((p) => alive && setProviders(p))
      .catch(() => {})
    movementsApi
      .list({ containerId, pageSize: 100 })
      .then((result) => {
        if (!alive) return
        const rows = result.items
          .filter((m) => m.status !== 4)
          .map((m) => ({ value: String(m.id), label: `${m.movementNo} - ${m.typeName}` }))
        if (currentMovementId !== null && !rows.some((r) => r.value === String(currentMovementId))) {
          rows.unshift({ value: String(currentMovementId), label: currentMovementNo ?? `#${currentMovementId}` })
        }
        setMovementOptions(rows)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [containerId, typeId, providerPartyId, currentMovementId, currentMovementNo])

  const editable = Boolean(dto?.canEdit && mayEdit)
  const currency = currencies.find((c) => String(c.id) === header?.currencyId)
  const isBase = currency ? currency.isBaseCurrency : header?.rate === 1
  const baseCode = currencies.find((c) => c.isBaseCurrency)?.currencyCode ?? 'USD'
  const code = currency?.currencyCode ?? dto?.currencyCode ?? baseCode

  const amountBase = useMemo(() => {
    if (!header || header.amount === null) return null
    const rate = isBase ? 1 : header.rate
    if (!rate || rate <= 0) return null
    return round2(header.amount / rate)
  }, [header, isBase])

  const isManual = header?.method === 'Manual'
  const placed = Object.values(manual).reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const remaining = round2((amountBase ?? 0) - placed)
  const manualComplete = !isManual || Math.abs(remaining) < 0.005

  function patch(next: Partial<Header>) {
    setHeader((current) => (current ? { ...current, ...next } : current))
    setDirty(true)
  }

  async function resolveRate(nextCurrencyId: string | null, date: string) {
    const picked = currencies.find((c) => String(c.id) === nextCurrencyId)
    if (!picked) return
    if (picked.isBaseCurrency) {
      patch({ rate: 1 })
      return
    }
    setRateLoading(true)
    try {
      const answer = await purchaseDocumentsApi.rate(picked.id, 1, date || null)
      patch({ rate: answer.isBaseCurrency ? 1 : answer.rate })
    } catch {
      patch({ rate: null })
    } finally {
      setRateLoading(false)
    }
  }

  function fail(err: unknown, fallback: string) {
    notify.error(err instanceof ApiError ? err.message : fallback)
    if (err instanceof ApiError && err.code === 'CONCURRENCY') void load()
  }

  async function save() {
    if (!dto || !header) return
    if (!header.chargeTypeId || !header.date || header.amount === null || header.amount <= 0) {
      notify.error('Charge type, date and an amount above zero are required.')
      return
    }
    if (!isBase && (header.rate === null || header.rate <= 0)) {
      notify.error('Enter the exchange rate.')
      return
    }
    setBusy('save')
    try {
      const next = await containerChargesApi.update(dto.id, {
        movementId: header.movementId === null ? null : Number(header.movementId),
        chargeTypeId: Number(header.chargeTypeId),
        description: header.description.trim() || null,
        providerPartyId: header.providerId === null ? null : Number(header.providerId),
        reference: header.reference.trim() || null,
        chargeDate: header.date,
        currencyId: header.currencyId === null ? null : Number(header.currencyId),
        rateType: dto.rateType,
        exchangeRate: isBase ? 1 : header.rate,
        amount: header.amount,
        allocationMethod: header.method,
        notes: header.notes.trim() || null,
        manual: isManual
          ? Object.entries(manual)
              .filter(([, value]) => value !== null && value !== 0)
              .map(([lineId, value]) => ({ containerLineId: Number(lineId), amountBase: value ?? 0 }))
          : [],
        rowVersion: dto.rowVersion,
      })
      adopt(next)
      notify.success('Charge saved.')
      onChanged()
    } catch (err) {
      fail(err, 'The charge could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  async function post() {
    if (!dto) return
    const go = await confirm({
      title: 'Post charge',
      message:
        dto.containerStatus === OFFLOADED
          ? 'Post this charge? The container is offloaded: the item costs will be adjusted.'
          : 'Post this charge? It is locked once posted and counts in the item costs.',
      confirmLabel: 'Post',
    })
    if (!go) return
    setBusy('post')
    try {
      adopt(await containerChargesApi.post(dto.id, dto.rowVersion))
      notify.success('Charge posted.')
      onChanged()
    } catch (err) {
      fail(err, 'The charge could not be posted.')
    } finally {
      setBusy(null)
    }
  }

  async function cancelCharge(reason: string) {
    if (!dto) return
    setBusy('cancel')
    try {
      adopt(await containerChargesApi.cancel(dto.id, reason, dto.rowVersion))
      setCancelOpen(false)
      notify.success('Charge cancelled.')
      onChanged()
    } catch (err) {
      fail(err, 'The charge could not be cancelled.')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!dto) return
    const go = await confirm({
      title: 'Delete draft',
      message: `Delete this ${dto.chargeName} draft on ${dto.containerRef}? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!go) return
    setBusy('delete')
    try {
      await containerChargesApi.remove(dto.id)
      notify.success('Draft deleted.')
      onChanged()
      onClose()
    } catch (err) {
      fail(err, 'The draft could not be deleted.')
    } finally {
      setBusy(null)
    }
  }

  /** Every container of the group: an upload goes on all of them. */
  const groupContainerIds = dto ? Array.from(new Set([dto.containerId, ...dto.group.map((g) => g.containerId)])) : []

  async function download(id: number, fileName: string) {
    try {
      await containersApi.downloadAttachment(id, fileName)
    } catch (err) {
      fail(err, 'The document could not be downloaded.')
    }
  }

  if (loadError) return <Alert color="red">{loadError}</Alert>
  if (!dto || !header) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  }

  const others = dto.group.filter((g) => g.id !== dto.id)
  const chargeType = chargeTypes.find((t) => String(t.id) === header.chargeTypeId)

  return (
    <Stack gap="md">
      <Group gap="xs" wrap="wrap">
        <Anchor component={Link} to={`${CONTAINERS_ROUTE}/${dto.containerId}`} fw={600}>
          {dto.containerRef}
        </Anchor>
        {dto.containerNo && <Text c="dimmed" fz="sm">{dto.containerNo}</Text>}
        <Badge variant="light" color={chargeStatusColour(dto.status)}>{dto.statusName}</Badge>
        {dto.adjustedAfterOffload && <Badge variant="light" color="orange" size="sm">after offload</Badge>}
        {!dto.includeInLandedCost && <Badge variant="light" color="gray" size="sm">not in cost</Badge>}
      </Group>

      {others.length > 0 && (
        <Text fz="sm">
          Also on{' '}
          {others.map((g, index) => (
            <span key={g.id}>
              {index > 0 && ', '}
              <Anchor component={Link} to={`${CONTAINERS_ROUTE}/${g.containerId}`} fz="sm">
                {g.containerRef}
              </Anchor>
            </span>
          ))}
        </Text>
      )}

      {dto.status === 3 && dto.cancelReason && (
        <Alert color="red" title={`Cancelled${dto.cancelledByName ? ` by ${dto.cancelledByName}` : ''} on ${stamp(dto.cancelledAtUtc)}`}>
          {dto.cancelReason}
        </Alert>
      )}

      <Paper withBorder radius="lg" p="md">
        {editable ? (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="sm">
            <Stack gap={4}>
              <Select
                label="Charge type"
                withAsterisk
                data={chargeTypes.map((t) => ({ value: String(t.id), label: `${t.chargeCode} - ${t.chargeName}` }))}
                value={header.chargeTypeId}
                onChange={(next) => {
                  const type = chargeTypes.find((t) => String(t.id) === next)
                  patch({ chargeTypeId: next, ...(type ? { method: type.allocationMethod } : {}) })
                }}
                searchable
                allowDeselect={false}
                nothingFoundMessage="No charge type matches"
              />
              {chargeType && (
                <Text fz="xs" c="dimmed">
                  Default: {allocationMethodLabel(chargeType.allocationMethod)} · {chargeType.includeInLandedCost ? 'enters the item cost' : 'not in cost'}
                </Text>
              )}
            </Stack>
            <Select
              label="Allocation method"
              data={ALLOCATION_METHODS.map((m) => ({ value: m, label: allocationMethodLabel(m) }))}
              value={header.method}
              onChange={(next) => next && patch({ method: next as AllocationMethod })}
              allowDeselect={false}
            />
            <Select
              label="Provider"
              placeholder="Who billed it"
              data={providers.map((p) => ({ value: String(p.id), label: `${p.partyCode} - ${p.partyName}` }))}
              value={header.providerId}
              onChange={(next) => patch({ providerId: next })}
              searchable
              clearable
              nothingFoundMessage="No provider matches"
            />
            <TextInput label="Reference" maxLength={100} value={header.reference} onChange={(e) => patch({ reference: e.currentTarget.value })} />
            <DateInput
              label="Date"
              withAsterisk
              valueFormat="DD/MM/YYYY"
              value={header.date || null}
              onChange={(next) => {
                const value = next ? String(next).slice(0, 10) : ''
                patch({ date: value })
                if (value) void resolveRate(header.currencyId, value)
              }}
            />
            <Select
              label="Movement"
              placeholder="None"
              data={movementOptions}
              value={header.movementId}
              onChange={(next) => patch({ movementId: next })}
              searchable
              clearable
            />
            <Select
              label="Currency"
              withAsterisk
              data={currencies.map((c) => ({ value: String(c.id), label: currencyLabel(c) }))}
              value={header.currencyId}
              onChange={(next) => {
                patch({ currencyId: next })
                void resolveRate(next, header.date)
              }}
              searchable
              allowDeselect={false}
            />
            {isBase ? (
              <TextInput label="Exchange rate" value="1 (base currency)" readOnly />
            ) : (
              <NumberInput
                label={`Exchange rate (${code} per 1 ${baseCode})`}
                withAsterisk
                placeholder={rateLoading ? 'Looking up…' : 'Enter a rate'}
                value={header.rate ?? ''}
                min={0}
                decimalScale={6}
                thousandSeparator=","
                onChange={(next) => {
                  const parsed = numberInputValue(next)
                  patch({ rate: parsed !== null && parsed > 0 ? parsed : null })
                }}
                error={header.rate === null && !rateLoading ? 'No rate for this date — enter one.' : undefined}
              />
            )}
            <NumberInput
              label={`Amount (${code})`}
              withAsterisk
              value={header.amount ?? ''}
              min={0}
              decimalScale={2}
              fixedDecimalScale
              thousandSeparator=","
              onChange={(next) => patch({ amount: numberInputValue(next) })}
              description={`= ${amountBase === null ? '—' : formatMoney(amountBase, baseCode)}`}
            />
            <TextInput label="Description" maxLength={200} value={header.description} onChange={(e) => patch({ description: e.currentTarget.value })} />
            <Textarea
              label="Notes"
              autosize
              minRows={2}
              maxLength={500}
              value={header.notes}
              onChange={(e) => patch({ notes: e.currentTarget.value })}
              style={{ gridColumn: '1 / -1' }}
            />
          </SimpleGrid>
        ) : (
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md" verticalSpacing="xs">
            <Field label="Charge type" value={`${dto.chargeCode} - ${dto.chargeName}`} />
            <Field label="Allocation method" value={allocationMethodLabel(dto.allocationMethod)} />
            <Field label="Provider" value={dto.providerName} />
            <Field label="Reference" value={dto.reference} />
            <Field label="Date" value={dateLabel(dto.chargeDate)} />
            <Field
              label="Movement"
              value={
                dto.movementId ? (
                  <Anchor component={Link} to={`${MOVEMENTS_ROUTE}/${dto.movementId}`} fz="sm">
                    {dto.movementNo ?? `#${dto.movementId}`}
                  </Anchor>
                ) : null
              }
            />
            <Field label="Amount" value={formatMoney(dto.amount, dto.currencyCode)} />
            <Field label={`Amount (${baseCode})`} value={formatNumber(dto.amountBase, 2)} />
            <Field label="Exchange rate" value={formatNumber(dto.exchangeRate, 6)} />
            <Field label="Description" value={dto.description} />
            <Field label="Notes" value={dto.notes} />
            <Field label="Posted" value={dto.postedAtUtc ? `${stamp(dto.postedAtUtc)}${dto.postedByName ? ` by ${dto.postedByName}` : ''}` : null} />
          </SimpleGrid>
        )}
      </Paper>

      <div>
        <Group justify="space-between" mb={4} wrap="wrap">
          <Title order={5}>Allocation over the items</Title>
          {isManual && editable && (
            <Badge variant="light" color={manualComplete ? 'green' : 'red'}>
              Remaining to allocate: {formatNumber(remaining, 2)} {baseCode}
            </Badge>
          )}
        </Group>
        {dirty && !isManual && (
          <Text fz="xs" c="dimmed" mb={4}>
            The figures below are as saved; they are recomputed on Save.
          </Text>
        )}
        <Table.ScrollContainer minWidth={560}>
          <Table striped verticalSpacing={4} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40}>#</Table.Th>
                <Table.Th>Item</Table.Th>
                <Table.Th ta="right">Quantity</Table.Th>
                <Table.Th ta="right">Basis</Table.Th>
                <Table.Th ta="right" w={isManual && editable ? 150 : undefined}>Amount ({baseCode})</Table.Th>
                <Table.Th ta="right">Per unit</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {dto.allocations.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text fz="sm" c="dimmed">Nothing loaded on the container yet.</Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {dto.allocations.map((a) => (
                <Table.Tr key={a.containerLineId}>
                  <Table.Td>{a.lineNumber}</Table.Td>
                  <Table.Td>
                    <Text fz="sm" fw={500}>{a.itemCode}</Text>
                    <Text fz="xs" c="dimmed" lineClamp={1}>{a.itemName}</Text>
                  </Table.Td>
                  <Table.Td ta="right">{formatNumber(a.quantityBase)}</Table.Td>
                  <Table.Td ta="right">{a.basis === null ? '—' : formatNumber(a.basis, 2)}</Table.Td>
                  <Table.Td ta="right">
                    {isManual && editable ? (
                      <NumberInput
                        size="xs"
                        value={manual[a.containerLineId] ?? ''}
                        min={0}
                        decimalScale={2}
                        thousandSeparator=","
                        onChange={(next) => {
                          setManual((current) => ({ ...current, [a.containerLineId]: numberInputValue(next) }))
                          setDirty(true)
                        }}
                        aria-label={`Amount for line ${a.lineNumber}`}
                      />
                    ) : (
                      formatNumber(a.amountBase, 2)
                    )}
                  </Table.Td>
                  <Table.Td ta="right">
                    {isManual && editable
                      ? a.quantityBase > 0
                        ? formatNumber((manual[a.containerLineId] ?? 0) / a.quantityBase, 4)
                        : '—'
                      : a.perUnitBase === null
                        ? '—'
                        : formatNumber(a.perUnitBase, 4)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </div>

      <div>
        <Group justify="space-between" mb={4} wrap="wrap">
          <Title order={5}>Documents</Title>
          {mayAttach && dto.status !== 3 && (
            <FileButton accept={ATTACHMENT_ACCEPT} onChange={(file) => file && setUploading({ file })}>
              {(props) => (
                <Button {...props} size="xs" variant="default" leftSection={<IconUpload size={14} />}>
                  Upload
                </Button>
              )}
            </FileButton>
          )}
        </Group>
        {others.length > 0 && mayAttach && (
          <Text fz="xs" c="dimmed" mb={4}>
            An upload goes on every container of the group ({formatNumber(others.length + 1)} containers).
          </Text>
        )}
        {dto.attachments.length === 0 ? (
          <Text fz="sm" c="dimmed">No document yet — the provider's invoice belongs here.</Text>
        ) : (
          <Stack gap={4}>
            {dto.attachments.map((file) => (
              <Group key={file.id} justify="space-between" wrap="nowrap" gap="xs">
                <div style={{ minWidth: 0 }}>
                  <Text fz="sm" truncate>{file.fileName}</Text>
                  <Text fz="xs" c="dimmed">
                    {[attachmentTypeLabel(file.category, file.subType), file.documentDate ? dateLabel(file.documentDate) : null, formatBytes(file.sizeBytes)].join(' · ')}
                  </Text>
                </div>
                <Tooltip label="Download" withArrow>
                  <ActionIcon variant="subtle" aria-label={`Download ${file.fileName}`} onClick={() => void download(file.id, file.fileName)}>
                    <IconDownload size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
          </Stack>
        )}
      </div>

      <Divider />

      <Group justify="flex-end" gap="xs" wrap="wrap">
        {dto.canCopy && mayEdit && (
          <Tooltip label="Save your changes first" disabled={!dirty} withArrow>
            <Button
              variant="light"
              leftSection={<IconCopy size={16} />}
              disabled={dirty || busy !== null}
              onClick={() => setCopyOpen(true)}
              data-apply-charge
            >
              Apply to other containers…
            </Button>
          </Tooltip>
        )}
        {dto.canDelete && mayEdit && (
          <Button color="red" variant="light" leftSection={<IconTrash size={16} />} loading={busy === 'delete'} disabled={busy !== null && busy !== 'delete'} onClick={() => void remove()}>
            Delete
          </Button>
        )}
        {dto.canCancel && mayCancel && (
          <Button color="red" variant="light" leftSection={<IconX size={16} />} disabled={busy !== null} onClick={() => setCancelOpen(true)}>
            Cancel charge
          </Button>
        )}
        {editable && (
          <Tooltip label="The manual split must use the whole amount" disabled={manualComplete} withArrow>
            <Button
              variant="default"
              leftSection={<IconDeviceFloppy size={16} />}
              loading={busy === 'save'}
              disabled={!dirty || !manualComplete || (busy !== null && busy !== 'save')}
              onClick={() => void save()}
            >
              Save
            </Button>
          </Tooltip>
        )}
        {dto.canPost && mayPost && (
          <Tooltip label="Save your changes first" disabled={!dirty} withArrow>
            <Button
              leftSection={<IconSend size={16} />}
              loading={busy === 'post'}
              disabled={dirty || (busy !== null && busy !== 'post')}
              onClick={() => void post()}
            >
              Post
            </Button>
          </Tooltip>
        )}
      </Group>

      <AttachmentUploadDialog
        opened={uploading !== null}
        documentKind="CONTAINER"
        initialFile={uploading?.file ?? null}
        filing={{
          containerIds: groupContainerIds,
          otherContainers: [],
          movementOptions: [],
          fixedText:
            groupContainerIds.length > 1
              ? `Filed under this charge on ${formatNumber(groupContainerIds.length)} containers.`
              : `Filed under this charge on ${dto.containerRef}.`,
        }}
        onUpload={(file, fields) =>
          containersApi.addAttachment({ file, containerIds: groupContainerIds, chargeId: dto.id, movementId: dto.movementId, ...fields })
        }
        onClose={() => setUploading(null)}
        onUploaded={() => {
          setUploading(null)
          notify.success(groupContainerIds.length > 1 ? `Document added to ${formatNumber(groupContainerIds.length)} containers.` : 'Document added.')
          void load()
          onChanged()
        }}
      />

      {copyOpen && (
        <ApplyChargeModal
          charge={dto}
          onClose={() => setCopyOpen(false)}
          onCopied={() => {
            setCopyOpen(false)
            // The group now lists the new containers.
            void load()
            onChanged()
          }}
        />
      )}

      <CancelReasonModal
        opened={cancelOpen}
        onClose={() => setCancelOpen(false)}
        documentLabel={`${dto.chargeName} on ${dto.containerRef}`}
        busy={busy === 'cancel'}
        confirmLabel="Cancel charge"
        description={
          dto.containerStatus === OFFLOADED
            ? 'The container is already offloaded: the item costs will be adjusted back. The charge stays as a record. It cannot be undone.'
            : 'The charge stops counting in the item costs and stays as a record. It cannot be undone.'
        }
        onConfirm={(reason) => void cancelCharge(reason)}
      />
    </Stack>
  )
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <Text fz="xs" c="dimmed">{label}</Text>
      <Text fz="sm" component="div">{value === null || value === undefined || value === '' ? '—' : value}</Text>
    </div>
  )
}
