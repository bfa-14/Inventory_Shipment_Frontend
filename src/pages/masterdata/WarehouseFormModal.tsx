import { useEffect, useState } from 'react'
import { Alert, Anchor, Checkbox, Group, Select, Switch, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BranchLookupDto, SaveWarehouseRequest, WarehouseDto, WarehouseLookupDto } from '../../api/types'
import { branchLabel } from '../../components/format'
import { confirm } from '../../components/ui/confirm'
import { FormModal } from '../../components/ui/FormModal'

interface WarehouseFormModalProps {
  mode: 'create' | 'edit'
  warehouse?: WarehouseDto
  onClose(): void
  onSaved(warehouse: WarehouseDto): void
}

interface FormValues {
  warehouseCode: string
  warehouseName: string
  branchId: string | null
  parentId: string | null
  address: string
  isMainWarehouse: boolean
  isActive: boolean
}

const MAX_CODE = 20
const MAX_NAME = 150
const MAX_ADDRESS = 500

/**
 * The warehouses this one may be filed under: everything except itself and its own descendants.
 *
 * A WAREHOUSE CANNOT MOVE INSIDE ITSELF. The procedure refuses it too - that is where the rule
 * really lives - but a picker that offers the impossible and then reports an error is a worse way
 * to learn it. The walk down is iterative and remembers what it has seen, so a cycle left by older
 * data stops rather than spinning.
 */
function eligibleParents(warehouses: WarehouseLookupDto[], selfId: number | undefined): WarehouseLookupDto[] {
  if (selfId === undefined) return warehouses

  const banned = new Set<number>([selfId])
  let added = true
  while (added) {
    added = false
    for (const warehouse of warehouses) {
      if (warehouse.parentId !== null && banned.has(warehouse.parentId) && !banned.has(warehouse.id)) {
        banned.add(warehouse.id)
        added = true
      }
    }
  }

  return warehouses.filter((warehouse) => !banned.has(warehouse.id))
}

export function WarehouseFormModal({ mode, warehouse, onClose, onSaved }: WarehouseFormModalProps) {
  const [rowVersion, setRowVersion] = useState(warehouse?.rowVersion ?? null)
  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  const form = useForm<FormValues>({
    initialValues: {
      warehouseCode: warehouse?.warehouseCode ?? '',
      warehouseName: warehouse?.warehouseName ?? '',
      branchId: warehouse ? String(warehouse.branchId) : null,
      parentId: warehouse?.parentId != null ? String(warehouse.parentId) : null,
      address: warehouse?.address ?? '',
      isMainWarehouse: warehouse?.isMainWarehouse ?? false,
      isActive: warehouse?.isActive ?? true,
    },
    validate: {
      warehouseCode: (value) => {
        const code = value.trim()
        if (!code) return 'Warehouse Code is required.'
        if (code.length > MAX_CODE) return `Warehouse Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      warehouseName: (value) => {
        const name = value.trim()
        if (!name) return 'Warehouse Name is required.'
        if (name.length > MAX_NAME) return `Warehouse Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
      branchId: (value) => (value ? null : 'Branch / Site is required.'),
      address: (value) =>
        value.trim().length > MAX_ADDRESS ? `Address cannot be longer than ${MAX_ADDRESS} characters.` : null,
    },
  })

  // Active branches only, plus the one this warehouse already points at even if it went inactive.
  useEffect(() => {
    branchesApi
      .lookup(true, warehouse?.branchId)
      .then(setBranches)
      .catch((error: unknown) => {
        setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The branches could not be loaded.')
      })
  }, [warehouse?.branchId])

  // Every warehouse, of every branch: a parent need not share the branch, and an inactive one
  // still holds its children. Failing here leaves the Parent picker empty rather than the form dead.
  useEffect(() => {
    warehousesApi
      .lookup(false)
      .then(setWarehouses)
      .catch(() => {})
  }, [])

  function buildPayload(values: FormValues, replaceMainWarehouse: boolean): SaveWarehouseRequest {
    return {
      warehouseCode: values.warehouseCode.trim(),
      warehouseName: values.warehouseName.trim(),
      branchId: Number(values.branchId),
      parentId: values.parentId ? Number(values.parentId) : null,
      address: values.address.trim() ? values.address.trim() : null,
      isMainWarehouse: values.isMainWarehouse,
      isActive: values.isActive,
      replaceMainWarehouse,
      ...(mode === 'edit' ? { rowVersion } : {}),
    }
  }

  async function save(values: FormValues, replaceMainWarehouse: boolean) {
    setSaving(true)
    setFormError(null)
    setStale(false)

    try {
      const payload = buildPayload(values, replaceMainWarehouse)
      const saved =
        mode === 'create'
          ? await warehousesApi.create(payload)
          : await warehousesApi.update((warehouse as WarehouseDto).id, payload)

      onSaved(saved)
    } catch (error) {
      await handleError(error, values)
    } finally {
      setSaving(false)
    }
  }

  async function handleError(error: unknown, values: FormValues) {
    if (!(error instanceof ApiError)) {
      setFormError('The warehouse could not be saved.')
      return
    }

    if (error.code === 'MAIN_WAREHOUSE_EXISTS') {
      const current = (error.data as { currentMainWarehouse?: WarehouseDto } | undefined)?.currentMainWarehouse
      if (current) {
        const replace = await confirm({
          title: 'Replace Main Warehouse',
          message: `${current.warehouseCode} - ${current.warehouseName} is currently the Main Warehouse. Make ${values.warehouseCode.trim()} the Main Warehouse instead?`,
          confirmLabel: 'Replace Main Warehouse',
        })
        if (replace) await save(values, true)
        return
      }
    }

    if (error.code === 'DUPLICATE_CODE') {
      form.setErrors({ warehouseCode: 'A warehouse with this Warehouse Code already exists.' })
      return
    }

    if (error.code === 'BRANCH_INACTIVE') {
      form.setErrors({ branchId: error.messages[0] })
      return
    }

    if (error.code === 'CONCURRENCY') {
      setStale(true)
      setFormError(error.messages.join(' '))
      return
    }

    // ASP.NET model validation: map the messages back onto the fields they belong to.
    const mapped: Record<string, string> = {}
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      const key = field.toLowerCase()
      const message = messages.join(' ')
      if (key.includes('warehousecode')) mapped.warehouseCode = message
      else if (key.includes('warehousename')) mapped.warehouseName = message
      else if (key.includes('branchid')) mapped.branchId = message
      else if (key.includes('address')) mapped.address = message
    }

    if (Object.keys(mapped).length > 0) {
      form.setErrors(mapped)
      return
    }

    setFormError(error.messages.join(' '))
  }

  /** After a concurrency conflict: pull the current row back into the form. */
  async function reload() {
    if (!warehouse) return
    try {
      const fresh = await warehousesApi.get(warehouse.id)
      form.setValues({
        warehouseCode: fresh.warehouseCode,
        warehouseName: fresh.warehouseName,
        branchId: String(fresh.branchId),
        address: fresh.address ?? '',
        isMainWarehouse: fresh.isMainWarehouse,
        isActive: fresh.isActive,
      })
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The warehouse could not be reloaded.')
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Warehouse' : 'Edit Warehouse'}
      saveLabel="Save Warehouse"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values, false))()}
    >
      <Group grow align="flex-start">
        <TextInput
          label="Warehouse Code"
          placeholder="WH-002"
          withAsterisk
          maxLength={MAX_CODE}
          {...form.getInputProps('warehouseCode')}
        />
        <TextInput
          label="Warehouse Name"
          placeholder="Kolwezi Depot"
          withAsterisk
          maxLength={MAX_NAME}
          {...form.getInputProps('warehouseName')}
        />
      </Group>

      <Select
        label="Branch / Site"
        placeholder="Select branch / site"
        withAsterisk
        searchable
        nothingFoundMessage="No branch found"
        data={branches.map((b) => ({ value: String(b.id), label: branchLabel(b) }))}
        {...form.getInputProps('branchId')}
      />

      <Select
        label="Parent Warehouse"
        placeholder="None - a top-level warehouse"
        description="Leave empty for a top-level warehouse. A parent groups the warehouses under it; stock is held by the ones with nothing beneath them."
        searchable
        clearable
        nothingFoundMessage="No warehouse found"
        /* Itself and its own descendants are left out: a warehouse cannot move inside itself, and
           offering the choice only to refuse it afterwards is a worse way to learn that. */
        data={eligibleParents(warehouses, warehouse?.id).map((w) => ({
          value: String(w.id),
          label: `${w.warehouseCode} - ${w.warehouseName}${w.isActive ? '' : ' (inactive)'}`,
        }))}
        {...form.getInputProps('parentId')}
      />

      <Textarea
        label="Address"
        placeholder="Street, city, country"
        autosize
        minRows={3}
        maxLength={MAX_ADDRESS}
        {...form.getInputProps('address')}
      />

      <Group grow align="flex-start">
        <Checkbox
          label="Yes, this is the main warehouse"
          description="Is Main Warehouse"
          {...form.getInputProps('isMainWarehouse', { type: 'checkbox' })}
          onChange={(event) => {
            const checked = event.currentTarget.checked
            form.setFieldValue('isMainWarehouse', checked)
            // The API refuses an inactive main warehouse, so keep the pair valid here.
            if (checked) form.setFieldValue('isActive', true)
          }}
        />

        <Switch
          label="Active"
          description={form.values.isMainWarehouse ? 'The main warehouse is always active.' : undefined}
          disabled={form.values.isMainWarehouse}
          {...form.getInputProps('isActive', { type: 'checkbox' })}
        />
      </Group>

      {formError ? (
        <Alert color="red">
          {formError}
          {stale ? (
            <>
              {' '}
              <Anchor component="button" type="button" onClick={reload}>
                Reload
              </Anchor>{' '}
              the warehouse to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}
