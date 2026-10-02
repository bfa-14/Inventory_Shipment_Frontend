import { Fragment } from 'react'
import { ActionIcon, Alert, Badge, Button, Checkbox, Group, NumberInput, Paper, Select, Table, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconPlus, IconTrash } from '@tabler/icons-react'
import { allocationMethodLabel, CHARGE_ALLOCATION_METHODS, METHODS_NEEDING_ITEM_DATA, type ChargeAllocationMethod, type ChargeTypeLookupDto } from '../../api/purchase/chargeTypes'
import type { CurrencyLookupDto, PartyLookupDto } from '../../api/types'
import { formatNumber, numberInputValue } from '../format'
import { currencyLabel, supplierLabel } from './purchaseKind'
import {
  amountBase,
  chargeTotals,
  isUnallocated,
  remainingToAllocate,
  withChargeType,
  type AllocationTarget,
  type ChargeLine,
} from './purchaseCharges'

interface PurchaseChargesGridProps {
  lines: ChargeLine[]
  onChange: (key: string, patch: Partial<ChargeLine>) => void
  onRemove: (key: string) => void
  onAdd: () => void
  chargeTypes: ChargeTypeLookupDto[]
  providers: PartyLookupDto[]
  currencies: CurrencyLookupDto[]
  /** The invoice lines a manual split is spread over. */
  targets: AllocationTarget[]
  /** The base currency's code, for the "Amount (USD)" column caption. */
  baseCurrencyCode: string
  /** A rate the page looked up for a currency on the document date, so a new row starts right. */
  onCurrencyChosen?: (key: string, currencyId: number) => void
  readOnly: boolean
}

/**
 * The charges of a purchase invoice or a landed cost adjustment.
 *
 * EVERY CHARGE IS TWO NUMBERS: what was billed, in the currency it was billed in, and what that is
 * worth in the base currency — which is the only one the goods can be costed in. The second is
 * derived and read-only; a reader who disagrees with it changes the rate, not the result.
 *
 * A CHARGE THAT IS NOT IN THE LANDED COST IS GREYED and badged, because it still has to be recorded
 * and paid — it simply does not make the goods worth more. Hiding it would lose the bill.
 *
 * MANUAL ALLOCATION OPENS A SECOND GRID under the row: one line per invoice line, and a running
 * "remaining" that must reach zero. The server refuses a split that does not add up, so the count
 * here is a courtesy that saves a round trip, not the rule.
 */
export function PurchaseChargesGrid({
  lines,
  onChange,
  onRemove,
  onAdd,
  chargeTypes,
  providers,
  currencies,
  targets,
  baseCurrencyCode,
  onCurrencyChosen,
  readOnly,
}: PurchaseChargesGridProps) {
  const typeOptions = chargeTypes.map((t) => ({ value: String(t.id), label: `${t.chargeCode} - ${t.chargeName}` }))
  const totals = chargeTotals(lines)

  return (
    <Paper radius="lg" p="md" withBorder data-charges-card>
      <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap">
        <div>
          <Title order={5}>Charges</Title>
          <Text fz="xs" c="dimmed">
            Freight, customs, clearing. Amounts in any currency; the goods are costed in {baseCurrencyCode}.
          </Text>
        </div>
        {!readOnly && (
          <Button variant="default" leftSection={<IconPlus size={16} />} onClick={onAdd} data-add-charge>
            Add charge
          </Button>
        )}
      </Group>

      <Table.ScrollContainer minWidth={readOnly ? 1100 : 1500}>
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={50}>#</Table.Th>
              <Table.Th w={210}>Charge Type</Table.Th>
              <Table.Th w={170}>Description</Table.Th>
              <Table.Th w={180}>Provider</Table.Th>
              <Table.Th w={130}>Reference</Table.Th>
              <Table.Th w={130}>Currency</Table.Th>
              <Table.Th w={120} ta="right">Rate</Table.Th>
              <Table.Th w={130} ta="right">Amount</Table.Th>
              <Table.Th w={130} ta="right">Amount ({baseCurrencyCode})</Table.Th>
              <Table.Th w={170}>Allocation</Table.Th>
              <Table.Th w={110} ta="center">Billed by supplier</Table.Th>
              <Table.Th w={150}>Notes</Table.Th>
              {!readOnly && <Table.Th w={52} />}
            </Table.Tr>
          </Table.Thead>

          <Table.Tbody>
            {lines.map((line, index) => {
              const base = amountBase(line)
              const unallocated = isUnallocated(line)
              const problem = line.error ?? (unallocated ? `Still to allocate: ${formatNumber(remainingToAllocate(line), 2)} ${baseCurrencyCode}` : undefined)
              const notInCost = !line.includeInLandedCost
              const methodHint = METHODS_NEEDING_ITEM_DATA[line.allocationMethod]
              const columns = readOnly ? 12 : 13

              return (
                // The fragment carries the key: React keys the pair of rows, not each row.
                <Fragment key={line.key}>
                  <Table.Tr
                    bg={problem ? 'var(--mantine-color-red-0)' : undefined}
                    opacity={notInCost && !problem ? 0.65 : undefined}
                    data-charge-row={line.key}
                  >
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        {index + 1}
                        {problem && (
                          <Tooltip label={problem} multiline w={300} withArrow>
                            <IconAlertTriangle size={15} color="var(--mantine-color-red-6)" />
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>

                    <Table.Td>
                      {readOnly ? (
                        <div>
                          <Text fz="sm" fw={500}>{line.chargeCode}</Text>
                          <Text fz="xs" c="dimmed">{line.chargeName}</Text>
                        </div>
                      ) : (
                        <Select
                          data={typeOptions}
                          value={line.chargeTypeId === null ? null : String(line.chargeTypeId)}
                          placeholder="Choose a charge"
                          searchable
                          onChange={(next) => {
                            const type = chargeTypes.find((t) => String(t.id) === next)
                            if (type) onChange(line.key, withChargeType(line, type))
                          }}
                          error={Boolean(line.error)}
                          comboboxProps={{ withinPortal: true }}
                          aria-label={`Charge type of charge ${index + 1}`}
                        />
                      )}
                      {notInCost && (
                        <Tooltip label="Recorded and paid, but it does not make the goods worth more" withArrow>
                          <Badge size="xs" variant="light" color="gray" mt={4}>not in cost</Badge>
                        </Tooltip>
                      )}
                    </Table.Td>

                    <Table.Td>
                      {readOnly ? (
                        <Text fz="sm" c="dimmed">{line.description || '—'}</Text>
                      ) : (
                        <TextInput
                          value={line.description}
                          placeholder="Optional"
                          maxLength={200}
                          onChange={(event) => onChange(line.key, { description: event.currentTarget.value })}
                          aria-label={`Description of charge ${index + 1}`}
                        />
                      )}
                    </Table.Td>

                    <Table.Td>
                      {readOnly ? (
                        <Text fz="sm">{providers.find((p) => String(p.id) === line.providerPartyId)?.partyName ?? '—'}</Text>
                      ) : (
                        <Select
                          data={providers.map((p) => ({ value: String(p.id), label: supplierLabel(p) }))}
                          value={line.providerPartyId}
                          placeholder="Who billed it"
                          searchable
                          clearable
                          onChange={(next) => onChange(line.key, { providerPartyId: next })}
                          comboboxProps={{ withinPortal: true }}
                          aria-label={`Provider of charge ${index + 1}`}
                        />
                      )}
                    </Table.Td>

                    <Table.Td>
                      {readOnly ? (
                        <Text fz="sm" c="dimmed">{line.reference || '—'}</Text>
                      ) : (
                        <TextInput
                          value={line.reference}
                          placeholder="Their invoice no."
                          maxLength={100}
                          onChange={(event) => onChange(line.key, { reference: event.currentTarget.value })}
                          aria-label={`Reference of charge ${index + 1}`}
                        />
                      )}
                    </Table.Td>

                    <Table.Td>
                      {readOnly ? (
                        <Text fz="sm">{currencies.find((c) => String(c.id) === line.currencyId)?.currencyCode ?? '—'}</Text>
                      ) : (
                        <Select
                          data={currencies.map((c) => ({ value: String(c.id), label: currencyLabel(c) }))}
                          value={line.currencyId}
                          onChange={(next) => {
                            onChange(line.key, { currencyId: next })
                            if (next) onCurrencyChosen?.(line.key, Number(next))
                          }}
                          allowDeselect={false}
                          searchable
                          comboboxProps={{ withinPortal: true }}
                          aria-label={`Currency of charge ${index + 1}`}
                        />
                      )}
                    </Table.Td>

                    <Table.Td>
                      {readOnly ? (
                        <Text fz="sm" ta="right">{formatNumber(line.exchangeRate, 6)}</Text>
                      ) : (
                        <NumberInput
                          value={line.exchangeRate ?? ''}
                          min={0}
                          decimalScale={6}
                          thousandSeparator=","
                          placeholder="Rate"
                          onChange={(next) => {
                            const parsed = numberInputValue(next)
                            onChange(line.key, { exchangeRate: parsed !== null && parsed > 0 ? parsed : null })
                          }}
                          aria-label={`Exchange rate of charge ${index + 1}`}
                        />
                      )}
                    </Table.Td>

                    <Table.Td>
                      {readOnly ? (
                        <Text fz="sm" ta="right">{formatNumber(line.amount, 2)}</Text>
                      ) : (
                        <NumberInput
                          value={line.amount ?? ''}
                          min={0}
                          decimalScale={2}
                          fixedDecimalScale
                          thousandSeparator=","
                          placeholder="0.00"
                          onChange={(next) => onChange(line.key, { amount: numberInputValue(next) })}
                          error={Boolean(line.error)}
                          aria-label={`Amount of charge ${index + 1}`}
                          data-charge-amount={line.key}
                        />
                      )}
                    </Table.Td>

                    <Table.Td ta="right">
                      <Text fz="sm" fw={500} c={base === null ? 'dimmed' : undefined}>
                        {base === null ? '—' : formatNumber(base, 2)}
                      </Text>
                    </Table.Td>

                    <Table.Td>
                      {readOnly ? (
                        <Text fz="sm">{allocationMethodLabel(line.allocationMethod)}</Text>
                      ) : (
                        <Select
                          data={CHARGE_ALLOCATION_METHODS.map((m) => ({ value: m, label: allocationMethodLabel(m) }))}
                          value={line.allocationMethod}
                          onChange={(next) => next && onChange(line.key, { allocationMethod: next as ChargeAllocationMethod })}
                          allowDeselect={false}
                          comboboxProps={{ withinPortal: true }}
                          description={methodHint}
                          aria-label={`Allocation method of charge ${index + 1}`}
                        />
                      )}
                    </Table.Td>

                    <Table.Td ta="center">
                      {readOnly ? (
                        <Text fz="sm">{line.includedInSupplierInvoice ? 'Yes' : 'No'}</Text>
                      ) : (
                        <Tooltip label="The supplier billed it on the same invoice — there is no separate payment to make" withArrow>
                          <Checkbox
                            checked={line.includedInSupplierInvoice}
                            onChange={(event) => onChange(line.key, { includedInSupplierInvoice: event.currentTarget.checked })}
                            aria-label={`Charge ${index + 1} is included in the supplier invoice`}
                          />
                        </Tooltip>
                      )}
                    </Table.Td>

                    <Table.Td>
                      {readOnly ? (
                        <Text fz="sm" c="dimmed">{line.notes || '—'}</Text>
                      ) : (
                        <TextInput
                          value={line.notes}
                          placeholder="Optional"
                          maxLength={300}
                          onChange={(event) => onChange(line.key, { notes: event.currentTarget.value })}
                          aria-label={`Notes of charge ${index + 1}`}
                        />
                      )}
                    </Table.Td>

                    {!readOnly && (
                      <Table.Td>
                        <Tooltip label="Remove charge" withArrow>
                          <ActionIcon variant="subtle" color="red" onClick={() => onRemove(line.key)} aria-label={`Remove charge ${index + 1}`}>
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    )}
                  </Table.Tr>

                  {line.allocationMethod === 'Manual' && line.includeInLandedCost && (
                    <Table.Tr bg="var(--mantine-color-gray-0)">
                      <Table.Td colSpan={columns}>
                        <ManualAllocationPanel
                          line={line}
                          targets={targets}
                          baseCurrencyCode={baseCurrencyCode}
                          readOnly={readOnly}
                          onChange={onChange}
                        />
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Fragment>
              )
            })}

            {lines.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={readOnly ? 12 : 13}>
                  <Text ta="center" c="dimmed" py="lg">
                    {readOnly ? 'No charges on this document.' : 'No charges yet. Add the freight, customs and clearing bills here.'}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Group justify="flex-end" gap="xl" mt="md" data-charge-totals>
        <div>
          <Text fz="xs" c="dimmed">Total charges ({baseCurrencyCode})</Text>
          <Text fw={700}>{formatNumber(totals.total, 2)}</Text>
        </div>
        <div>
          <Text fz="xs" c="dimmed">of which landed</Text>
          <Text fw={700} c={totals.landed === totals.total ? undefined : 'blue'}>{formatNumber(totals.landed, 2)}</Text>
        </div>
      </Group>
    </Paper>
  )
}

/**
 * The manual split of one charge: one row per invoice line, and what is left to place.
 *
 * IT REFUSES TO BE FINISHED UNTIL "REMAINING" IS ZERO, because a manual allocation that does not
 * add up is not an opinion the server will accept — it answers "Charge N: manual allocations (250)
 * must equal the charge amount (300)". Saying so here saves the round trip.
 */
function ManualAllocationPanel({
  line,
  targets,
  baseCurrencyCode,
  readOnly,
  onChange,
}: {
  line: ChargeLine
  targets: AllocationTarget[]
  baseCurrencyCode: string
  readOnly: boolean
  onChange: (key: string, patch: Partial<ChargeLine>) => void
}) {
  const remaining = remainingToAllocate(line)
  const total = amountBase(line) ?? 0
  const settled = Math.abs(remaining) <= 0.01

  function setAllocation(lineId: number, value: number | null) {
    const next = { ...line.allocations }
    if (value === null || value === 0) delete next[lineId]
    else next[lineId] = value
    onChange(line.key, { allocations: next, error: undefined })
  }

  /** Spreads what is left over the lines by base quantity — the usual intent behind a manual split. */
  function spreadEvenly() {
    const totalQuantity = targets.reduce((sum, t) => sum + t.quantityBase, 0)
    if (totalQuantity <= 0 || total <= 0) return

    const next: Record<number, number> = {}
    let placed = 0
    targets.forEach((target, index) => {
      const share = index === targets.length - 1
        ? Math.round((total - placed + Number.EPSILON) * 100) / 100
        : Math.round((total * target.quantityBase / totalQuantity + Number.EPSILON) * 100) / 100
      next[target.id] = share
      placed = Math.round((placed + share + Number.EPSILON) * 100) / 100
    })
    onChange(line.key, { allocations: next, error: undefined })
  }

  return (
    <div data-allocation-panel={line.key}>
      <Group justify="space-between" align="center" mb="xs" wrap="wrap">
        <Text fz="sm" fw={500}>
          Manual allocation of {line.chargeCode || 'this charge'} — {formatNumber(total, 2)} {baseCurrencyCode}
        </Text>
        <Group gap="sm">
          {!readOnly && targets.length > 0 && (
            <Button size="compact-sm" variant="subtle" onClick={spreadEvenly}>
              Spread by quantity
            </Button>
          )}
          <Badge color={settled ? 'teal' : 'red'} variant="light" data-allocation-remaining>
            {settled ? 'Fully allocated' : `Remaining ${formatNumber(remaining, 2)} ${baseCurrencyCode}`}
          </Badge>
        </Group>
      </Group>

      {targets.length === 0 ? (
        <Alert color="yellow" variant="light">
          The invoice has no lines to allocate over yet. Add the lines first, or choose another allocation method.
        </Alert>
      ) : (
        <Table verticalSpacing={4} withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={50}>#</Table.Th>
              <Table.Th>Item</Table.Th>
              <Table.Th w={110} ta="right">Qty (base)</Table.Th>
              <Table.Th w={180} ta="right">Amount ({baseCurrencyCode})</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {targets.map((target) => (
              <Table.Tr key={target.id}>
                <Table.Td>{target.lineNo}</Table.Td>
                <Table.Td>
                  <Text fz="sm" fw={500}>{target.itemCode}</Text>
                  <Text fz="xs" c="dimmed" lineClamp={1}>{target.itemName}</Text>
                </Table.Td>
                <Table.Td ta="right">{formatNumber(target.quantityBase)}</Table.Td>
                <Table.Td>
                  {readOnly ? (
                    <Text fz="sm" ta="right">{formatNumber(line.allocations[target.id] ?? 0, 2)}</Text>
                  ) : (
                    <NumberInput
                      value={line.allocations[target.id] ?? ''}
                      min={0}
                      decimalScale={2}
                      fixedDecimalScale
                      thousandSeparator=","
                      placeholder="0.00"
                      onChange={(next) => setAllocation(target.id, numberInputValue(next))}
                      aria-label={`Allocation to line ${target.lineNo}`}
                      data-allocation-input={`${line.key}-${target.id}`}
                    />
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </div>
  )
}
