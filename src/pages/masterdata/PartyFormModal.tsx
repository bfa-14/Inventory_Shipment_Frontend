import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Anchor,
  Checkbox,
  Grid,
  Group,
  Input,
  Select,
  Switch,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import { currenciesApi } from '../../api/masterdata/currencies'
import { partiesApi } from '../../api/masterdata/parties'
import { priceListsApi } from '../../api/masterdata/priceLists'
import { securityApi } from '../../api/security'
import type {
  BranchLookupDto,
  CurrencyLookupDto,
  PartyDto,
  PartyTypeName,
  PriceListLookupDto,
  SavePartyRequest,
  UserLookupDto,
} from '../../api/types'
import { FormModal } from '../../components/ui/FormModal'
import { notify } from '../../components/ui/notify'
import { COUNTRIES, countryLabel } from '../../data/countries'
import { PARTY_TYPES } from './partyTypes'

interface PartyFormModalProps {
  mode: 'create' | 'edit' | 'view'
  party?: PartyDto
  onClose(): void
  onSaved(party: PartyDto): void
}

interface FormValues {
  partyCode: string
  partyName: string
  /** The checked types, as PartyTypeName values - what Checkbox.Group works in. */
  types: string[]
  branchId: string | null
  contactPerson: string
  phone: string
  mobile: string
  email: string
  address: string
  country: string | null
  taxRegistrationNo: string
  notes: string
  userId: string | null
  defaultPriceListId: string | null
  defaultCurrencyId: string | null
  isActive: boolean
}

const MAX_CODE = 20
const MAX_NAME = 200
const MAX_CONTACT = 150
const MAX_PHONE = 50
const MAX_EMAIL = 150
const MAX_ADDRESS = 500
const MAX_TAX = 50
const MAX_NOTES = 1000

/** Matches the API's [EmailAddress]: something, an @, something with a dot, and no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Said the same way whether the clash is found by the pre-flight check on blur or by the API's own
 * 409 on save, because to the reader it is one fact about the code they typed.
 */
const CODE_TAKEN_MESSAGE = 'This Party Code already exists. Party codes must be unique.'

export function PartyFormModal({ mode, party, onClose, onSaved }: PartyFormModalProps) {
  const readOnly = mode === 'view'

  const [rowVersion, setRowVersion] = useState(party?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [priceLists, setPriceLists] = useState<PriceListLookupDto[]>([])
  const [currencies, setCurrencies] = useState<CurrencyLookupDto[]>([])
  const [users, setUsers] = useState<UserLookupDto[]>([])

  /** True once the reader has typed in the code box: the suggestion must not overwrite their work. */
  const codeTouched = useRef(mode !== 'create')

  /**
   * Set when the pre-flight check on blur finds the code already taken. Saving is blocked until the
   * code changes - the API would refuse it anyway, and saying so before the round trip is kinder.
   */
  const [codeTaken, setCodeTaken] = useState(false)

  const form = useForm<FormValues>({
    initialValues: {
      partyCode: party?.partyCode ?? '',
      partyName: party?.partyName ?? '',
      types: initialTypes(party),
      branchId: party?.branchId != null ? String(party.branchId) : null,
      contactPerson: party?.contactPerson ?? '',
      phone: party?.phone ?? '',
      mobile: party?.mobile ?? '',
      email: party?.email ?? '',
      address: party?.address ?? '',
      country: party?.country ?? null,
      taxRegistrationNo: party?.taxRegistrationNo ?? '',
      notes: party?.notes ?? '',
      userId: party?.userId != null ? String(party.userId) : null,
      defaultPriceListId: party?.defaultPriceListId != null ? String(party.defaultPriceListId) : null,
      defaultCurrencyId: party?.defaultCurrencyId != null ? String(party.defaultCurrencyId) : null,
      isActive: party?.isActive ?? true,
    },
    validate: {
      partyCode: (value) => {
        const code = value.trim()
        if (!code) return 'Party Code is required.'
        if (code.length > MAX_CODE) return `Party Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      partyName: (value) => {
        const name = value.trim()
        if (!name) return 'Party Name is required.'
        if (name.length > MAX_NAME) return `Party Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
      types: (value) => (value.length === 0 ? 'Select at least one party type' : null),
      email: (value) => {
        const email = value.trim()
        if (!email) return null
        if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.'
        if (email.length > MAX_EMAIL) return `Email cannot be longer than ${MAX_EMAIL} characters.`
        return null
      },
    },
  })

  const types = form.values.types
  const isSupplier = types.includes('Supplier')
  const isPerson = types.includes('Salesman') || types.includes('Employee')

  // The first checked type, in the canonical order - what the suggested code is built from.
  const firstType = PARTY_TYPES.find((t) => types.includes(t.value))?.value ?? null

  /**
   * @mantine/form rebuilds its handlers on every render, so an effect that lists `setFieldValue`
   * as a dependency runs after every render - and one that also SETS a value never stops, firing a
   * request per render and cancelling the previous one just as it resolves. The ref keeps the
   * latest handlers reachable without making them a dependency.
   */
  const formRef = useRef(form)
  formRef.current = form

  // Dropdown data. An inactive record the party already points at is kept in its list through
  // `includeId`, so an edit form still shows what the party currently references.
  useEffect(() => {
    let cancelled = false
    const set = <T,>(setter: (rows: T[]) => void) => ({
      ok: (rows: T[]) => {
        if (!cancelled) setter(rows)
      },
      fail: () => {
        if (!cancelled) setter([])
      },
    })

    const branch = set(setBranches)
    void branchesApi.lookup(true, party?.branchId ?? undefined).then(branch.ok).catch(branch.fail)

    // `includeId` keeps the party's current list visible even if it has since been deactivated.
    const list = set(setPriceLists)
    void priceListsApi.lookup(true, party?.defaultPriceListId ?? undefined).then(list.ok).catch(list.fail)

    const currency = set(setCurrencies)
    void currenciesApi.lookup(true, party?.defaultCurrencyId ?? undefined).then(currency.ok).catch(currency.fail)

    const user = set(setUsers)
    void securityApi
      .userLookup({ activeOnly: true, includeId: party?.userId ?? undefined, top: 200 })
      .then(user.ok)
      .catch(user.fail)

    return () => {
      cancelled = true
    }
  }, [party?.branchId, party?.defaultPriceListId, party?.defaultCurrencyId, party?.userId])

  /**
   * The suggested code follows the first checked type while the reader has not written one of their
   * own - tick Client first and the box fills with CLI-0001, tick Supplier above it and it becomes
   * SUP-0001. It stops the moment they type, because a suggestion that overwrites what someone
   * wrote is not a suggestion.
   */
  useEffect(() => {
    if (mode !== 'create' || !firstType || codeTouched.current) return

    let cancelled = false
    void partiesApi
      .nextCode(firstType)
      .then((result) => {
        if (!cancelled && !codeTouched.current) formRef.current.setFieldValue('partyCode', result.suggestedCode)
      })
      .catch(() => {
        // A failed suggestion is not an error the reader has to act on: the box stays editable.
      })

    return () => {
      cancelled = true
    }
  }, [mode, firstType])

  /**
   * A field that belongs to a type is cleared by the tick that removed it - leaving a default
   * currency on a party that is no longer a supplier would save a value nothing on the form still
   * shows. It happens here rather than in an effect watching the values, so there is one obvious
   * moment when it occurs and no chance of a render loop. The default price list is NOT among them:
   * it belongs to the party whatever its types.
   */
  function handleTypesChange(next: string[]) {
    form.setFieldValue('types', next)
    if (!next.includes('Supplier')) form.setFieldValue('defaultCurrencyId', null)
    if (!next.includes('Salesman') && !next.includes('Employee')) form.setFieldValue('userId', null)
  }

  const countryOptions = useMemo(() => COUNTRIES.map((c) => ({ value: c.code, label: countryLabel(c) })), [])

  // Price lists are named with the currency their prices are in.
  const priceListOptions = useMemo(
    () => priceLists.map((p) => ({ value: String(p.id), label: `${p.priceListName} (${p.currencyCode})` })),
    [priceLists],
  )

  /**
   * Party codes are unique system-wide and saving never merges into an existing party, so a clash
   * is worth catching the moment the reader leaves the box. The lookup matches code OR name, hence
   * the exact comparison; `activeOnly: false` because an inactive party still owns its code.
   */
  async function checkCodeAvailable() {
    const code = form.values.partyCode.trim()
    if (readOnly || !code) {
      setCodeTaken(false)
      return
    }

    try {
      const matches = await partiesApi.lookup({ search: code, activeOnly: false, top: 50 })
      const clash = matches.some(
        (candidate) => candidate.partyCode.toLowerCase() === code.toLowerCase() && candidate.id !== party?.id,
      )
      setCodeTaken(clash)
      if (clash) form.setFieldError('partyCode', CODE_TAKEN_MESSAGE)
    } catch {
      // A pre-flight check that cannot run must not block a save: the API still answers 409.
      setCodeTaken(false)
    }
  }

  function buildPayload(values: FormValues): SavePartyRequest {
    const trimmed = (value: string) => (value.trim() ? value.trim() : null)

    return {
      partyCode: values.partyCode.trim(),
      partyName: values.partyName.trim(),
      isSupplier: values.types.includes('Supplier'),
      isClient: values.types.includes('Client'),
      isSalesman: values.types.includes('Salesman'),
      isEmployee: values.types.includes('Employee'),
      branchId: toNumber(values.branchId),
      contactPerson: trimmed(values.contactPerson),
      phone: trimmed(values.phone),
      mobile: trimmed(values.mobile),
      email: trimmed(values.email),
      address: trimmed(values.address),
      country: values.country,
      taxRegistrationNo: trimmed(values.taxRegistrationNo),
      notes: trimmed(values.notes),
      userId: toNumber(values.userId),
      defaultPriceListId: toNumber(values.defaultPriceListId),
      defaultCurrencyId: toNumber(values.defaultCurrencyId),
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
        mode === 'create' ? await partiesApi.create(payload) : await partiesApi.update((party as PartyDto).id, payload)

      onSaved(saved)
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  function handleError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError('The party could not be saved.')
      return
    }

    if (error.code === 'DUPLICATE_CODE') {
      setCodeTaken(true)
      form.setErrors({ partyCode: CODE_TAKEN_MESSAGE })
      return
    }

    if (error.code === 'USER_ALREADY_LINKED') {
      form.setErrors({ userId: error.messages[0] as string })
      return
    }

    // The message names the type that is still in use, which is exactly what the reader needs.
    if (error.code === 'TYPE_IN_USE') {
      form.setErrors({ types: error.messages[0] as string })
      return
    }

    // A branch, price list, currency or user that has been deactivated meanwhile: the record the
    // form points at is gone, so this is news about the world rather than about a field.
    if (error.code === 'MASTER_INACTIVE') {
      notify.error(error.messages[0] as string)
      return
    }

    if (error.code === 'CONCURRENCY') {
      notify.error(error.messages[0] as string)
      setStale(true)
      setFormError(error.messages.join(' '))
      void reload()
      return
    }

    // ASP.NET model validation: map the messages back onto the fields they belong to.
    const mapped: Record<string, string> = {}
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      const key = field.toLowerCase()
      const message = messages.join(' ')
      if (key.includes('partycode')) mapped.partyCode = message
      else if (key.includes('partyname')) mapped.partyName = message
      else if (key.includes('contactperson')) mapped.contactPerson = message
      else if (key.includes('mobile')) mapped.mobile = message
      else if (key.includes('phone')) mapped.phone = message
      else if (key.includes('email')) mapped.email = message
      else if (key.includes('address')) mapped.address = message
      else if (key.includes('country')) mapped.country = message
      else if (key.includes('taxregistration')) mapped.taxRegistrationNo = message
      else if (key.includes('notes')) mapped.notes = message
    }

    if (Object.keys(mapped).length > 0) {
      form.setErrors(mapped)
      return
    }

    setFormError(error.messages.join(' '))
  }

  /** After a concurrency conflict: pull the current row back into the form. */
  async function reload() {
    if (!party) return
    try {
      const fresh = await partiesApi.get(party.id)
      form.setValues({
        partyCode: fresh.partyCode,
        partyName: fresh.partyName,
        types: initialTypes(fresh),
        branchId: fresh.branchId != null ? String(fresh.branchId) : null,
        contactPerson: fresh.contactPerson ?? '',
        phone: fresh.phone ?? '',
        mobile: fresh.mobile ?? '',
        email: fresh.email ?? '',
        address: fresh.address ?? '',
        country: fresh.country ?? null,
        taxRegistrationNo: fresh.taxRegistrationNo ?? '',
        notes: fresh.notes ?? '',
        userId: fresh.userId != null ? String(fresh.userId) : null,
        defaultPriceListId: fresh.defaultPriceListId != null ? String(fresh.defaultPriceListId) : null,
        defaultCurrencyId: fresh.defaultCurrencyId != null ? String(fresh.defaultCurrencyId) : null,
        isActive: fresh.isActive,
      })
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The party could not be reloaded.')
    }
  }

  /** Read-only turns every control into a display: same field, same place, nothing to type into. */
  const lock = readOnly ? { readOnly: true, variant: 'unstyled' as const } : {}
  const lockSelect = readOnly ? { readOnly: true, variant: 'unstyled' as const, rightSection: <span /> } : {}

  const title = mode === 'create' ? 'New Party' : mode === 'edit' ? 'Edit Party' : 'Party details'

  return (
    <FormModal
      opened
      size="xl"
      title={title}
      saveLabel="Save Party"
      cancelLabel={readOnly ? 'Close' : 'Cancel'}
      readOnly={readOnly}
      saveDisabled={codeTaken}
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values))()}
    >
      {/* Two columns from 768px up, one below - Grid.Col spans are per breakpoint. */}
      <Grid gap="md">
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput
            label="Party Code"
            placeholder="SUP-0001"
            withAsterisk
            maxLength={MAX_CODE}
            {...lock}
            {...form.getInputProps('partyCode')}
            onChange={(event) => {
              codeTouched.current = true
              // A different code is a different question, so the old verdict goes with it.
              setCodeTaken(false)
              form.clearFieldError('partyCode')
              form.getInputProps('partyCode').onChange(event)
            }}
            onBlur={(event) => {
              form.getInputProps('partyCode').onBlur?.(event)
              void checkCodeAvailable()
            }}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput
            label="Party Name"
            placeholder="TVS Motor Company"
            withAsterisk
            maxLength={MAX_NAME}
            {...lock}
            {...form.getInputProps('partyName')}
          />
        </Grid.Col>

        <Grid.Col span={12}>
          <Checkbox.Group
            label="Party Type"
            description="A party can be several of these at once."
            withAsterisk
            value={form.values.types}
            onChange={handleTypesChange}
            error={form.errors.types}
          >
            <Group mt="xs" gap="lg" wrap="wrap">
              {PARTY_TYPES.map((type) => (
                <Checkbox
                  key={type.value}
                  value={type.value}
                  label={type.label}
                  color={type.color}
                  disabled={readOnly}
                />
              ))}
            </Group>
          </Checkbox.Group>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6 }}>
          <Select
            label="Branch"
            placeholder="No branch"
            data={branches.map((b) => ({ value: String(b.id), label: `${b.branchCode} - ${b.branchName}` }))}
            searchable
            clearable
            nothingFoundMessage="No branch found"
            {...lockSelect}
            {...form.getInputProps('branchId')}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput
            label="Contact Person"
            placeholder="Priya Raman"
            maxLength={MAX_CONTACT}
            {...lock}
            {...form.getInputProps('contactPerson')}
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput
            label="Phone"
            placeholder="+91 44 2834 0000"
            maxLength={MAX_PHONE}
            {...lock}
            {...form.getInputProps('phone')}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput
            label="Mobile"
            placeholder="+91 98400 00000"
            maxLength={MAX_PHONE}
            {...lock}
            {...form.getInputProps('mobile')}
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput
            label="Email"
            placeholder="contact@example.com"
            maxLength={MAX_EMAIL}
            {...lock}
            {...form.getInputProps('email')}
            // Checked when the reader leaves the box, not on every keystroke: an address is
            // invalid for as long as it is half-typed, and saying so is only noise.
            onBlur={(event) => {
              form.getInputProps('email').onBlur?.(event)
              form.validateField('email')
            }}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <Select
            label="Country"
            placeholder="No country"
            data={countryOptions}
            searchable
            clearable
            nothingFoundMessage="No country found"
            {...lockSelect}
            {...form.getInputProps('country')}
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6 }}>
          <Textarea
            label="Address"
            placeholder="Street, city, postal code..."
            autosize
            minRows={3}
            maxLength={MAX_ADDRESS}
            {...lock}
            {...form.getInputProps('address')}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput
            label="Tax / Registration No."
            placeholder="GSTIN, VAT or registration number"
            maxLength={MAX_TAX}
            {...lock}
            {...form.getInputProps('taxRegistrationNo')}
          />
        </Grid.Col>

        {/* Each of these belongs to a type: it appears when that type is ticked and its value is
            cleared when it is unticked, so the form never carries a setting it is not showing. */}
        {/* The default price list belongs to the party itself, not to one of its roles, so it is
            always offered - a supplier, a client and a salesman may each carry one. */}
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <Select
            label="Default Price List"
            placeholder="No default price list"
            description="Pre-filled on invoices for this party; can be changed on the invoice"
            data={priceListOptions}
            searchable
            clearable
            nothingFoundMessage="No price list found"
            {...lockSelect}
            {...form.getInputProps('defaultPriceListId')}
          />
        </Grid.Col>

        {isSupplier ? (
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <Select
              label="Default Currency"
              placeholder="No default currency"
              description="Used by default on this supplier's purchases."
              data={currencies.map((c) => ({ value: String(c.id), label: `${c.currencyCode} - ${c.currencyName}` }))}
              searchable
              clearable
              nothingFoundMessage="No currency found"
              {...lockSelect}
              {...form.getInputProps('defaultCurrencyId')}
            />
          </Grid.Col>
        ) : null}

        {isPerson ? (
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <Select
              label="Linked user"
              placeholder="No linked user"
              description="Lets the system recognise this person when they sign in"
              data={users.map((u) => ({ value: String(u.id), label: `${u.fullName} (${u.username})` }))}
              searchable
              clearable
              nothingFoundMessage="No user found"
              {...lockSelect}
              {...form.getInputProps('userId')}
            />
          </Grid.Col>
        ) : null}

        <Grid.Col span={12}>
          <Textarea
            label="Notes"
            placeholder="Anything worth remembering about this party..."
            autosize
            minRows={3}
            maxLength={MAX_NOTES}
            inputWrapperOrder={['label', 'input', 'description', 'error']}
            description={`${form.values.notes.length}/${MAX_NOTES}`}
            styles={{ description: { textAlign: 'right' } }}
            {...lock}
            {...form.getInputProps('notes')}
          />
        </Grid.Col>

        <Grid.Col span={12}>
          <Input.Wrapper label="Status">
            <Switch
              mt={6}
              label="Yes, this party is active"
              disabled={readOnly}
              {...form.getInputProps('isActive', { type: 'checkbox' })}
            />
          </Input.Wrapper>
        </Grid.Col>

        {formError ? (
          <Grid.Col span={12}>
            <Alert color="red">
              {formError}
              {stale ? (
                <>
                  {' '}
                  <Anchor component="button" type="button" onClick={() => void reload()}>
                    Reload
                  </Anchor>{' '}
                  the party to get the latest values and try again.
                </>
              ) : null}
            </Alert>
          </Grid.Col>
        ) : null}
      </Grid>
    </FormModal>
  )
}

/** The types a party carries, as the values Checkbox.Group works in. */
function initialTypes(party?: PartyDto): PartyTypeName[] {
  if (!party) return []
  return PARTY_TYPES.filter((type) => party[type.flag]).map((type) => type.value)
}

function toNumber(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
