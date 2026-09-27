import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Group,
  MultiSelect,
  NumberInput,
  Radio,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconSend } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  ALLOCATION_METHODS,
  containerChargesApi,
  SPLIT_RULES,
  type AllocationMethod,
  type ChargeGroupMemberDto,
  type SplitRule,
} from '../../api/logistics/containerCharges'
import { containersApi } from '../../api/logistics/containers'
import { movementsApi, type MovementContainerDto, type MovementListDto } from '../../api/logistics/movements'
import { currenciesApi } from '../../api/masterdata/currencies'
import { partiesApi } from '../../api/masterdata/parties'
import { allocationMethodLabel, chargeTypesApi, type ChargeTypeLookupDto } from '../../api/purchase/chargeTypes'
import { purchaseDocumentsApi } from '../../api/purchase/documents'
import type { CurrencyLookupDto, PartyLookupDto } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../navigation'
import { currencyLabel, formatMoney, formatNumber, numberInputValue, todayDateOnly } from '../format'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'

interface NewChargeModalProps {
  opened: boolean
  onClose: () => void
  presetContainerIds?: number[]
  presetMovementId?: number | null
  onCreated: () => void
}

/** A container the charge can be put on, with the pieces a "By pieces" split is weighted by. */
interface ContainerOption {
  id: number
  ref: string
  containerNo: string | null
  pieces: number
}

/** The containers a charge can still be typed for: Draft … Offloaded. */
const LAST_CHARGEABLE_STATUS = 6

function movementContainer(c: MovementContainerDto): ContainerOption {
  return { id: c.containerId, ref: c.containerRef, containerNo: c.containerNo, pieces: c.totalAllocatedBase }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * What each container would carry, in the charge currency — or null when only the server can say
 * ("By value" needs the invoice values). The rounding remainder goes on the last container so the
 * parts always add up to the total typed.
 */
function splitPreview(rule: SplitRule, total: number, rows: ContainerOption[]): number[] | null {
  if (rows.length === 0) return []
  if (rule === 'Value') return null
  if (rule === 'Same') return rows.map(() => round2(total))

  const weights = rule === 'Equal' ? rows.map(() => 1) : rows.map((row) => Math.max(row.pieces, 0))
  const sum = weights.reduce((acc, w) => acc + w, 0)
  if (sum <= 0) return null

  const parts = weights.map((w) => round2((total * w) / sum))
  const placed = parts.slice(0, -1).reduce((acc, part) => acc + part, 0)
  parts[parts.length - 1] = round2(total - placed)
  return parts
}

/**
 * "New charge": one bill (freight, clearing…) typed once for one or several containers. The server
 * makes one DRAFT per container, all in one group, split by the rule chosen here; the preview below
 * the amount is the same arithmetic done in the browser so the reader sees the split before saving.
 */
export function NewChargeModal({ opened, onClose, presetContainerIds, presetMovementId, onCreated }: NewChargeModalProps) {
  if (!opened) return null
  return (
    <NewChargeDialog
      onClose={onClose}
      presetContainerIds={presetContainerIds}
      presetMovementId={presetMovementId ?? null}
      onCreated={onCreated}
    />
  )
}

function NewChargeDialog({
  onClose,
  presetContainerIds,
  presetMovementId,
  onCreated,
}: {
  onClose: () => void
  presetContainerIds?: number[]
  presetMovementId: number | null
  onCreated: () => void
}) {
  const { hasPermission } = useAuth()
  const canPost = hasPermission(PERMISSIONS.containerChargesPost)

  const [allContainers, setAllContainers] = useState<ContainerOption[]>([])
  const [movementContainers, setMovementContainers] = useState<ContainerOption[] | null>(null)
  const [movements, setMovements] = useState<MovementListDto[]>([])
  const [chargeTypes, setChargeTypes] = useState<ChargeTypeLookupDto[]>([])
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  const [providers, setProviders] = useState<PartyLookupDto[]>([])

  const [containerIds, setContainerIds] = useState<string[]>((presetContainerIds ?? []).map(String))
  const [movementId, setMovementId] = useState<string | null>(presetMovementId === null ? null : String(presetMovementId))
  const [chargeTypeId, setChargeTypeId] = useState<string | null>(null)
  const [method, setMethod] = useState<AllocationMethod | null>(null)
  const [providerId, setProviderId] = useState<string | null>(null)
  const [reference, setReference] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(todayDateOnly())
  const [currencyId, setCurrencyId] = useState<string | null>(null)
  const [rate, setRate] = useState<number | null>(1)
  const [rateLoading, setRateLoading] = useState(false)
  const [rateMissing, setRateMissing] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [splitRule, setSplitRule] = useState<SplitRule>('Pieces')
  const [notes, setNotes] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<ChargeGroupMemberDto[] | null>(null)
  const [posting, setPosting] = useState(false)
  const [posted, setPosted] = useState(false)

  const baseCurrency = currencies.find((c) => c.isBaseCurrency)
  const baseCode = baseCurrency?.currencyCode ?? 'USD'
  const currency = currencies.find((c) => String(c.id) === currencyId)
  const isBase = currency?.isBaseCurrency ?? true
  const chargeType = chargeTypes.find((t) => String(t.id) === chargeTypeId)

  /** A movement restricts the containers to the ones it carries, and preselects them all. */
  const loadMovement = useCallback(async (id: number) => {
    try {
      const movement = await movementsApi.get(id)
      const rows = movement.containers.map(movementContainer)
      setMovementContainers(rows)
      setContainerIds(rows.map((r) => String(r.id)))
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The movement could not be loaded.')
    }
  }, [])

  const [presetIds] = useState<number[]>(presetContainerIds ?? [])
  const [presetMovement] = useState<number | null>(presetMovementId)

  // Lookups, once per opening. A preset container that is not in the list (a later status) is read on its own.
  useEffect(() => {
    let alive = true
    containersApi
      .list({ pageSize: 200, sortBy: 'ContainerRef', sortDir: 'desc' })
      .then(async (result) => {
        const rows: ContainerOption[] = result.items
          .filter((c) => c.status <= LAST_CHARGEABLE_STATUS)
          .map((c) => ({ id: c.id, ref: c.containerRef, containerNo: c.containerNo, pieces: c.totalQtyBase }))
        const missing = presetIds.filter((id) => !rows.some((r) => r.id === id))
        const extra = await Promise.all(
          missing.map((id) =>
            containersApi
              .get(id)
              .then((c): ContainerOption => ({ id: c.id, ref: c.containerRef, containerNo: c.containerNo, pieces: c.totalAllocatedBase }))
              .catch(() => null),
          ),
        )
        if (alive) setAllContainers([...rows, ...extra.filter((c): c is ContainerOption => c !== null)])
      })
      .catch(() => notify.error('The containers could not be loaded.'))
    movementsApi
      .list({ pageSize: 200 })
      .then((result) => alive && setMovements(result.items.filter((m) => m.status !== 4)))
      .catch(() => {})
    chargeTypesApi.lookup().then((types) => alive && setChargeTypes(types)).catch(() => notify.error('The charge types could not be loaded.'))
    partiesApi.lookup({ partyType: 'Supplier', activeOnly: true }).then((p) => alive && setProviders(p)).catch(() => {})
    currenciesApi
      .lookup()
      .then((list) => {
        if (!alive) return
        setCurrencies(list)
        const base = list.find((c) => c.isBaseCurrency)
        setCurrencyId((current) => current ?? (base ? String(base.id) : null))
      })
      .catch(() => notify.error('The currencies could not be loaded.'))
    if (presetMovement !== null) {
      movementsApi
        .get(presetMovement)
        .then((movement) => {
          if (!alive) return
          const rows = movement.containers.map(movementContainer)
          setMovementContainers(rows)
          setContainerIds(rows.map((r) => String(r.id)))
        })
        .catch(() => notify.error('The movement could not be loaded.'))
    }
    return () => {
      alive = false
    }
    // The presets are held in state: read once per opening, as the dialog was opened.
  }, [presetIds, presetMovement])

  function chooseMovement(next: string | null) {
    setMovementId(next)
    if (next === null) setMovementContainers(null)
    else void loadMovement(Number(next))
  }

  /** The rate of the charge currency on the charge date — editable, but looked up first. */
  const resolveRate = useCallback(
    async (nextCurrencyId: string | null, nextDate: string) => {
      const picked = currencies.find((c) => String(c.id) === nextCurrencyId)
      setRateMissing(false)
      if (!picked || picked.isBaseCurrency) {
        setRate(1)
        return
      }
      setRateLoading(true)
      try {
        const answer = await purchaseDocumentsApi.rate(picked.id, 1, nextDate || null)
        const found = answer.isBaseCurrency ? 1 : answer.rate
        setRate(found)
        setRateMissing(found === null)
      } catch {
        setRate(null)
        setRateMissing(true)
      } finally {
        setRateLoading(false)
      }
    },
    [currencies],
  )

  const options = movementContainers ?? allContainers
  const containerData = useMemo(
    () => options.map((c) => ({ value: String(c.id), label: c.containerNo ? `${c.ref} (${c.containerNo})` : c.ref })),
    [options],
  )
  const chosen = useMemo(
    () =>
      containerIds
        .map((id) => options.find((c) => String(c.id) === id) ?? allContainers.find((c) => String(c.id) === id))
        .filter((c): c is ContainerOption => c !== undefined),
    [containerIds, options, allContainers],
  )
  const preview = splitPreview(splitRule, total ?? 0, chosen)
  const previewSum = preview ? preview.reduce((acc, value) => acc + value, 0) : null
  const effectiveRate = isBase ? 1 : rate
  const totalBase = total !== null && effectiveRate ? round2(total / effectiveRate) : null
  const code = currency?.currencyCode ?? baseCode

  function pickChargeType(next: string | null) {
    setChargeTypeId(next)
    const type = chargeTypes.find((t) => String(t.id) === next)
    setMethod(type ? type.allocationMethod : null)
  }

  function validate(): Record<string, string> {
    const found: Record<string, string> = {}
    if (containerIds.length === 0) found.containers = 'Choose at least one container.'
    if (!chargeTypeId) found.chargeTypeId = 'Choose a charge type.'
    if (!date) found.date = 'Enter the charge date.'
    if (!currencyId) found.currencyId = 'Choose a currency.'
    if (!isBase && (rate === null || rate <= 0)) found.rate = 'Enter the exchange rate.'
    if (total === null || total <= 0) found.total = 'Enter an amount above zero.'
    return found
  }

  async function save() {
    const found = validate()
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    try {
      const drafts = await containerChargesApi.create({
        containerIds: containerIds.map(Number),
        movementId: movementId === null ? null : Number(movementId),
        chargeTypeId: Number(chargeTypeId),
        description: description.trim() || null,
        providerPartyId: providerId === null ? null : Number(providerId),
        reference: reference.trim() || null,
        chargeDate: date,
        currencyId: currencyId === null ? null : Number(currencyId),
        rateType: 1,
        exchangeRate: isBase ? 1 : rate,
        totalAmount: total ?? 0,
        splitRule,
        allocationMethod: method,
        notes: notes.trim() || null,
      })
      setCreated(drafts)
      notify.success(drafts.length === 1 ? 'Draft charge created.' : `${formatNumber(drafts.length)} draft charges created.`)
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'The charge could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function postNow() {
    if (!created) return
    setPosting(true)
    try {
      await containerChargesApi.postMany(created.map((c) => c.id))
      setPosted(true)
      notify.success(created.length === 1 ? 'Charge posted.' : `${formatNumber(created.length)} charges posted.`)
      onCreated()
      onClose()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The charges could not be posted.')
    } finally {
      setPosting(false)
    }
  }

  function close() {
    if (created && !posted) onCreated()
    onClose()
  }

  if (created) {
    return (
      <FormModal opened title="Charges created" onSubmit={() => {}} onClose={close} readOnly cancelLabel="Close" size="lg">
        <Text fz="sm">
          One draft per container{created.length > 1 ? ', in one group' : ''}. Drafts do not touch the item costs until they are
          posted.
        </Text>
        <Table.ScrollContainer minWidth={320}>
          <Table striped verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Container</Table.Th>
                <Table.Th ta="right">Amount</Table.Th>
                <Table.Th ta="right">Amount ({baseCode})</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {created.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>{row.containerRef}</Table.Td>
                  <Table.Td ta="right">{formatMoney(row.amount, code)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(row.amountBase, 2)}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={posted ? 'green' : 'gray'}>{posted ? 'Posted' : row.statusName}</Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {method === 'Manual' && !posted && (
          <Alert color="yellow">Manual allocation: open each draft and set its split over the items before posting.</Alert>
        )}
        {canPost && !posted && (
          <Group justify="flex-end">
            <Button leftSection={<IconSend size={16} />} loading={posting} onClick={() => void postNow()}>
              Post now
            </Button>
          </Group>
        )}
      </FormModal>
    )
  }

  return (
    <FormModal opened title="New charge" onSubmit={() => void save()} onClose={close} saving={saving} saveLabel="Save as draft" size="xl">
      {formError && <Alert color="red">{formError}</Alert>}

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="sm">
        <Select
          label="Movement"
          placeholder="Optional"
          description="Picking one puts the charge on its containers"
          data={movements.map((m) => ({ value: String(m.id), label: `${m.movementNo} - ${m.typeName} (${m.fromCode} → ${m.toCode})` }))}
          value={movementId}
          onChange={chooseMovement}
          searchable
          clearable
          nothingFoundMessage="No movement matches"
        />
        <MultiSelect
          label="Containers"
          withAsterisk
          placeholder={containerIds.length ? undefined : 'Choose containers'}
          data={containerData}
          value={containerIds}
          onChange={setContainerIds}
          searchable
          nothingFoundMessage="No container matches"
          error={errors.containers}
        />

        <Stack gap={4}>
          <Select
            label="Charge type"
            withAsterisk
            placeholder="Freight, clearing…"
            data={chargeTypes.map((t) => ({ value: String(t.id), label: `${t.chargeCode} - ${t.chargeName}` }))}
            value={chargeTypeId}
            onChange={pickChargeType}
            searchable
            nothingFoundMessage="No charge type matches"
            error={errors.chargeTypeId}
          />
          {chargeType && (
            <Group gap={6}>
              <Text fz="xs" c="dimmed">
                Default: {allocationMethodLabel(chargeType.allocationMethod)}
              </Text>
              <Badge size="xs" variant="light" color={chargeType.includeInLandedCost ? 'blue' : 'gray'}>
                {chargeType.includeInLandedCost ? 'enters the item cost' : 'not in cost'}
              </Badge>
            </Group>
          )}
        </Stack>
        <Select
          label="Allocation method"
          description="How each container's part is divided over its items"
          placeholder="The type's"
          data={ALLOCATION_METHODS.map((m) => ({ value: m, label: allocationMethodLabel(m) }))}
          value={method}
          onChange={(next) => setMethod(next as AllocationMethod | null)}
          disabled={!chargeType}
          allowDeselect={false}
        />

        <Select
          label="Provider"
          placeholder="Who billed it"
          data={providers.map((p) => ({ value: String(p.id), label: `${p.partyCode} - ${p.partyName}` }))}
          value={providerId}
          onChange={setProviderId}
          searchable
          clearable
          nothingFoundMessage="No provider matches"
        />
        <TextInput label="Reference" placeholder="Their invoice no." maxLength={100} value={reference} onChange={(e) => setReference(e.currentTarget.value)} />

        <DateInput
          label="Date"
          withAsterisk
          valueFormat="DD/MM/YYYY"
          value={date || null}
          onChange={(next) => {
            const value = next ? String(next).slice(0, 10) : ''
            setDate(value)
            if (value) void resolveRate(currencyId, value)
          }}
          error={errors.date}
        />
        <TextInput label="Description" placeholder="Optional" maxLength={200} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />

        <Select
          label="Currency"
          withAsterisk
          data={currencies.map((c) => ({ value: String(c.id), label: currencyLabel(c) }))}
          value={currencyId}
          onChange={(next) => {
            setCurrencyId(next)
            void resolveRate(next, date)
          }}
          searchable
          allowDeselect={false}
          error={errors.currencyId}
        />
        {isBase ? (
          <TextInput label="Exchange rate" value="1 (base currency)" readOnly />
        ) : (
          <NumberInput
            label={`Exchange rate (${code} per 1 ${baseCode})`}
            withAsterisk
            placeholder={rateLoading ? 'Looking up…' : 'Enter a rate'}
            value={rate ?? ''}
            min={0}
            decimalScale={6}
            thousandSeparator=","
            onChange={(next) => {
              const parsed = numberInputValue(next)
              setRate(parsed !== null && parsed > 0 ? parsed : null)
            }}
            error={errors.rate ?? (rateMissing && rate === null ? 'No rate is defined for this date — enter one.' : undefined)}
          />
        )}

        <NumberInput
          label={`Total amount (${code})`}
          withAsterisk
          placeholder="0.00"
          value={total ?? ''}
          min={0}
          decimalScale={2}
          fixedDecimalScale
          thousandSeparator=","
          onChange={(next) => setTotal(numberInputValue(next))}
          description={!isBase && totalBase !== null ? `≈ ${formatMoney(totalBase, baseCode)}` : undefined}
          error={errors.total}
        />
        <Textarea label="Notes" autosize minRows={1} maxLength={500} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
      </SimpleGrid>

      <Radio.Group
        label="Split over the containers"
        value={splitRule}
        onChange={(next) => setSplitRule(next as SplitRule)}
      >
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mt="xs">
          {SPLIT_RULES.map((rule) => (
            <Radio key={rule.value} value={rule.value} label={rule.label} />
          ))}
        </SimpleGrid>
      </Radio.Group>

      {chosen.length > 0 && (
        <Table.ScrollContainer minWidth={320}>
          <Table striped verticalSpacing={4} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Container</Table.Th>
                <Table.Th ta="right">Pieces</Table.Th>
                <Table.Th ta="right">Amount ({code})</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {chosen.map((row, index) => (
                <Table.Tr key={row.id}>
                  <Table.Td>{row.ref}</Table.Td>
                  <Table.Td ta="right">{formatNumber(row.pieces)}</Table.Td>
                  <Table.Td ta="right">
                    {preview ? (
                      formatNumber(preview[index], 2)
                    ) : (
                      <Text span fz="sm" c="dimmed">
                        {splitRule === 'Value' ? 'computed on save' : 'no pieces loaded'}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
            {previewSum !== null && (
              <Table.Tfoot>
                <Table.Tr>
                  <Table.Th colSpan={2}>Total of the drafts</Table.Th>
                  <Table.Th ta="right">{formatNumber(previewSum, 2)}</Table.Th>
                </Table.Tr>
              </Table.Tfoot>
            )}
          </Table>
        </Table.ScrollContainer>
      )}
    </FormModal>
  )
}
