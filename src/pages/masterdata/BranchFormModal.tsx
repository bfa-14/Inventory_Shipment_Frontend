import { useState } from 'react'
import { Alert, Anchor, Checkbox, Group, Switch, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import type { BranchDto, SaveBranchRequest } from '../../api/types'
import { confirm } from '../../components/ui/confirm'
import { FormModal } from '../../components/ui/FormModal'

interface BranchFormModalProps {
  mode: 'create' | 'edit'
  branch?: BranchDto
  onClose(): void
  onSaved(branch: BranchDto): void
}

interface FormValues {
  branchCode: string
  branchName: string
  address: string
  isMainBranch: boolean
  isActive: boolean
}

const MAX_CODE = 20
const MAX_NAME = 150
const MAX_ADDRESS = 500

export function BranchFormModal({ mode, branch, onClose, onSaved }: BranchFormModalProps) {
  const [rowVersion, setRowVersion] = useState(branch?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)

  const form = useForm<FormValues>({
    initialValues: {
      branchCode: branch?.branchCode ?? '',
      branchName: branch?.branchName ?? '',
      address: branch?.address ?? '',
      isMainBranch: branch?.isMainBranch ?? false,
      isActive: branch?.isActive ?? true,
    },
    validate: {
      branchCode: (value) => {
        const code = value.trim()
        if (!code) return 'Branch Code is required.'
        if (code.length > MAX_CODE) return `Branch Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      branchName: (value) => {
        const name = value.trim()
        if (!name) return 'Branch Name is required.'
        if (name.length > MAX_NAME) return `Branch Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
      address: (value) =>
        value.trim().length > MAX_ADDRESS ? `Address cannot be longer than ${MAX_ADDRESS} characters.` : null,
    },
  })

  function buildPayload(values: FormValues, replaceMainBranch: boolean): SaveBranchRequest {
    return {
      branchCode: values.branchCode.trim(),
      branchName: values.branchName.trim(),
      address: values.address.trim() ? values.address.trim() : null,
      isMainBranch: values.isMainBranch,
      isActive: values.isActive,
      replaceMainBranch,
      ...(mode === 'edit' ? { rowVersion } : {}),
    }
  }

  async function save(values: FormValues, replaceMainBranch: boolean) {
    setSaving(true)
    setFormError(null)
    setStale(false)

    try {
      const payload = buildPayload(values, replaceMainBranch)
      const saved =
        mode === 'create'
          ? await branchesApi.create(payload)
          : await branchesApi.update((branch as BranchDto).id, payload)

      onSaved(saved)
    } catch (error) {
      await handleError(error, values)
    } finally {
      setSaving(false)
    }
  }

  async function handleError(error: unknown, values: FormValues) {
    if (!(error instanceof ApiError)) {
      setFormError('The branch could not be saved.')
      return
    }

    if (error.code === 'MAIN_BRANCH_EXISTS') {
      const current = (error.data as { currentMainBranch?: BranchDto } | undefined)?.currentMainBranch
      if (current) {
        const replace = await confirm({
          title: 'Replace Main Branch',
          message: `${current.branchCode} - ${current.branchName} is currently the Main Branch. Make ${values.branchCode.trim()} the Main Branch instead?`,
          confirmLabel: 'Replace Main Branch',
        })
        if (replace) await save(values, true)
        return
      }
    }

    if (error.code === 'DUPLICATE_CODE') {
      form.setErrors({ branchCode: 'A branch with this Branch Code already exists.' })
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
      if (key.includes('branchcode')) mapped.branchCode = message
      else if (key.includes('branchname')) mapped.branchName = message
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
    if (!branch) return
    try {
      const fresh = await branchesApi.get(branch.id)
      form.setValues({
        branchCode: fresh.branchCode,
        branchName: fresh.branchName,
        address: fresh.address ?? '',
        isMainBranch: fresh.isMainBranch,
        isActive: fresh.isActive,
      })
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormError(null)
    } catch (error) {
      setFormError(error instanceof ApiError ? error.messages.join(' ') : 'The branch could not be reloaded.')
    }
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Branch' : 'Edit Branch'}
      saveLabel="Save Branch"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void save(values, false))()}
    >
      <Group grow align="flex-start">
        <TextInput
          label="Branch Code"
          placeholder="BR-002"
          withAsterisk
          maxLength={MAX_CODE}
          {...form.getInputProps('branchCode')}
        />
        <TextInput
          label="Branch Name"
          placeholder="Kolwezi Branch"
          withAsterisk
          maxLength={MAX_NAME}
          {...form.getInputProps('branchName')}
        />
      </Group>

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
          label="Yes, this is the main branch"
          description="Is Main Branch"
          {...form.getInputProps('isMainBranch', { type: 'checkbox' })}
          onChange={(event) => {
            const checked = event.currentTarget.checked
            form.setFieldValue('isMainBranch', checked)
            // The API refuses an inactive main branch, so keep the pair valid here.
            if (checked) form.setFieldValue('isActive', true)
          }}
        />

        <Switch
          label="Active"
          description={form.values.isMainBranch ? 'The main branch is always active.' : undefined}
          disabled={form.values.isMainBranch}
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
              the branch to get the latest values and try again.
            </>
          ) : null}
        </Alert>
      ) : null}
    </FormModal>
  )
}
