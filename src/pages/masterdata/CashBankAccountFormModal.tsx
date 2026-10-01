import { useEffect, useState } from 'react'
import { Alert, Anchor, Group, Select, Switch, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import {
  CASH_BANK_ACCOUNT_TYPES,
  cashBankAccountsApi,
  type CashBankAccountDto,
  type CashBankAccountType,
  type SaveCashBankAccountRequest,
} from '../../api/masterdata/cashBankAccounts'
import { currenciesApi } from '../../api/masterdata/currencies'
import type { BranchLookupDto, CurrencyLookupDto } from '../../api/types'
import { FormModal } from '../../components/ui/FormModal'

interface CashBankAccountFormModalProps {
  mode: 'create' | 'edit'
  account?: CashBankAccountDto
  onClose(): void
  onSaved(account: CashBankAccountDto): void
}

interface FormValues {
  accountCode: string
  accountName: string
  accountType: CashBankAccountType
  currencyId: string | null
  branchId: string | null
  description: string
  isActive: boolean
}

const MAX_CODE = 20
const MAX_NAME = 100
const MAX_DESCRIPTION = 500

export function CashBankAccountFormModal({ mode, account, onClose, onSaved }: CashBankAccountFormModalProps) {
  const [rowVersion, setRowVersion] = useState(account?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  const [branches, setBranches] = useState<BranchLookupDto[]>([])

  /* THE CURRENCY IS LOCKED ONCE RECEIPTS USE THE ACCOUNT. The server refuses the change, because the
     lines were checked against this currency when they were saved and posted money cannot move to
     another one afterwards. Disabling the box says so before the reader has typed anything, rather
     than after Save. The count comes from the list the modal was opened from. */
  const currencyLocked = mode === 'edit' && (account?.usedCount ?? 0) > 0

  useEffect(() => {
    currenciesApi.lookup(true, account?.currencyId).then(setCurrencies).catch(() => setFormError('The currencies could not be loaded.'))
    branchesApi.lookup(true, account?.branchId ?? undefined).then(setBranches).catch(() => setFormError('The branches could not be loaded.'))
  }, [account?.currencyId, account?.branchId])

  const form = useForm<FormValues>({
    initialValues: toValues(account),
    validate: {
      accountCode: (value) => {
        const code = value.trim()
        if (!code) return 'Account Code is required.'
        if (code.length > MAX_CODE) return `Account Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      accountName: (value) => {
        const name = value.trim()
        if (!name) return 'Account Name is required.'
        if (name.length > MAX_NAME) return `Account Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
      currencyId: (value) => (value ? null : 'Currency is required.'),
    },
  })

  function buildPayload(values: FormValues): SaveCashBankAccountRequest {
    return {
      accountCode: values.accountCode.trim().toUpperCase(),
      accountName: values.accountName.trim(),
      accountType: values.accountType,
      currencyId: Number(values.currencyId),
      branchId: values.branchId === null ? null : Number(values.branchId),
      description: values.description.trim() || null,
      isActive: values.isActive,
      ...(mode === 'edit' ? { rowVersion } : {}),
    }
  }

  async function save(values: FormValues) {
    setSaving(true)
    setFormError(null)
    setStale(false)
    try {
      const payload = buildPayload(values)
      const saved =
        mode === 'create'
          ? await cashBankAccountsApi.create(payload)
          : await cashBankAccountsApi.update((account as CashBankAccountDto).id, payload)
      onSaved(saved)
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setFormError('The account could not be saved.')
      } else if (error.code === 'DUPLICATE_CODE') {
        form.setErrors({ accountCode: 'An account with this code already exists.' })
      } else if (error.code === 'CONCURRENCY') {
        setStale(true)
        setFormError(error.messages.join(' '))
      } else {
        setFormError(error.messages.join(' '))
      }
    } finally {
      setSaving(false)
    }
  }

  async function reload() {
    if (!account) return
    try {
      const fresh = await cashBankAccountsApi.get(account.id)
      form.setValues(toValues(fresh))
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The account could not be reloaded.')
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Cash / Bank Account' : 'Edit Cash / Bank Account'}
      saveLabel="Save Account"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values))()}
    >
      <Group grow align="flex-start">
        <TextInput label="Account Code" placeholder="CASH-USD" withAsterisk maxLength={MAX_CODE} {...form.getInputProps('accountCode')} />
        <TextInput label="Account Name" placeholder="Main Cashbox USD" withAsterisk maxLength={MAX_NAME} {...form.getInputProps('accountName')} />
      </Group>

      <Group grow align="flex-start">
        <Select
          label="Type"
          withAsterisk
          allowDeselect={false}
          data={CASH_BANK_ACCOUNT_TYPES}
          {...form.getInputProps('accountType')}
        />
        <Select
          label="Currency"
          description={currencyLocked ? 'Receipts already use this account, so its currency is fixed.' : 'An account holds one currency.'}
          placeholder="Choose a currency"
          withAsterisk
          searchable
          disabled={currencyLocked}
          data={currencies.map((c) => ({ value: String(c.id), label: c.currencyCode }))}
          {...form.getInputProps('currencyId')}
        />
      </Group>

      <Select
        label="Branch"
        description="Leave empty for an account every branch may use."
        placeholder="All branches"
        clearable
        searchable
        data={branches.map((b) => ({ value: String(b.id), label: b.branchName }))}
        {...form.getInputProps('branchId')}
      />

      <Textarea label="Description" autosize minRows={2} maxLength={MAX_DESCRIPTION} {...form.getInputProps('description')} />

      <Switch
        label="Active"
        description="Only active accounts are offered on a new receipt line."
        {...form.getInputProps('isActive', { type: 'checkbox' })}
      />

      {formError ? (
        <Alert color="red">
          {formError}
          {stale ? (
            <>
              {' '}
              <Anchor component="button" type="button" onClick={reload}>
                Reload
              </Anchor>{' '}
              the account to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}

function toValues(account?: CashBankAccountDto): FormValues {
  return {
    accountCode: account?.accountCode ?? '',
    accountName: account?.accountName ?? '',
    accountType: account?.accountType ?? 'Cash',
    currencyId: account ? String(account.currencyId) : null,
    branchId: account?.branchId == null ? null : String(account.branchId),
    description: account?.description ?? '',
    isActive: account?.isActive ?? true,
  }
}
