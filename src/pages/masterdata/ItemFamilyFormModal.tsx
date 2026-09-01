import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Group, Select, Switch, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { ApiError } from '../../api/http'
import { itemFamiliesApi } from '../../api/masterdata/itemFamilies'
import type { ItemFamilyDto, SaveItemFamilyRequest } from '../../api/types'
import { confirm } from '../../components/ui/confirm'
import { FormModal } from '../../components/ui/FormModal'
import { notify } from '../../components/ui/notify'
import { descendants, indexFamilies, parentOptionLabel } from './itemFamilyTree'

interface ItemFamilyFormModalProps {
  mode: 'create' | 'edit'
  /** The family being edited. */
  family?: ItemFamilyDto
  /** Parent preselected when creating - set by the "Add child family" row action. */
  initialParentId?: number | null
  /** The whole tree, as the page loaded it: the parent dropdown and the cascade warning read it. */
  families: ItemFamilyDto[]
  onClose(): void
  onSaved(): void
  /** Someone else changed this family first: the page reloads the tree and drops the form. */
  onStale(): void
}

interface FormValues {
  familyCode: string
  familyName: string
  /** Mantine's Select speaks strings; null is a root family. */
  parentId: string | null
  description: string
  isActive: boolean
}

const MAX_CODE = 50
const MAX_NAME = 150
const MAX_DESCRIPTION = 500

export function ItemFamilyFormModal({
  mode,
  family,
  initialParentId,
  families,
  onClose,
  onSaved,
  onStale,
}: ItemFamilyFormModalProps) {
  const [rowVersion] = useState(family?.rowVersion ?? null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Once the code has been typed in, the suggestion stops chasing the parent: the reader's own
  // code must not be overwritten by a dropdown they touch afterwards.
  const [codeTouched, setCodeTouched] = useState(mode === 'edit')

  const form = useForm<FormValues>({
    initialValues: {
      familyCode: family?.familyCode ?? '',
      familyName: family?.familyName ?? '',
      parentId: parentValue(mode === 'edit' ? (family?.parentId ?? null) : (initialParentId ?? null)),
      description: family?.description ?? '',
      isActive: family?.isActive ?? true,
    },
    validate: {
      familyCode: (value) => {
        const code = value.trim()
        if (!code) return 'Family Code is required.'
        if (code.length > MAX_CODE) return `Family Code cannot be longer than ${MAX_CODE} characters.`
        return null
      },
      familyName: (value) => {
        const name = value.trim()
        if (!name) return 'Family Name is required.'
        if (name.length > MAX_NAME) return `Family Name cannot be longer than ${MAX_NAME} characters.`
        return null
      },
      description: (value) =>
        value.length > MAX_DESCRIPTION ? `Description cannot be longer than ${MAX_DESCRIPTION} characters.` : null,
    },
  })

  // The suggestion effect below needs the live form without listing it as a dependency -
  // @mantine/form hands back a new object every render, which would restart the request on every
  // keystroke. This effect is declared first, so the ref is current by the time that one runs.
  const formRef = useRef(form)
  useEffect(() => {
    formRef.current = form
  })

  const index = useMemo(() => indexFamilies(families), [families])

  /** The families that may be this one's parent: everything except itself and its own subtree. */
  const parentOptions = useMemo(() => {
    const blocked = new Set<number>()
    if (mode === 'edit' && family) {
      blocked.add(family.id)
      for (const child of descendants(index, family.id)) blocked.add(child.id)
    }

    return [...index.byId.values()]
      .filter((f) => !blocked.has(f.id))
      .sort((a, b) => a.familyCode.localeCompare(b.familyCode))
      .map((f) => ({
        value: String(f.id),
        label: parentOptionLabel(f),
        // An active family cannot live under an inactive parent, so the option is closed rather
        // than offered and refused by the API a moment later.
        disabled: !f.isActive && form.values.isActive,
      }))
  }, [index, mode, family, form.values.isActive])

  const selectedParentId = form.values.parentId === null ? null : Number(form.values.parentId)

  /** Sub-families that a deactivation here would take down with it. */
  const descendantCount = useMemo(
    () => (mode === 'edit' && family ? descendants(index, family.id).length : 0),
    [index, mode, family],
  )

  // A new family's code is suggested from its parent (FAM-002 -> FAM-002-01) and re-suggested
  // whenever the parent changes, until the reader types a code of their own.
  useEffect(() => {
    if (mode !== 'create' || codeTouched) return

    const controller = new AbortController()
    itemFamiliesApi
      .nextCode(selectedParentId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) formRef.current.setFieldValue('familyCode', next.suggestedCode)
      })
      .catch(() => {
        // A suggestion that cannot be fetched is not worth an error: the field stays editable.
      })

    return () => controller.abort()
  }, [mode, codeTouched, selectedParentId])

  function buildPayload(values: FormValues): SaveItemFamilyRequest {
    return {
      familyCode: values.familyCode.trim(),
      familyName: values.familyName.trim(),
      parentId: values.parentId === null ? null : Number(values.parentId),
      description: values.description.trim() ? values.description.trim() : null,
      isActive: values.isActive,
      ...(mode === 'edit' ? { rowVersion } : {}),
    }
  }

  async function submit(values: FormValues) {
    // Turning a family off takes its whole subtree with it, so the count is named before the save
    // rather than discovered in the grid afterwards.
    if (!values.isActive && descendantCount > 0) {
      const proceed = await confirm({
        title: 'Deactivate item family',
        message: `Deactivating ${values.familyName.trim() || (family?.familyName ?? 'this family')} also deactivates its ${descendantCount} ${descendantCount === 1 ? 'sub-family' : 'sub-families'}. Continue?`,
        confirmLabel: 'Deactivate',
      })
      if (!proceed) return
    }

    setSaving(true)
    setFormError(null)

    try {
      const payload = buildPayload(values)
      if (mode === 'create') await itemFamiliesApi.create(payload)
      else await itemFamiliesApi.update((family as ItemFamilyDto).id, payload)

      onSaved()
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  function handleError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError('The item family could not be saved.')
      return
    }

    switch (error.code) {
      case 'DUPLICATE_CODE':
        form.setErrors({ familyCode: 'A family with this Family Code already exists.' })
        return
      case 'DUPLICATE_NAME':
        form.setErrors({ familyName: 'A family with this name already exists under the same parent.' })
        return
      // Both are the parent's fault: an ancestor of itself, or a parent that is switched off.
      case 'CIRCULAR_HIERARCHY':
      case 'PARENT_INACTIVE':
        form.setErrors({ parentId: error.messages.join(' ') })
        return
      case 'CONCURRENCY':
        notify.error(error.messages.join(' '))
        onStale()
        return
      default:
        break
    }

    // ASP.NET model validation: map the messages back onto the fields they belong to.
    const mapped: Record<string, string> = {}
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      const key = field.toLowerCase()
      const message = messages.join(' ')
      if (key.includes('familycode')) mapped.familyCode = message
      else if (key.includes('familyname')) mapped.familyName = message
      else if (key.includes('parentid')) mapped.parentId = message
      else if (key.includes('description')) mapped.description = message
    }

    if (Object.keys(mapped).length > 0) {
      form.setErrors(mapped)
      return
    }

    setFormError(error.messages.join(' '))
  }

  return (
    <FormModal
      opened
      title={mode === 'create' ? 'New Item Family' : 'Edit Item Family'}
      saveLabel="Save Family"
      saving={saving}
      onClose={onClose}
      onSubmit={() => form.onSubmit((values) => void submit(values))()}
    >
      <Group grow align="flex-start">
        <TextInput
          label="Family Code"
          placeholder="FAM-001"
          description={mode === 'create' ? 'Suggested from the parent; edit it if you prefer your own.' : undefined}
          withAsterisk
          maxLength={MAX_CODE}
          {...form.getInputProps('familyCode')}
          onChange={(event) => {
            setCodeTouched(true)
            form.setFieldValue('familyCode', event.currentTarget.value)
          }}
        />
        <TextInput
          label="Family Name"
          placeholder="Engine Parts"
          withAsterisk
          maxLength={MAX_NAME}
          {...form.getInputProps('familyName')}
        />
      </Group>

      <Select
        label="Parent Family"
        placeholder="No parent (root family)"
        description="Leave blank to create a root family."
        data={parentOptions}
        searchable
        clearable
        nothingFoundMessage="No family matches that."
        {...form.getInputProps('parentId')}
      />

      <Textarea
        label="Description"
        placeholder="What belongs in this family..."
        autosize
        minRows={3}
        maxLength={MAX_DESCRIPTION}
        // The counter belongs under the box it counts, not above the label.
        inputWrapperOrder={['label', 'input', 'description', 'error']}
        description={`${form.values.description.length}/${MAX_DESCRIPTION}`}
        styles={{ description: { textAlign: 'right' } }}
        {...form.getInputProps('description')}
      />

      <Switch
        label="Active"
        description={
          descendantCount > 0
            ? `Switching this off also deactivates its ${descendantCount} ${descendantCount === 1 ? 'sub-family' : 'sub-families'}.`
            : 'A family can only be active while its parent is.'
        }
        {...form.getInputProps('isActive', { type: 'checkbox' })}
      />

      {formError ? <Alert color="red">{formError}</Alert> : null}
    </FormModal>
  )
}

function parentValue(parentId: number | null): string | null {
  return parentId === null ? null : String(parentId)
}
