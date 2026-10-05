import { Alert, Anchor, Badge, Grid, Paper, Select, Text, TextInput, Title } from '@mantine/core'
import { Link } from 'react-router'
import type { CashBankAccountLookupDto } from '../../api/masterdata/cashBankAccounts'
import type { PaymentMethodLookupDto } from '../../api/masterdata/paymentMethods'
import { SALES_PAYMENT_TYPES, type SalesPaymentType } from '../../api/sales/invoices'
import { accountTypeFor, type SalesPaymentErrors, type SalesPaymentForm } from './salesPayment'
import { formatNumber } from '../format'
import { paymentStatusColour, paymentStatusLabel } from './paymentStatus'

interface SalesPaymentCardProps {
  value: SalesPaymentForm
  onChange: (patch: Partial<SalesPaymentForm>) => void
  methods: PaymentMethodLookupDto[]
  accounts: CashBankAccountLookupDto[]
  /** The currency the invoice is billed in: a cash account must hold it. Null while it is not known yet. */
  currencyId: number | null
  currencyCode: string
  branchId: number | null
  readOnly: boolean
  disabled: boolean
  errors: SalesPaymentErrors
  /** What a saved, posted invoice knows about its payment. All null on a draft. */
  paymentStatus: string | null
  paidAmount: number | null
  outstandingAmount: number | null
  totalAmount: number | null
  decimalPlaces: number
  receiptId: number | null
  receiptNumber: string | null
  receiptStatus: string | null
  /** Names for the read-only view of a posted invoice. */
  methodName: string | null
  accountLabel: string | null
}

/**
 * HOW THE CUSTOMER PAYS. Cash: posting the invoice also takes the money in, through a receipt made
 * and posted in the same step. On Account: no receipt; the invoice stays unpaid until receipts are
 * allocated to it.
 *
 * NOTHING HERE CREATES A RECEIPT. These fields are only remembered with the draft; the receipt is
 * made once, by the server, when the invoice is posted — so saving and editing a draft any number of
 * times can never produce one.
 *
 * THE ACCOUNT LIST FOLLOWS THE INVOICE'S CURRENCY. An account holds one currency, and a receipt for
 * 2,500 USD cannot go into a CDF cash box; offering only the accounts that fit stops the mistake
 * before the server has to refuse it.
 */
export function SalesPaymentCard({
  value,
  onChange,
  methods,
  accounts,
  currencyId,
  currencyCode,
  branchId,
  readOnly,
  disabled,
  errors,
  paymentStatus,
  paidAmount,
  outstandingAmount,
  totalAmount,
  decimalPlaces,
  receiptId,
  receiptNumber,
  receiptStatus,
  methodName,
  accountLabel,
}: SalesPaymentCardProps) {
  const cash = value.paymentType === 1
  const method = methods.find((m) => String(m.id) === value.receiptMethodId) ?? null
  const kind = method ? accountTypeFor(method) : null
  const fitting = accounts.filter(
    (a) =>
      String(a.id) === value.receiptAccountId
      || (a.isActive && (currencyId === null || a.currencyId === currencyId) && (a.branchId === null || branchId === null || a.branchId === branchId)
          && (kind === null || a.accountType === kind)),
  )

  const field = (label: string, content: string) => (
    <div>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={500}>{content || '—'}</Text>
    </div>
  )

  const typeLabel = SALES_PAYMENT_TYPES.find((t) => t.value === value.paymentType)?.label ?? ''

  return (
    <Paper radius="lg" p="md" withBorder>
      <Title order={5} mb="sm">Payment</Title>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          {readOnly ? (
            field('Payment Type', typeLabel)
          ) : (
            <Select
              label="Payment Type"
              withAsterisk
              placeholder="Cash or On Account"
              data={SALES_PAYMENT_TYPES.map((t) => ({ value: String(t.value), label: t.label }))}
              value={value.paymentType === null ? null : String(value.paymentType)}
              onChange={(next) => onChange({ paymentType: next === null ? null : (Number(next) as SalesPaymentType) })}
              error={errors.paymentType}
              disabled={disabled}
              allowDeselect={false}
            />
          )}
        </Grid.Col>

        {cash && (
          <>
            <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
              {readOnly ? (
                field('Receipt Method', methodName ?? '')
              ) : (
                <Select
                  label="Receipt Method"
                  withAsterisk
                  placeholder="Cash, bank transfer…"
                  data={methods.filter((m) => m.isActive || String(m.id) === value.receiptMethodId).map((m) => ({ value: String(m.id), label: m.methodName }))}
                  value={value.receiptMethodId}
                  onChange={(next) => onChange({ receiptMethodId: next })}
                  error={errors.receiptMethodId}
                  disabled={disabled}
                  searchable
                />
              )}
            </Grid.Col>

            <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
              {readOnly ? (
                field('Cash / Bank Account', accountLabel ?? '')
              ) : (
                <Select
                  label="Cash / Bank Account"
                  withAsterisk
                  placeholder={currencyId === null ? 'Choose the invoice currency first' : `${kind ?? 'Cash / bank'} account in ${currencyCode}`}
                  data={fitting.map((a) => ({ value: String(a.id), label: `${a.accountCode} - ${a.accountName}` }))}
                  value={value.receiptAccountId}
                  onChange={(next) => onChange({ receiptAccountId: next })}
                  error={errors.receiptAccountId}
                  nothingFoundMessage={`No ${kind ? kind.toLowerCase() + ' ' : ''}account in ${currencyCode}`}
                  disabled={disabled}
                  searchable
                  clearable
                />
              )}
            </Grid.Col>

            <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
              {readOnly ? (
                field('Payment Reference', value.paymentReference)
              ) : (
                <TextInput
                  label="Payment Reference"
                  placeholder="Optional: cheque or transfer no."
                  maxLength={100}
                  value={value.paymentReference}
                  onChange={(event) => onChange({ paymentReference: event.currentTarget.value })}
                  disabled={disabled}
                />
              )}
            </Grid.Col>
          </>
        )}

        {/* READ-ONLY, whatever the mode: the status is what the receipts have made of the invoice. */}
        {paymentStatus && (
          <>
            <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
              <Text size="sm" c="dimmed">Payment Status</Text>
              <Badge color={paymentStatusColour(paymentStatus)} variant="light" size="lg">{paymentStatusLabel(paymentStatus)}</Badge>
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
              {field('Paid', `${formatNumber(paidAmount ?? 0, decimalPlaces)} of ${formatNumber(totalAmount ?? 0, decimalPlaces)} ${currencyCode}`)}
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
              {field('Outstanding', `${formatNumber(outstandingAmount ?? 0, decimalPlaces)} ${currencyCode}`)}
            </Grid.Col>
          </>
        )}

        {receiptId !== null && (
          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
            <Text size="sm" c="dimmed">Receipt No.</Text>
            <Anchor component={Link} to={`/sales/receipts/${receiptId}`} fw={500}>{receiptNumber ?? `#${receiptId}`}</Anchor>
            {receiptStatus && receiptStatus !== 'Posted' && <Badge ml="xs" color="orange" variant="light">{receiptStatus}</Badge>}
          </Grid.Col>
        )}
      </Grid>

      {!readOnly && cash && (
        <Alert mt="md" color="blue" variant="light">
          Posting this invoice will also create and post a receipt for the full total in {currencyCode} into the account above, and mark the invoice Fully Paid.
        </Alert>
      )}
    </Paper>
  )
}
