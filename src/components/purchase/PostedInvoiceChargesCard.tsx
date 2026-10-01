import { useCallback, useEffect, useState } from 'react'
import { ActionIcon, Alert, Anchor, Badge, Button, CloseButton, Group, Loader, Paper, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconCheck, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { Link } from 'react-router'
import { ApiError } from '../../api/http'
import { allocationMethodLabel, type ChargeTypeLookupDto } from '../../api/purchase/chargeTypes'
import { LANDED_COST_STATUS_COLOURS, type PurchaseChargeDto } from '../../api/purchase/landedCostAdjustments'
import { lateChargesApi, type LateChargeDto, type LateChargesDto, type LateChargesPostedDto } from '../../api/purchase/lateCharges'
import type { CurrencyLookupDto, PartyLookupDto } from '../../api/types'
import { dateLabel } from '../documents/documentKind'
import { formatNumber } from '../format'
import { confirm } from '../ui/confirm'
import { notify } from '../ui/notify'
import { LateChargeModal } from './LateChargeModal'

/** Where an adjustment is opened on its own page. */
const LANDED_COSTS_ROUTE = '/purchase/landed-cost-adjustments'

const POST_MESSAGE =
  "The cost of this invoice's items will be adjusted: the stock still on hand changes its average cost, what was already sold goes to the cost of goods sold."

interface PostedInvoiceChargesCardProps {
  invoiceId: number
  invoiceDate: string
  /** The invoice's own charges (kind PINV): posted with it, read-only. */
  invoiceCharges: PurchaseChargeDto[]
  chargeTypes: ChargeTypeLookupDto[]
  providers: PartyLookupDto[]
  currencies: CurrencyLookupDto[]
  baseCurrencyCode: string
  canView: boolean
  canAdd: boolean
  canPost: boolean
  /** A late charge was posted: the invoice's landed costs changed, so the page reads it again. */
  onPosted: () => void
}

type Dialog = { kind: 'add' } | { kind: 'edit'; charge: LateChargeDto }

/**
 * The charges of a POSTED local purchase invoice: those posted with it, and the late ones.
 *
 * A LATE CHARGE IS A LANDED COST ADJUSTMENT seen from the invoice. It waits in the invoice's draft
 * adjustment — editable, deletable, costing nothing yet — until "Post late charges" posts that
 * adjustment, which spreads it over the lines: the stock still on hand takes it into its average
 * cost, what was already sold takes it into the cost of goods sold. Posted and cancelled ones stay
 * listed, read-only, with the adjustment that carried them.
 */
export function PostedInvoiceChargesCard({
  invoiceId,
  invoiceDate,
  invoiceCharges,
  chargeTypes,
  providers,
  currencies,
  baseCurrencyCode,
  canView,
  canAdd,
  canPost,
  onPosted,
}: PostedInvoiceChargesCardProps) {
  const [late, setLate] = useState<LateChargesDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [posting, setPosting] = useState(false)
  const [posted, setPosted] = useState<LateChargesPostedDto | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await lateChargesApi.get(invoiceId, signal)
      setLate(result)
      setLoadError(null)
    } catch (err) {
      if (signal?.aborted) return
      setLoadError(err instanceof ApiError ? err.message : 'The late charges could not be loaded.')
    }
  }, [invoiceId])

  useEffect(() => {
    if (!canView) return
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [canView, load])

  const draft = late?.draftAdjustment ?? null
  const draftCharges = draft ? (late?.charges ?? []).filter((c) => c.adjustmentId === draft.id) : []
  const lateCharges = late?.charges ?? []

  async function remove(charge: LateChargeDto) {
    const onlyOne = lateCharges.filter((c) => c.adjustmentId === charge.adjustmentId).length === 1
    const ok = await confirm({
      title: 'Delete late charge',
      message: onlyOne
        ? `Delete ${charge.chargeTypeName} ${formatNumber(charge.amount, 2)} ${charge.currencyCode}? It is the only charge of ${charge.adjustmentNumber}, so the draft adjustment is deleted with it.`
        : `Delete ${charge.chargeTypeName} ${formatNumber(charge.amount, 2)} ${charge.currencyCode} from ${charge.adjustmentNumber}?`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return

    setBusyId(charge.id)
    try {
      setLate(await lateChargesApi.remove(invoiceId, charge.id))
      notify.success('Late charge deleted.')
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The charge could not be deleted.')
      void load()
    } finally {
      setBusyId(null)
    }
  }

  async function postLateCharges() {
    if (!draft) return
    const ok = await confirm({
      title: `Post late charges (${draftCharges.length})`,
      message: POST_MESSAGE,
      confirmLabel: 'Post',
    })
    if (!ok) return

    setPosting(true)
    try {
      const result = await lateChargesApi.post(invoiceId, draft.rowVersion)
      setPosted(result)
      notify.success(`${result.adjustmentNumber} posted: the item costs are adjusted.`)
      onPosted()
    } catch (err) {
      notify.error(err instanceof ApiError ? err.message : 'The late charges could not be posted.')
    } finally {
      setPosting(false)
      void load()
    }
  }

  const rows = invoiceCharges.length + lateCharges.length

  return (
    <Paper radius="lg" p="md" withBorder data-charges-card data-posted-charges>
      <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap">
        <div>
          <Title order={5}>Charges</Title>
          <Text fz="xs" c="dimmed">
            Posted with the invoice, and the late ones. A late charge costs nothing until it is posted.
          </Text>
        </div>
        <Group gap="sm">
          {canPost && draft && draftCharges.length > 0 && (
            <Button
              color="grape"
              leftSection={<IconCheck size={16} />}
              loading={posting}
              onClick={() => void postLateCharges()}
              data-post-late-charges
            >
              Post late charges ({draftCharges.length})
            </Button>
          )}
          {canAdd && (
            <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setDialog({ kind: 'add' })} data-add-charge>
              Add charge
            </Button>
          )}
        </Group>
      </Group>

      <Stack gap="sm">
        {posted && <PostedResult posted={posted} baseCurrencyCode={baseCurrencyCode} onClose={() => setPosted(null)} />}

        {loadError && (
          <Alert color="red" variant="light">
            {loadError}
          </Alert>
        )}

        {canView && late === null && !loadError ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : rows === 0 ? (
          <Text fz="sm" c="dimmed" ta="center" py="md">
            No charge on this invoice yet.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={1150}>
            <Table striped highlightOnHover verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={190}>Entered</Table.Th>
                  <Table.Th>Charge type</Table.Th>
                  <Table.Th>Provider</Table.Th>
                  <Table.Th>Reference</Table.Th>
                  <Table.Th w={100}>Date</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th ta="right">Amount ({baseCurrencyCode})</Table.Th>
                  <Table.Th>Allocation</Table.Th>
                  <Table.Th w={80} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {invoiceCharges.map((c) => (
                  <Table.Tr key={`inv-${c.id}`} data-charge-source="invoice">
                    <Table.Td>
                      <Badge size="sm" variant="light" color="blue">With the invoice</Badge>
                    </Table.Td>
                    <ChargeCells
                      typeLabel={`${c.chargeCode} - ${c.chargeName}`}
                      description={c.description}
                      provider={c.providerName}
                      reference={c.reference}
                      date={invoiceDate}
                      amount={c.amount}
                      currencyCode={c.currencyCode}
                      amountBase={c.amountBase}
                      method={c.allocationMethod}
                      inCost={c.includeInLandedCost}
                    />
                    <Table.Td />
                  </Table.Tr>
                ))}

                {lateCharges.map((c) => (
                  <Table.Tr key={`late-${c.id}`} data-charge-source="late" data-late-status={c.status}>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <Badge size="sm" variant="light" color="grape">Late</Badge>
                        <Badge size="sm" variant="light" color={LANDED_COST_STATUS_COLOURS[c.status]}>{c.status}</Badge>
                      </Group>
                      <Anchor component={Link} to={`${LANDED_COSTS_ROUTE}/${c.adjustmentId}`} fz="xs">
                        {c.adjustmentNumber}
                      </Anchor>
                    </Table.Td>
                    <ChargeCells
                      typeLabel={`${c.chargeTypeCode} - ${c.chargeTypeName}`}
                      description={c.description}
                      provider={c.providerName}
                      reference={c.reference}
                      date={c.chargeDate}
                      amount={c.amount}
                      currencyCode={c.currencyCode}
                      amountBase={c.amountBase}
                      method={c.allocationMethod}
                      inCost={c.includeInLandedCost}
                    />
                    <Table.Td>
                      {c.canEdit && canAdd && (
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Tooltip label="Edit" withArrow>
                            <ActionIcon variant="subtle" onClick={() => setDialog({ kind: 'edit', charge: c })} aria-label="Edit late charge" data-edit-late-charge>
                              <IconPencil size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Delete" withArrow>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              loading={busyId === c.id}
                              onClick={() => void remove(c)}
                              aria-label="Delete late charge"
                              data-delete-late-charge
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        {draft && (
          <Text fz="sm" ta="right" data-draft-total>
            Waiting in draft {draft.number}: <b>{formatNumber(draft.totalBase, 2)} {baseCurrencyCode}</b> to add to the landed cost
          </Text>
        )}
      </Stack>

      {dialog && (
        <LateChargeModal
          invoiceId={invoiceId}
          charge={dialog.kind === 'edit' ? dialog.charge : null}
          chargeTypes={chargeTypes}
          providers={providers}
          currencies={currencies}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setLate(result)
            setDialog(null)
            notify.success(dialog.kind === 'edit' ? 'Late charge saved.' : `Late charge added to ${result.draftAdjustment?.number ?? 'the draft adjustment'}.`)
          }}
        />
      )}
    </Paper>
  )
}

function ChargeCells({
  typeLabel,
  description,
  provider,
  reference,
  date,
  amount,
  currencyCode,
  amountBase,
  method,
  inCost,
}: {
  typeLabel: string
  description: string | null
  provider: string | null
  reference: string | null
  date: string
  amount: number
  currencyCode: string
  amountBase: number
  method: string
  inCost: boolean
}) {
  return (
    <>
      <Table.Td>
        <Text fz="sm" fw={500}>{typeLabel}</Text>
        {description && <Text fz="xs" c="dimmed" lineClamp={1}>{description}</Text>}
        {!inCost && (
          <Tooltip label="Recorded and paid, but it does not make the goods worth more" withArrow>
            <Badge size="xs" variant="light" color="gray">not in cost</Badge>
          </Tooltip>
        )}
      </Table.Td>
      <Table.Td>{provider ?? '—'}</Table.Td>
      <Table.Td>{reference ?? '—'}</Table.Td>
      <Table.Td>{dateLabel(date)}</Table.Td>
      <Table.Td ta="right">{`${formatNumber(amount, 2)} ${currencyCode}`}</Table.Td>
      <Table.Td ta="right" fw={500}>{formatNumber(amountBase, 2)}</Table.Td>
      <Table.Td>{allocationMethodLabel(method)}</Table.Td>
    </>
  )
}

/** What the posting did, line by line: the landed cost per unit before and after, and where the value went. */
function PostedResult({
  posted,
  baseCurrencyCode,
  onClose,
}: {
  posted: LateChargesPostedDto
  baseCurrencyCode: string
  onClose: () => void
}) {
  return (
    <Alert color="teal" variant="light" p="sm" data-late-charges-posted>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Text fw={600} fz="sm">
          {posted.adjustmentNumber} posted: landed cost per unit ({baseCurrencyCode})
        </Text>
        <CloseButton size="sm" onClick={onClose} aria-label="Close the posting result" />
      </Group>
      <Table.ScrollContainer minWidth={560}>
        <Table verticalSpacing={4} withTableBorder bg="var(--mantine-color-body)">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Item</Table.Th>
              <Table.Th>Warehouse</Table.Th>
              <Table.Th ta="right">Before</Table.Th>
              <Table.Th ta="right">After</Table.Th>
              <Table.Th ta="right">To stock</Table.Th>
              <Table.Th ta="right">To COGS</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {posted.lines.map((line) => (
              <Table.Tr key={line.lineNo}>
                <Table.Td>
                  <Text fz="sm" fw={500}>{line.itemCode}</Text>
                  <Text fz="xs" c="dimmed" lineClamp={1}>{line.itemName}</Text>
                </Table.Td>
                <Table.Td>{line.warehouseCode}</Table.Td>
                <Table.Td ta="right">{formatNumber(line.landedCostBefore, 4)}</Table.Td>
                <Table.Td ta="right" fw={600}>{formatNumber(line.landedCostAfter, 4)}</Table.Td>
                <Table.Td ta="right">{formatNumber(line.inventoryPortionBase, 2)}</Table.Td>
                <Table.Td ta="right">{formatNumber(line.cogsPortionBase, 2)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Alert>
  )
}
