import { useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useDebouncedCallback } from '@mantine/hooks'
import { IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import {
  chargeStatusColour,
  containerChargesApi,
  type ChargeCopyCandidateDto,
  type CopiedContainerChargeDto,
  type CopyContainerChargeRequest,
} from '../../api/logistics/containerCharges'
import { containerStatusColour, containerStatusLabel } from '../../api/logistics/containers'
import { allocationMethodLabel, chargeTypesApi } from '../../api/purchase/chargeTypes'
import { useAuth } from '../../auth/useAuth'
import { PERMISSIONS } from '../../navigation'
import { dateLabel, fromIsoDate, isoDate } from '../documents/documentKind'
import { formatMoney, formatNumber, numberInputValue } from '../format'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'

/** What the dialog shows of the charge: the drawer's charge and a row of the container's Charges card both carry it. */
export interface CopyableCharge {
  id: number
  chargeTypeId: number
  chargeCode: string
  chargeName: string
  amount: number
  currencyCode: string
  providerName: string | null
  reference: string | null
  chargeDate: string
  status: number
  allocationMethod: string
}

type CopyMethod = NonNullable<CopyContainerChargeRequest['allocationMethod']>

const COPY_METHODS: CopyMethod[] = ['Value', 'Quantity', 'Weight', 'Volume']

const STATUS_NAMES: Record<number, string> = { 1: 'Draft', 2: 'Posted', 3: 'Cancelled' }

interface ApplyChargeModalProps {
  charge: CopyableCharge
  onClose(): void
  onCopied(created: CopiedContainerChargeDto[]): void
}

/**
 * "Apply to other containers…": the same bill on containers that were left out (1,000 USD of freight
 * on one container, the same on four others). The server makes one DRAFT per container in the
 * charge's group — same type, provider, reference, currency and rate — and posts them at once when
 * asked (containers.charges.post).
 *
 * The list is the server's: containers not closed or cancelled, by default those of the same order.
 * A container that already has the charge (the original's, or one of its group) cannot be ticked.
 * The amount is PER CONTAINER, in the charge's currency; the method defaults to the charge's, or to
 * the charge type's when the charge was split by hand (a manual split cannot be copied).
 */
export function ApplyChargeModal({ charge, onClose, onCopied }: ApplyChargeModalProps) {
  const { hasPermission } = useAuth()
  const canPost = hasPermission(PERMISSIONS.containerChargesPost)

  const [sameOrder, setSameOrder] = useState(true)
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [result, setResult] = useState<{ key: string; rows: ChargeCopyCandidateDto[] } | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<number>>(new Set())

  const [amount, setAmount] = useState<number | ''>(charge.amount)
  const [chargeDate, setChargeDate] = useState<string | null>(charge.chargeDate.slice(0, 10))
  const [method, setMethod] = useState<CopyMethod | null>(
    COPY_METHODS.includes(charge.allocationMethod as CopyMethod) ? (charge.allocationMethod as CopyMethod) : null,
  )
  const [post, setPost] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const commitSearch = useDebouncedCallback((value: string) => setApplied(value.trim()), 350)
  const key = `${applied}|${sameOrder}`
  const loading = result?.key !== key && listError === null

  // A manual charge: the copies take the charge type's own method.
  useEffect(() => {
    if (COPY_METHODS.includes(charge.allocationMethod as CopyMethod)) return
    let live = true
    chargeTypesApi
      .lookup(false, charge.chargeTypeId)
      .then((types) => {
        const type = types.find((t) => t.id === charge.chargeTypeId)
        const typeMethod = type && COPY_METHODS.includes(type.allocationMethod as CopyMethod) ? (type.allocationMethod as CopyMethod) : 'Value'
        if (live) setMethod((current) => current ?? typeMethod)
      })
      .catch(() => live && setMethod((current) => current ?? 'Value'))
    return () => {
      live = false
    }
  }, [charge.allocationMethod, charge.chargeTypeId])

  useEffect(() => {
    const controller = new AbortController()
    containerChargesApi
      .copyCandidates(charge.id, { search: applied || undefined, sameOrder }, controller.signal)
      .then((rows) => {
        setResult({ key: `${applied}|${sameOrder}`, rows })
        setListError(null)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setListError(err instanceof ApiError ? err.message : 'The containers could not be loaded.')
      })
    return () => controller.abort()
  }, [charge.id, applied, sameOrder])

  const rows = result?.rows ?? []
  const selectable = rows.filter((row) => !row.hasThisCharge)
  const chosen = selectable.filter((row) => ticked.has(row.containerId))

  function toggle(id: number, on: boolean) {
    setTicked((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function save() {
    if (chosen.length === 0) {
      setError('Tick at least one container.')
      return
    }
    if (amount === '' || Number(amount) < 0) {
      setError('The amount per container is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await containerChargesApi.copy(charge.id, {
        containerIds: chosen.map((row) => row.containerId),
        amount: Number(amount),
        chargeDate,
        allocationMethod: method,
        post: canPost && post,
      })
      const posted = created.length > 0 && created.every((c) => c.status === 2)
      notify.success(
        `Charge added to ${formatNumber(created.length)} container${created.length === 1 ? '' : 's'} (${posted ? 'posted' : created.length === 1 ? 'draft' : 'drafts'})`,
      )
      onCopied(created)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The charge could not be copied.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      opened
      title="Apply to other containers"
      onSubmit={() => void save()}
      onClose={onClose}
      saving={saving}
      saveLabel={chosen.length > 0 ? `Apply to ${formatNumber(chosen.length)} container${chosen.length === 1 ? '' : 's'}` : 'Apply'}
      saveDisabled={chosen.length === 0}
      size="xl"
    >
      <Stack gap="sm">
        <Paper withBorder radius="md" p="sm" bg="var(--mantine-color-gray-0)" data-copy-charge>
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Text fw={700}>
              {charge.chargeCode} - {charge.chargeName}
            </Text>
            <Group gap="xs">
              <Text fw={700}>{formatMoney(charge.amount, charge.currencyCode)}</Text>
              <Badge variant="light" color={chargeStatusColour(charge.status)}>
                {STATUS_NAMES[charge.status] ?? charge.status}
              </Badge>
            </Group>
          </Group>
          <Text fz="sm" c="dimmed">
            {[charge.providerName, charge.reference, dateLabel(charge.chargeDate), allocationMethodLabel(charge.allocationMethod)].filter(Boolean).join(' · ')}
          </Text>
        </Paper>

        <Group gap="md" wrap="wrap" align="flex-end">
          <TextInput
            label="Search"
            placeholder="Container ref. or no."
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => {
              const value = e.currentTarget.value
              setSearch(value)
              if (!value.trim()) setApplied('')
              else commitSearch(value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                setApplied(search.trim())
              }
            }}
            w={240}
          />
          <Switch label="Same order only" checked={sameOrder} onChange={(e) => setSameOrder(e.currentTarget.checked)} mb={6} />
          <Button
            size="xs"
            variant="light"
            mb={4}
            disabled={selectable.length === 0}
            onClick={() => setTicked(new Set(selectable.map((row) => row.containerId)))}
          >
            Select all
          </Button>
          {loading ? <Loader size="xs" mb={8} /> : null}
        </Group>

        {listError ? <Alert color="red">{listError}</Alert> : null}
        <ScrollArea.Autosize mah="40vh" type="auto">
          <Table miw={680} verticalSpacing={4} data-copy-candidates>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36} />
                <Table.Th>Ref.</Table.Th>
                <Table.Th>No.</Table.Th>
                <Table.Th>Order</Table.Th>
                <Table.Th>Items</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.containerId} opacity={row.hasThisCharge ? 0.65 : undefined} data-candidate={row.containerRef}>
                  <Table.Td>
                    <Checkbox
                      size="xs"
                      aria-label={`Apply to ${row.containerRef}`}
                      disabled={row.hasThisCharge}
                      checked={!row.hasThisCharge && ticked.has(row.containerId)}
                      onChange={(e) => toggle(row.containerId, e.currentTarget.checked)}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="wrap">
                      <Text fz="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
                        {row.containerRef}
                      </Text>
                      {row.hasThisCharge ? (
                        <Badge size="xs" variant="light" color={row.isSource ? 'blue' : 'gray'}>
                          {row.isSource ? 'this charge' : 'already charged'}
                        </Badge>
                      ) : null}
                    </Group>
                  </Table.Td>
                  <Table.Td>{row.containerNo ?? '—'}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{row.purchaseOrderNumber ?? '—'}</Table.Td>
                  <Table.Td>
                    <Text fz="sm">{row.itemSummary ?? '—'}</Text>
                    <Text fz="xs" c="dimmed">
                      {formatNumber(row.totalAllocatedBase)} pcs
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light" color={containerStatusColour(row.status)}>
                      {containerStatusLabel(row.status)}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
              {!loading && rows.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text fz="sm" c="dimmed" ta="center" py="sm">
                      No container can receive this charge{sameOrder ? ' in this order' : ''}.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : null}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>

        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <NumberInput
            label="Amount per container"
            withAsterisk
            min={0}
            decimalScale={2}
            thousandSeparator=","
            suffix={` ${charge.currencyCode}`}
            value={amount}
            onChange={(next) => setAmount(numberInputValue(next) ?? '')}
          />
          <DateInput label="Charge date" valueFormat="DD/MM/YYYY" value={fromIsoDate(chargeDate)} onChange={(next) => setChargeDate(next ? isoDate(new Date(next)) : null)} />
          <Select
            label="Allocation method"
            data={COPY_METHODS.map((m) => ({ value: m, label: allocationMethodLabel(m) }))}
            value={method}
            onChange={(next) => next && setMethod(next as CopyMethod)}
            allowDeselect={false}
          />
        </SimpleGrid>
        {canPost ? <Checkbox label="Post the copies now" checked={post} onChange={(e) => setPost(e.currentTarget.checked)} /> : null}

        {error ? (
          <Alert color="red" data-copy-error>
            {error}
          </Alert>
        ) : null}
      </Stack>
    </FormModal>
  )
}
