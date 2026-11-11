import { useEffect, useState } from 'react'
import { Alert, Anchor, Grid, Paper, Select, Text, TextInput, Title } from '@mantine/core'
import { Link } from 'react-router'
import { CHARGE_PAYMENT_TYPES } from '../../api/logistics/containerCharges'
import { cashBankAccountsApi, type CashBankAccountLookupDto } from '../../api/masterdata/cashBankAccounts'
import { paymentMethodsApi, type PaymentMethodLookupDto } from '../../api/masterdata/paymentMethods'
import { accountTypeFor } from '../sales/salesPayment'
import type { ChargePaymentErrors, ChargePaymentForm } from './chargePayment'

/** A cheque has its own details (no., dates): it is paid with Purchase › Supplier Payments, never from here. */
const isCheque = (m: PaymentMethodLookupDto) => m.methodCode.toUpperCase() === 'CHQ'

interface ChargePaymentPanelProps {
  value: ChargePaymentForm
  onChange: (patch: Partial<ChargePaymentForm>) => void
  /** The charge's currency: a cash account must hold it. Null while it is not chosen. */
  currencyId: number | null
  currencyCode: string
  disabled?: boolean
  errors?: ChargePaymentErrors
  /** A deduction is never paid: the panel says so and offers nothing. */
  deduction?: boolean
  /** Where a posted cash charge's payment is shown. */
  cashPayment?: { id: number; number: string | null } | null
  /** What the Cash alert says will happen ("Posting this charge…", "Applying…"). */
  postVerb?: string
}

/**
 * HOW A CONTAINER CHARGE IS PAID (script 113), the sales invoice's Payment panel on a charge. Cash: posting the charge
 * also makes and posts a supplier payment to its provider from the account chosen, and the charge is Paid. On account:
 * no payment; the charge stays payable to its provider. Nothing here makes a payment: the server does, once, when the
 * charge is posted.
 *
 * THE ACCOUNT LIST FOLLOWS THE CHARGE'S CURRENCY and the method's kind (a cash method pays from a cash box).
 */
export function ChargePaymentPanel({
  value,
  onChange,
  currencyId,
  currencyCode,
  disabled = false,
  errors = {},
  deduction = false,
  cashPayment = null,
  postVerb = 'Posting this charge',
}: ChargePaymentPanelProps) {
  const [methods, setMethods] = useState<PaymentMethodLookupDto[]>([])
  const [accounts, setAccounts] = useState<CashBankAccountLookupDto[]>([])

  useEffect(() => {
    let alive = true
    paymentMethodsApi.lookup(false).then((list) => alive && setMethods(list)).catch(() => {})
    cashBankAccountsApi.lookup({ activeOnly: false }).then((list) => alive && setAccounts(list)).catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const cash = value.paymentType === 1
  const method = methods.find((m) => String(m.id) === value.methodId) ?? null
  const kind = method ? accountTypeFor(method) : null
  const fitting = accounts.filter(
    (a) =>
      String(a.id) === value.accountId
      || (a.isActive && (currencyId === null || a.currencyId === currencyId) && (kind === null || a.accountType === kind)),
  )

  return (
    <Paper radius="lg" p="md" withBorder data-charge-payment>
      <Title order={5} mb="sm">Payment</Title>
      {deduction ? (
        <Text fz="sm" c="dimmed">A deduction is not paid: it lowers the cost of the goods.</Text>
      ) : (
        <>
          <Grid>
            <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
              <Select
                label="Payment Type"
                withAsterisk
                data={CHARGE_PAYMENT_TYPES.map((t) => ({ value: String(t.value), label: t.label }))}
                value={String(value.paymentType)}
                onChange={(next) =>
                  onChange(next === '1' ? { paymentType: 1 } : { paymentType: 2, methodId: null, accountId: null, reference: '' })
                }
                error={errors.paymentType}
                disabled={disabled}
                allowDeselect={false}
              />
            </Grid.Col>
            {cash && (
              <>
                <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
                  <Select
                    label="Payment Method"
                    withAsterisk
                    placeholder="Cash, bank transfer…"
                    data={methods
                      .filter((m) => !isCheque(m) && (m.isActive || String(m.id) === value.methodId))
                      .map((m) => ({ value: String(m.id), label: m.methodName }))}
                    value={value.methodId}
                    onChange={(next) => onChange({ methodId: next, accountId: null })}
                    error={errors.methodId}
                    disabled={disabled}
                    searchable
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
                  <Select
                    label="Cash / Bank Account"
                    withAsterisk
                    placeholder={currencyId === null ? 'Choose the currency first' : `${kind ?? 'Cash / bank'} account in ${currencyCode}`}
                    data={fitting.map((a) => ({ value: String(a.id), label: `${a.accountCode} - ${a.accountName}` }))}
                    value={value.accountId}
                    onChange={(next) => onChange({ accountId: next })}
                    error={errors.accountId}
                    nothingFoundMessage={`No ${kind ? kind.toLowerCase() + ' ' : ''}account in ${currencyCode}`}
                    disabled={disabled}
                    searchable
                    clearable
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
                  <TextInput
                    label="Payment Reference"
                    placeholder="Optional: transfer no."
                    maxLength={100}
                    value={value.reference}
                    onChange={(event) => onChange({ reference: event.currentTarget.value })}
                    disabled={disabled}
                  />
                </Grid.Col>
              </>
            )}
          </Grid>
          {cashPayment ? (
            <Text fz="sm" mt="sm">
              Paid by{' '}
              <Anchor component={Link} to={`/purchase/payments/${cashPayment.id}`} fw={500}>
                {cashPayment.number ?? `#${cashPayment.id}`}
              </Anchor>
              , made when the charge was posted. Cancelling the charge reverses it.
            </Text>
          ) : cash && !disabled ? (
            <Alert mt="md" color="blue" variant="light">
              {postVerb} will also create and post a supplier payment to the provider for the full amount in {currencyCode} from the
              account above, and mark the charge Paid.
            </Alert>
          ) : !cash && !disabled ? (
            <Text fz="xs" c="dimmed" mt="xs">
              On account: the charge stays unpaid, payable to its provider (Purchase › Supplier Payments).
            </Text>
          ) : null}
        </>
      )}
    </Paper>
  )
}
