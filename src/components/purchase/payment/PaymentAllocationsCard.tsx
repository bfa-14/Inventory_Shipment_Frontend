import { Fragment, useState, type ReactNode } from 'react'
import { ActionIcon, Alert, Anchor, Badge, Button, Checkbox, Group, Loader, NumberInput, Paper, Table, Tabs, Text, Title, Tooltip } from '@mantine/core'
import { IconChevronDown, IconChevronRight, IconWand } from '@tabler/icons-react'
import { Link } from 'react-router'
import type { OpenPayableDocumentDto, PayableKind } from '../../../api/purchase/payments'
import { dateLabel } from '../../documents/documentKind'
import { formatNumber, numberInputValue } from '../../format'
import { paymentStatusColour, paymentStatusLabel } from '../../sales/paymentStatus'
import {
  containerKey,
  containerStatusColour,
  containersTotal,
  distributeOverContainers,
  docKey,
  entryFor,
  fillOldestFirst,
  isBalanced,
  needsSplit,
  toPayment,
  type AllocationEntry,
} from './paymentModel'

interface PaymentAllocationsCardProps {
  /** Which table: purchase invoices or container charges. The other tab is shown but cannot be opened. */
  kind: PayableKind
  title?: string
  intro?: string
  documents: OpenPayableDocumentDto[]
  loading: boolean
  hasPayee: boolean
  /** docKey → amount typed (in the DOCUMENT's currency) and its multiplier to the payment currency. */
  entries: Record<string, AllocationEntry>
  onChange: (key: string, entry: AllocationEntry | null) => void
  onFill: (entries: Record<string, AllocationEntry>) => void
  /** What the allocations must come to, in the payment currency: the amount, or a Free Payment's advance. */
  target: number
  paymentCurrencyId: string | null
  paymentCurrencyCode: string
  /** Allocating only part (a posted Free Payment's advance): being short is then information, not an error. */
  partialOk?: boolean
  action?: ReactNode
}

/**
 * 3 - Allocation to Documents: the payee's unpaid documents, and how much of this payment goes to each.
 *
 * ONLY ONE KIND PER PAYMENT. A Purchase Invoice Payment lists purchase invoices, a Container Charge
 * Payment lists container charges, and fully paid documents never appear (the server does not send them).
 *
 * THE AMOUNT IS TYPED IN THE DOCUMENT'S OWN CURRENCY ("settle PI-2026-0015, 25,000 USD"); a document in
 * another currency than the payment's also shows the rate and the value in the payment currency, which is
 * what the Total row and the balance use.
 */
export function PaymentAllocationsCard({
  kind,
  title = '3 · Allocation to Documents',
  intro = 'Select and allocate this payment to unpaid or partially paid documents.',
  documents,
  loading,
  hasPayee,
  entries,
  onChange,
  onFill,
  target,
  paymentCurrencyId,
  paymentCurrencyCode,
  partialOk = false,
  action,
}: PaymentAllocationsCardProps) {
  const isInvoice = kind === 'PINV'
  /** Which invoices show their containers: what the reader opened or closed, else open once allocated. */
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const anyForeign = documents.some((d) => String(d.currencyId) !== paymentCurrencyId)
  const rateOf = (doc: OpenPayableDocumentDto, entry?: AllocationEntry) =>
    String(doc.currencyId) === paymentCurrencyId ? 1 : (entry?.rateToPayment ?? doc.defaultRateToPayment)

  const allocated = documents.reduce((sum, doc) => {
    const entry = entries[docKey(doc.documentKind, doc.documentId)]
    return sum + toPayment(entry?.amount ?? null, rateOf(doc, entry))
  }, 0)
  const sameCurrency = documents.length > 0 && documents.every((d) => d.currencyId === documents[0].currencyId)
  const sum = (pick: (d: OpenPayableDocumentDto) => number) => documents.reduce((s, d) => s + pick(d), 0)
  const difference = target - allocated
  const balanced = isBalanced(target, allocated)
  const columns = (isInvoice ? 9 : 10) + (anyForeign ? 2 : 0)

  function toggle(doc: OpenPayableDocumentDto, checked: boolean) {
    const key = docKey(doc.documentKind, doc.documentId)
    if (!checked) {
      onChange(key, null)
      return
    }
    // Ticking a row offers what it owes, up to what is still left to allocate.
    const rate = rateOf(doc)
    const left = Math.max(0, target - allocated)
    const owed = toPayment(doc.outstandingAmount, rate)
    const amount = rate && rate > 0 && left < owed ? Math.round((left / rate) * 10 ** doc.decimalPlaces) / 10 ** doc.decimalPlaces : doc.outstandingAmount
    onChange(key, entryFor(doc, amount > 0 ? amount : doc.outstandingAmount, rate))
  }

  /* A CONTAINER AMOUNT DECIDES THE INVOICE AMOUNT: the invoice is always the sum of its containers. */
  function setContainer(doc: OpenPayableDocumentDto, entry: AllocationEntry | undefined, cKey: string, value: number | null) {
    const containers = { ...(entry?.containers ?? {}), [cKey]: value }
    const total = containersTotal(containers, doc.decimalPlaces)
    onChange(docKey(doc.documentKind, doc.documentId), { amount: total > 0 ? total : null, rateToPayment: entry?.rateToPayment ?? rateOf(doc), containers })
  }

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" mb={4} wrap="wrap">
        <Title order={5}>{title}</Title>
        <Group gap="xs">
          {documents.length > 0 && (
            <Tooltip label="Spread the amount over the oldest documents first" withArrow>
              <Button variant="default" leftSection={<IconWand size={16} />} onClick={() => onFill(fillOldestFirst(documents, target, (d) => rateOf(d)))}>
                Allocate oldest first
              </Button>
            </Tooltip>
          )}
          {action}
        </Group>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">{intro}</Text>

      <Tabs value={kind} mb="sm">
        <Tabs.List>
          <Tabs.Tab value="PINV" disabled={kind !== 'PINV'}>Purchase Invoice Allocation</Tabs.Tab>
          <Tabs.Tab value="CHARGE" disabled={kind !== 'CHARGE'}>Container Charge Allocation</Tabs.Tab>
        </Tabs.List>
      </Tabs>

      {!hasPayee ? (
        <Text size="sm" c="dimmed">Choose the payee to see what they are owed.</Text>
      ) : loading ? (
        <Group justify="center" py="md"><Loader size="sm" /></Group>
      ) : documents.length === 0 ? (
        <Text size="sm" c="dimmed">
          {isInvoice ? 'This payee has no unpaid or partially paid posted purchase invoices.' : 'This payee has no unpaid or partially paid posted container charges.'}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={anyForeign ? 1250 : 1000}>
          <Table striped highlightOnHover verticalSpacing="xs" withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40}>
                  <Checkbox
                    aria-label="Select all"
                    checked={documents.every((d) => entries[docKey(d.documentKind, d.documentId)]?.amount)}
                    indeterminate={documents.some((d) => entries[docKey(d.documentKind, d.documentId)]?.amount) && !documents.every((d) => entries[docKey(d.documentKind, d.documentId)]?.amount)}
                    onChange={(event) => {
                      if (event.currentTarget.checked) onFill(fillOldestFirst(documents, target, (d) => rateOf(d)))
                      else onFill({})
                    }}
                  />
                </Table.Th>
                <Table.Th w={36}>#</Table.Th>
                <Table.Th>{isInvoice ? 'PI No.' : 'Charge No.'}</Table.Th>
                <Table.Th w={110}>{isInvoice ? 'PI Date' : 'Charge Date'}</Table.Th>
                <Table.Th>Container Ref.</Table.Th>
                {!isInvoice && <Table.Th>Charge Type</Table.Th>}
                <Table.Th w={80}>Currency</Table.Th>
                <Table.Th w={130} ta="right">{isInvoice ? 'Invoice Total' : 'Document Amount'}</Table.Th>
                <Table.Th w={130} ta="right">Previously Paid</Table.Th>
                <Table.Th w={130} ta="right">Outstanding</Table.Th>
                <Table.Th w={160} ta="right">Allocate Amount</Table.Th>
                {anyForeign && <Table.Th w={130} ta="right">Rate to {paymentCurrencyCode}</Table.Th>}
                {anyForeign && <Table.Th w={130} ta="right">In {paymentCurrencyCode}</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {documents.map((doc, index) => {
                const key = docKey(doc.documentKind, doc.documentId)
                const entry = entries[key]
                const typed = entry?.amount ?? null
                const over = typed !== null && typed > doc.outstandingAmount + 0.005
                const foreign = String(doc.currencyId) !== paymentCurrencyId
                const rate = rateOf(doc, entry)
                const hasContainers = isInvoice && needsSplit(doc)
                const isOpen = hasContainers && (open[key] ?? (typed !== null && typed > 0))
                const split = containersTotal(entry?.containers, doc.decimalPlaces)
                const splitOff = hasContainers && typed !== null && typed > 0 && Math.abs(split - typed) > 0.005
                return (
                  <Fragment key={key}>
                  <Table.Tr>
                    <Table.Td>
                      <Checkbox aria-label={`Select ${doc.documentNumber}`} checked={typed !== null && typed > 0} onChange={(event) => toggle(doc, event.currentTarget.checked)} />
                    </Table.Td>
                    <Table.Td>{index + 1}</Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        {hasContainers && (
                          <Tooltip label={isOpen ? 'Hide the containers' : 'Show the containers and allocate by container'} withArrow>
                            <ActionIcon variant="light" size="sm" aria-label={`Containers of ${doc.documentNumber}`} onClick={() => setOpen((c) => ({ ...c, [key]: !isOpen }))}>
                              {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {isInvoice ? (
                          <Anchor component={Link} to={`/purchase/invoices/${doc.documentId}`} size="sm" fw={500} target="_blank">{doc.documentNumber}</Anchor>
                        ) : (
                          <Tooltip label={doc.documentReference ? `Provider reference ${doc.documentReference}` : 'No provider reference'} withArrow>
                            <Text size="sm" fw={500}>{doc.documentNumber}</Text>
                          </Tooltip>
                        )}
                        <Badge size="xs" variant="light" color={paymentStatusColour(doc.paymentStatus)}>{paymentStatusLabel(doc.paymentStatus)}</Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td>{dateLabel(doc.documentDate)}</Table.Td>
                    <Table.Td>{doc.containerRef ?? '–'}</Table.Td>
                    {!isInvoice && <Table.Td>{doc.chargeTypeName ?? '–'}</Table.Td>}
                    <Table.Td>{doc.currencyCode}</Table.Td>
                    <Table.Td ta="right">{formatNumber(doc.documentTotal, doc.decimalPlaces)}</Table.Td>
                    <Table.Td ta="right">
                      {formatNumber(doc.previouslyPaid, doc.decimalPlaces)}
                      {doc.returnedAmount > 0 && <Text size="xs" c="dimmed">returned {formatNumber(doc.returnedAmount, doc.decimalPlaces)}</Text>}
                    </Table.Td>
                    <Table.Td ta="right">{formatNumber(doc.outstandingAmount, doc.decimalPlaces)}</Table.Td>
                    <Table.Td>
                      <NumberInput
                        aria-label={`Amount to allocate to ${doc.documentNumber}`}
                        min={0}
                        decimalScale={doc.decimalPlaces}
                        thousandSeparator=","
                        hideControls
                        value={typed ?? ''}
                        onChange={(next) => {
                          const amount = numberInputValue(next)
                          onChange(key, amount === null ? null : entryFor(doc, amount, entry?.rateToPayment ?? rate))
                        }}
                        error={over ? 'More than outstanding' : splitOff ? 'Not equal to the containers' : undefined}
                        styles={{ input: { textAlign: 'right' } }}
                      />
                    </Table.Td>
                    {anyForeign && (
                      <Table.Td>
                        {foreign ? (
                          <NumberInput
                            aria-label={`Rate for ${doc.documentNumber}`}
                            min={0}
                            decimalScale={10}
                            hideControls
                            value={rate ?? ''}
                            onChange={(next) => onChange(key, { ...entry, amount: typed, rateToPayment: numberInputValue(next) })}
                            error={rate === null ? 'No rate' : undefined}
                            styles={{ input: { textAlign: 'right' } }}
                          />
                        ) : (
                          <Text size="sm" ta="right">1</Text>
                        )}
                      </Table.Td>
                    )}
                    {anyForeign && <Table.Td ta="right">{formatNumber(toPayment(typed, rate), 2)}</Table.Td>}
                  </Table.Tr>
                  {isOpen && (
                    <Table.Tr>
                      <Table.Td colSpan={(isInvoice ? 10 : 11) + (anyForeign ? 2 : 0)} p="xs" style={{ background: 'var(--mantine-color-gray-0)' }}>
                        <Group justify="space-between" mb={6} wrap="wrap">
                          <Text size="sm" fw={600}>Containers under {doc.documentNumber}</Text>
                          <Group gap="xs">
                            <Text size="xs" c="dimmed">The invoice amount is split over its containers; it must add up to the amount allocated.</Text>
                            <Tooltip label="Spread the invoice amount over the containers in order, each up to what it still owes" withArrow>
                              <Button size="xs" variant="default" leftSection={<IconWand size={14} />} disabled={typed === null || typed <= 0}
                                onClick={() => onChange(key, { amount: typed, rateToPayment: entry?.rateToPayment ?? rate, containers: distributeOverContainers(doc.containers, typed, doc.decimalPlaces) })}>
                                Distribute
                              </Button>
                            </Tooltip>
                          </Group>
                        </Group>
                        <Table verticalSpacing={4} withTableBorder fz="sm">
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th w={36} />
                              <Table.Th>Container Ref.</Table.Th>
                              <Table.Th>Container No.</Table.Th>
                              <Table.Th>Items</Table.Th>
                              <Table.Th ta="right">Container PI Amount</Table.Th>
                              <Table.Th ta="right">Previously Paid</Table.Th>
                              <Table.Th ta="right">Outstanding</Table.Th>
                              <Table.Th w={160} ta="right">Allocate Amount</Table.Th>
                              <Table.Th w={130}>Payment Status</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {doc.containers.map((c) => {
                              const cKey = containerKey(c)
                              const value = entry?.containers?.[cKey] ?? null
                              const cOver = value !== null && value > c.outstandingAmount + 0.005
                              return (
                                <Table.Tr key={cKey}>
                                  <Table.Td>
                                    <Checkbox aria-label={`Select ${c.containerRef}`} checked={value !== null && value > 0} disabled={c.outstandingAmount <= 0}
                                      onChange={(event) => setContainer(doc, entry, cKey, event.currentTarget.checked ? c.outstandingAmount : null)} />
                                  </Table.Td>
                                  <Table.Td>
                                    {c.containerId === null ? (
                                      <Text size="sm" fw={500} fs="italic">Unlinked items</Text>
                                    ) : (
                                      <Anchor component={Link} to={`/logistics/containers/${c.containerId}`} size="sm" fw={500} target="_blank">{c.containerRef}</Anchor>
                                    )}
                                  </Table.Td>
                                  <Table.Td>{c.containerNo ?? '–'}</Table.Td>
                                  <Table.Td><Text size="xs" c={c.containerId === null ? undefined : 'dimmed'}>{c.items ?? '–'}</Text></Table.Td>
                                  <Table.Td ta="right">{formatNumber(c.containerAmount, doc.decimalPlaces)}</Table.Td>
                                  <Table.Td ta="right">{formatNumber(c.previouslyPaid, doc.decimalPlaces)}</Table.Td>
                                  <Table.Td ta="right">{formatNumber(c.outstandingAmount, doc.decimalPlaces)}</Table.Td>
                                  <Table.Td>
                                    <NumberInput
                                      size="xs"
                                      aria-label={`Amount to allocate to ${c.containerRef} of ${doc.documentNumber}`}
                                      min={0}
                                      decimalScale={doc.decimalPlaces}
                                      thousandSeparator=","
                                      hideControls
                                      value={value ?? ''}
                                      onChange={(next) => setContainer(doc, entry, cKey, numberInputValue(next))}
                                      error={cOver ? 'More than outstanding' : undefined}
                                      styles={{ input: { textAlign: 'right' } }}
                                    />
                                  </Table.Td>
                                  <Table.Td><Badge size="sm" variant="light" color={containerStatusColour(c.paymentStatus)}>{c.paymentStatus}</Badge></Table.Td>
                                </Table.Tr>
                              )
                            })}
                          </Table.Tbody>
                          <Table.Tfoot>
                            <Table.Tr>
                              <Table.Th />
                              <Table.Th colSpan={3}>Total ({doc.documentNumber})</Table.Th>
                              <Table.Th ta="right">{formatNumber(doc.containers.reduce((s, c) => s + c.containerAmount, 0), doc.decimalPlaces)}</Table.Th>
                              <Table.Th ta="right">{formatNumber(doc.containers.reduce((s, c) => s + c.previouslyPaid, 0), doc.decimalPlaces)}</Table.Th>
                              <Table.Th ta="right">{formatNumber(doc.containers.reduce((s, c) => s + c.outstandingAmount, 0), doc.decimalPlaces)}</Table.Th>
                              <Table.Th ta="right" c={splitOff ? 'red' : undefined}>{formatNumber(split, doc.decimalPlaces)}</Table.Th>
                              <Table.Th />
                            </Table.Tr>
                          </Table.Tfoot>
                        </Table>
                      </Table.Td>
                    </Table.Tr>
                  )}
                  </Fragment>
                )
              })}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr style={{ background: 'var(--mantine-color-blue-light)' }}>
                <Table.Th />
                <Table.Th />
                <Table.Th>Total</Table.Th>
                <Table.Th colSpan={isInvoice ? 3 : 4}>–</Table.Th>
                {/* The document columns add up only when they share one currency; the allocation total is in the payment currency. */}
                <Table.Th ta="right">{sameCurrency ? formatNumber(sum((d) => d.documentTotal), documents[0].decimalPlaces) : '–'}</Table.Th>
                <Table.Th ta="right">{sameCurrency ? formatNumber(sum((d) => d.previouslyPaid), documents[0].decimalPlaces) : '–'}</Table.Th>
                <Table.Th ta="right">{sameCurrency ? formatNumber(sum((d) => d.outstandingAmount), documents[0].decimalPlaces) : '–'}</Table.Th>
                <Table.Th ta="right">{anyForeign ? '–' : formatNumber(allocated, 2)}</Table.Th>
                {anyForeign && <Table.Th />}
                {anyForeign && <Table.Th ta="right">{formatNumber(allocated, 2)}</Table.Th>}
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      )}

      {hasPayee && !loading && documents.length > 0 && !balanced && (
        partialOk && difference > 0 ? (
          <Alert mt="sm" color="blue" title="Part of the advance stays unapplied">
            {formatNumber(target, 2)} {paymentCurrencyCode} available, {formatNumber(allocated, 2)} allocated: {formatNumber(difference, 2)} {paymentCurrencyCode} will remain unapplied.
          </Alert>
        ) : (
          <Alert mt="sm" color="red" title="Unbalanced Allocation — Total allocated amount must equal the Payment Amount.">
            {formatNumber(target, 2)} {paymentCurrencyCode} to allocate, {formatNumber(allocated, 2)} allocated: {difference > 0 ? 'still to allocate' : 'over-allocated by'}{' '}
            {formatNumber(Math.abs(difference), 2)} {paymentCurrencyCode}.{columns > 0 && !partialOk ? ' The draft can be saved; it cannot be posted until they match.' : ''}
          </Alert>
        )
      )}
    </Paper>
  )
}
