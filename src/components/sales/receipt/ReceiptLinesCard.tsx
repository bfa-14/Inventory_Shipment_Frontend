import { ActionIcon, Alert, Button, Group, NumberInput, Paper, Select, Table, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import type { CashBankAccountLookupDto } from '../../../api/masterdata/cashBankAccounts'
import type { PaymentMethodLookupDto } from '../../../api/masterdata/paymentMethods'
import type { CurrencyLookupDto } from '../../../api/types'
import { formatNumber, numberInputValue } from '../../format'
import { isBalanced, toBase, type ReceiptLineForm } from './receiptModel'

interface ReceiptLinesCardProps {
  lines: ReceiptLineForm[]
  onChange: (key: string, patch: Partial<ReceiptLineForm>) => void
  /** The reader chose a currency on a row: the page fetches the rate and clears an account of another currency. */
  onCurrencyChosen: (key: string, currencyId: string | null) => void
  onAdd: () => void
  onRemove: (key: string) => void
  methods: PaymentMethodLookupDto[]
  accounts: CashBankAccountLookupDto[]
  currencies: CurrencyLookupDto[]
  /** Accounts of other branches are not offered; an account with no branch belongs to all. */
  branchId: number | null
  baseCurrencyCode: string
  headerBase: number
  linesBase: number
  readOnly: boolean
  /** Row number → message from a failed save. */
  rowErrors: Record<string, string>
}

/**
 * How the money came in: one row per method, currency and account.
 *
 * A RECEIPT CAN BE PAID IN SEVERAL CURRENCIES AT ONCE — 300 USD in cash and 840,000 CDF by transfer —
 * which is why each row has its own currency and rate rather than inheriting the header's. The
 * header amount is what they must add up to, in the base currency.
 *
 * AN ACCOUNT HOLDS ONE CURRENCY, so the account list on a row is filtered by that row's currency
 * (and branch). Changing the currency clears an account that no longer fits instead of leaving a
 * USD cash box on a CDF row.
 */
export function ReceiptLinesCard({
  lines,
  onChange,
  onCurrencyChosen,
  onAdd,
  onRemove,
  methods,
  accounts,
  currencies,
  branchId,
  baseCurrencyCode,
  headerBase,
  linesBase,
  readOnly,
  rowErrors,
}: ReceiptLinesCardProps) {
  const difference = headerBase - linesBase
  const balanced = isBalanced(headerBase, linesBase)

  return (
    <Paper radius="lg" p="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={5}>Payment Lines</Title>
        {!readOnly && (
          <Button variant="default" leftSection={<IconPlus size={16} />} onClick={onAdd}>
            Add Payment Line
          </Button>
        )}
      </Group>

      <Table.ScrollContainer minWidth={980}>
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={36}>#</Table.Th>
              <Table.Th w={160}>Method</Table.Th>
              <Table.Th w={110}>Currency</Table.Th>
              <Table.Th w={150} ta="right">Amount</Table.Th>
              <Table.Th w={130} ta="right">Rate</Table.Th>
              <Table.Th w={130} ta="right">Amount ({baseCurrencyCode})</Table.Th>
              <Table.Th w={210}>Cash / Bank account</Table.Th>
              <Table.Th>Reference</Table.Th>
              {!readOnly && <Table.Th w={44} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={9}>
                  <Text size="sm" c="dimmed" ta="center" py="sm">
                    No payment lines yet. Add one for each method or currency the customer paid with.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {lines.map((line, index) => {
              const currency = currencies.find((c) => String(c.id) === line.currencyId)
              const isBase = currency?.isBaseCurrency === true
              const fitting = accounts.filter(
                (a) =>
                  String(a.id) === line.cashBankAccountId ||
                  (a.isActive && String(a.currencyId) === line.currencyId && (a.branchId === null || branchId === null || a.branchId === branchId)),
              )
              const rate = isBase ? 1 : line.exchangeRate
              const error = rowErrors[line.key]

              return (
                <Table.Tr key={line.key} bg={error ? 'var(--mantine-color-red-light)' : undefined}>
                  <Table.Td>{index + 1}</Table.Td>
                  <Table.Td>
                    <Select
                      aria-label={`Method, line ${index + 1}`}
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
                      aria-label={`Rate, line ${index + 1}`}
                      min={0}
                      decimalScale={6}
                      thousandSeparator=","
                      hideControls
                      value={isBase ? 1 : (line.exchangeRate ?? '')}
                      onChange={(next) => onChange(line.key, { exchangeRate: numberInputValue(next), rateEdited: true })}
                      error={!isBase && line.currencyId !== null && line.exchangeRate === null ? 'No rate' : undefined}
                      styles={{ input: { textAlign: 'right' } }}
                      disabled={readOnly || isBase}
                    />
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" fw={500}>{formatNumber(toBase(line.amount, rate), 2)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Select
                      aria-label={`Account, line ${index + 1}`}
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
                      placeholder="Cheque / transfer no."
                      maxLength={100}
                      value={line.reference}
                      onChange={(event) => onChange(line.key, { reference: event.currentTarget.value })}
                      disabled={readOnly}
                    />
                  </Table.Td>
                  {!readOnly && (
                    <Table.Td>
                      <Tooltip label="Remove line" withArrow>
                        <ActionIcon variant="subtle" color="red" aria-label={`Remove line ${index + 1}`} onClick={() => onRemove(line.key)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  )}
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {Object.values(rowErrors).map((message) => (
        <Text key={message} size="xs" c="red" mt={4}>{message}</Text>
      ))}

      <Group justify="space-between" mt="md" wrap="wrap">
        <Text size="sm" c="dimmed">Lines total ({baseCurrencyCode})</Text>
        <Text fw={600}>{formatNumber(linesBase, 2)}</Text>
      </Group>

      {headerBase > 0 || lines.length > 0 ? (
        <Alert mt="sm" color={balanced ? 'green' : 'red'} title={balanced ? 'Payment lines match the receipt amount' : 'Payment lines do not match the receipt amount'}>
          {balanced
            ? `Both come to ${formatNumber(headerBase, 2)} ${baseCurrencyCode}.`
            : `The receipt is ${formatNumber(headerBase, 2)} ${baseCurrencyCode} but the lines add up to ${formatNumber(linesBase, 2)}: ${difference > 0 ? 'short by' : 'over by'} ${formatNumber(Math.abs(difference), 2)} ${baseCurrencyCode}. A draft can be saved like this; it cannot be posted.`}
        </Alert>
      ) : null}
    </Paper>
  )
}
