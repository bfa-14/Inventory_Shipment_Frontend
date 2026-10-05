import { ActionIcon, Alert, Badge, Button, Group, NumberInput, Paper, Select, Table, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import type { CashBankAccountLookupDto } from '../../../api/masterdata/cashBankAccounts'
import type { PaymentMethodLookupDto } from '../../../api/masterdata/paymentMethods'
import { CLEARANCE_STATUSES, type PaymentLineDto } from '../../../api/purchase/payments'
import type { CurrencyLookupDto } from '../../../api/types'
import { fromIsoDate, isoDate } from '../../documents/documentKind'
import { formatNumber, numberInputValue } from '../../format'
import { isBalanced, toPayment, type PaymentLineForm } from './paymentModel'

interface PaymentLinesCardProps {
  lines: PaymentLineForm[]
  onChange: (key: string, patch: Partial<PaymentLineForm>) => void
  /** A currency was chosen on a row: the page fetches its rate and clears an account of another currency. */
  onCurrencyChosen: (key: string, currencyId: string | null) => void
  onAdd: () => void
  onRemove: (key: string) => void
  methods: PaymentMethodLookupDto[]
  accounts: CashBankAccountLookupDto[]
  currencies: CurrencyLookupDto[]
  /** Accounts of other branches are not offered; an account with no branch belongs to all. */
  branchId: number | null
  paymentCurrencyId: string | null
  paymentCurrencyCode: string
  /** The header Payment Amount: what the Total row must equal. */
  headerAmount: number | null
  readOnly: boolean
  rowErrors: Record<string, string>
  /** Posted payment: its saved lines, for the cheque clearance column. */
  savedLines?: PaymentLineDto[]
  /** Posted payment, and the reader may record what the bank did with a cheque. */
  onClearance?: (line: PaymentLineDto, status: number) => void
}

const CHEQUE = 'CHQ'

/**
 * 2 - Payment Details: one row per method, currency and account.
 *
 * NO SUMMARY CARD: the Total is the table's last row, and it sums the AMOUNT IN PAYMENT CURRENCY - the
 * raw Amount column is only totalled while every line is in one currency, because 28,000,000 CDF plus
 * 20,000 USD is not a figure anything means.
 *
 * A CHEQUE needs its number and date (and may carry a due date); other methods show no cheque fields.
 */
export function PaymentLinesCard({
  lines,
  onChange,
  onCurrencyChosen,
  onAdd,
  onRemove,
  methods,
  accounts,
  currencies,
  branchId,
  paymentCurrencyId,
  paymentCurrencyCode,
  headerAmount,
  readOnly,
  rowErrors,
  savedLines,
  onClearance,
}: PaymentLinesCardProps) {
  const isCheque = (line: PaymentLineForm) => methods.find((m) => String(m.id) === line.paymentMethodId)?.methodCode === CHEQUE
  const anyCheque = lines.some(isCheque)
  const rateOf = (line: PaymentLineForm) => (line.currencyId !== null && line.currencyId === paymentCurrencyId ? 1 : line.rateToPayment)
  const total = lines.reduce((sum, line) => sum + toPayment(line.amount, rateOf(line)), 0)
  const currenciesUsed = new Set(lines.map((l) => l.currencyId).filter(Boolean))
  const oneCurrency = currenciesUsed.size === 1 ? currencies.find((c) => String(c.id) === [...currenciesUsed][0]) : undefined
  const rawTotal = lines.reduce((sum, line) => sum + (line.amount ?? 0), 0)
  const balanced = headerAmount !== null && isBalanced(headerAmount, total)
  const showClearance = readOnly && (savedLines ?? []).some((l) => l.isCheque)
  const columns = 8 + (anyCheque ? 3 : 0) + (showClearance ? 1 : 0) + (readOnly ? 0 : 1)

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" mb={4}>
        <Title order={5}>2 · Payment Details</Title>
        {!readOnly && (
          <Button variant="default" leftSection={<IconPlus size={16} />} onClick={onAdd}>
            Add Payment Line
          </Button>
        )}
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        Add one line for each payment method and currency. The total amount in {paymentCurrencyCode || 'the payment currency'} must equal the header Payment Amount.
      </Text>

      <Table.ScrollContainer minWidth={anyCheque ? 1400 : 1080}>
        <Table striped highlightOnHover verticalSpacing="xs" withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={36}>#</Table.Th>
              <Table.Th w={150}>Payment Method</Table.Th>
              <Table.Th w={100}>Currency</Table.Th>
              <Table.Th w={150} ta="right">Amount</Table.Th>
              <Table.Th w={130} ta="right">Exchange Rate to {paymentCurrencyCode || 'Payment Currency'}</Table.Th>
              <Table.Th w={140} ta="right">Amount in {paymentCurrencyCode || 'Payment Currency'}</Table.Th>
              <Table.Th w={200}>Cash / Bank Account</Table.Th>
              <Table.Th w={140}>Reference</Table.Th>
              {anyCheque && <Table.Th w={120}>Cheque No.</Table.Th>}
              {anyCheque && <Table.Th w={140}>Cheque Date</Table.Th>}
              {anyCheque && <Table.Th w={140}>Due Date</Table.Th>}
              {showClearance && <Table.Th w={140}>Clearance</Table.Th>}
              {!readOnly && <Table.Th w={44} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={columns}>
                  <Text size="sm" c="dimmed" ta="center" py="sm">
                    No payment lines yet. At least one is needed to post: add one for each method or currency used.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {lines.map((line, index) => {
              const currency = currencies.find((c) => String(c.id) === line.currencyId)
              const same = line.currencyId !== null && line.currencyId === paymentCurrencyId
              const cheque = isCheque(line)
              const fitting = accounts.filter(
                (a) =>
                  String(a.id) === line.cashBankAccountId ||
                  (a.isActive && String(a.currencyId) === line.currencyId && (a.branchId === null || branchId === null || a.branchId === branchId)),
              )
              const error = rowErrors[line.key]
              const saved = savedLines?.[index]

              return (
                <Table.Tr key={line.key} bg={error ? 'var(--mantine-color-red-light)' : undefined}>
                  <Table.Td>{index + 1}</Table.Td>
                  <Table.Td>
                    <Select
                      aria-label={`Payment method, line ${index + 1}`}
                      placeholder="Method"
                      data={methods.filter((m) => m.isActive || String(m.id) === line.paymentMethodId).map((m) => ({ value: String(m.id), label: m.methodName }))}
                      value={line.paymentMethodId}
                      onChange={(next) => onChange(line.key, { paymentMethodId: next })}
                      disabled={readOnly}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      aria-label={`Currency, line ${index + 1}`}
                      placeholder="Currency"
                      data={currencies.filter((c) => c.isActive || String(c.id) === line.currencyId).map((c) => ({ value: String(c.id), label: c.currencyCode }))}
                      value={line.currencyId}
                      onChange={(next) => onCurrencyChosen(line.key, next)}
                      disabled={readOnly}
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      aria-label={`Amount, line ${index + 1}`}
                      min={0}
                      decimalScale={currency?.decimalPlaces ?? 2}
                      thousandSeparator=","
                      hideControls
                      value={line.amount ?? ''}
                      onChange={(next) => onChange(line.key, { amount: numberInputValue(next) })}
                      styles={{ input: { textAlign: 'right' } }}
                      disabled={readOnly}
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      aria-label={`Exchange rate, line ${index + 1}`}
                      min={0}
                      decimalScale={10}
                      thousandSeparator=","
                      hideControls
                      value={same ? 1 : (line.rateToPayment ?? '')}
                      onChange={(next) => onChange(line.key, { rateToPayment: numberInputValue(next), rateEdited: true })}
                      error={!same && line.currencyId !== null && line.rateToPayment === null ? 'No rate' : undefined}
                      styles={{ input: { textAlign: 'right' } }}
                      disabled={readOnly || same}
                    />
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" fw={500}>{formatNumber(toPayment(line.amount, rateOf(line)), 2)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Select
                      aria-label={`Cash / bank account, line ${index + 1}`}
                      placeholder={line.currencyId ? 'Account' : 'Choose the currency first'}
                      data={fitting.map((a) => ({ value: String(a.id), label: `${a.accountCode} - ${a.accountName}` }))}
                      value={line.cashBankAccountId}
                      onChange={(next) => onChange(line.key, { cashBankAccountId: next })}
                      nothingFoundMessage="No account in this currency"
                      searchable
                      disabled={readOnly}
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      aria-label={`Reference, line ${index + 1}`}
                      placeholder="Transfer / reference no."
                      maxLength={100}
                      value={line.reference}
                      onChange={(event) => onChange(line.key, { reference: event.currentTarget.value })}
                      disabled={readOnly}
                    />
                  </Table.Td>
                  {anyCheque && (
                    <Table.Td>
                      {cheque ? (
                        <TextInput
                          aria-label={`Cheque no., line ${index + 1}`}
                          maxLength={50}
                          value={line.chequeNo}
                          onChange={(event) => onChange(line.key, { chequeNo: event.currentTarget.value })}
                          error={!readOnly && !line.chequeNo.trim() ? 'Required' : undefined}
                          disabled={readOnly}
                        />
                      ) : (
                        <Text c="dimmed" ta="center">–</Text>
                      )}
                    </Table.Td>
                  )}
                  {anyCheque && (
                    <Table.Td>
                      {cheque ? (
                        <DateInput
                          aria-label={`Cheque date, line ${index + 1}`}
                          valueFormat="DD/MM/YYYY"
                          value={fromIsoDate(line.chequeDate)}
                          onChange={(next) => onChange(line.key, { chequeDate: next ? isoDate(new Date(next)) : null })}
                          error={!readOnly && !line.chequeDate ? 'Required' : undefined}
                          disabled={readOnly}
                        />
                      ) : (
                        <Text c="dimmed" ta="center">–</Text>
                      )}
                    </Table.Td>
                  )}
                  {anyCheque && (
                    <Table.Td>
                      {cheque ? (
                        <DateInput
                          aria-label={`Cheque due date, line ${index + 1}`}
                          valueFormat="DD/MM/YYYY"
                          placeholder="Optional"
                          clearable
                          value={fromIsoDate(line.chequeDueDate)}
                          onChange={(next) => onChange(line.key, { chequeDueDate: next ? isoDate(new Date(next)) : null })}
                          disabled={readOnly}
                        />
                      ) : (
                        <Text c="dimmed" ta="center">–</Text>
                      )}
                    </Table.Td>
                  )}
                  {showClearance && (
                    <Table.Td>
                      {saved?.isCheque ? (
                        onClearance ? (
                          <Select
                            aria-label={`Clearance status, line ${index + 1}`}
                            allowDeselect={false}
                            data={CLEARANCE_STATUSES.map((s) => ({ value: String(s.value), label: s.label }))}
                            value={String(saved.clearanceStatus ?? 1)}
                            onChange={(next) => next && onClearance(saved, Number(next))}
                          />
                        ) : (
                          <Badge variant="light" color={CLEARANCE_STATUSES.find((s) => s.value === saved.clearanceStatus)?.colour ?? 'gray'}>
                            {saved.clearanceStatusName ?? 'Pending'}
                          </Badge>
                        )
                      ) : (
                        <Text c="dimmed" ta="center">–</Text>
                      )}
                    </Table.Td>
                  )}
                  {!readOnly && (
                    <Table.Td>
                      <Tooltip label="Delete line" withArrow>
                        <ActionIcon variant="subtle" color="red" aria-label={`Delete line ${index + 1}`} onClick={() => onRemove(line.key)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  )}
                </Table.Tr>
              )
            })}
          </Table.Tbody>
          {lines.length > 0 && (
            <Table.Tfoot>
              <Table.Tr style={{ background: 'var(--mantine-color-blue-light)' }}>
                <Table.Th />
                <Table.Th colSpan={2} ta="right">Total</Table.Th>
                {/* The raw amounts add up only when they share one currency. */}
                <Table.Th ta="right">{oneCurrency ? `${formatNumber(rawTotal, oneCurrency.decimalPlaces)} ${oneCurrency.currencyCode}` : '–'}</Table.Th>
                <Table.Th ta="right">–</Table.Th>
                <Table.Th ta="right">{formatNumber(total, 2)}</Table.Th>
                <Table.Th colSpan={columns - 6} />
              </Table.Tr>
            </Table.Tfoot>
          )}
        </Table>
      </Table.ScrollContainer>

      {Object.values(rowErrors).map((message) => (
        <Text key={message} size="xs" c="red" mt={4}>{message}</Text>
      ))}

      {!readOnly && headerAmount !== null && lines.length > 0 && !balanced && (
        <Alert mt="sm" color="red" title="Unbalanced Payment — Payment Details Total does not match the Payment Amount.">
          The Payment Amount is {formatNumber(headerAmount, 2)} {paymentCurrencyCode} and the details add up to {formatNumber(total, 2)}:{' '}
          {headerAmount - total > 0 ? 'short by' : 'over by'} {formatNumber(Math.abs(headerAmount - total), 2)} {paymentCurrencyCode}. The draft can be saved; it cannot be posted until they match.
        </Alert>
      )}
    </Paper>
  )
}
