import { useState, type FormEvent } from 'react'
import { branchesApi } from '../../api/masterdata/branches'
import { ApiError } from '../../api/http'
import type { BranchDto, SaveBranchRequest } from '../../api/types'
import { Alert } from '../../components/Alert'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Modal } from '../../components/ui/Modal'

interface BranchFormModalProps {
  mode: 'create' | 'edit'
  branch?: BranchDto
  onClose(): void
  onSaved(branch: BranchDto): void
}

interface FieldErrors {
  branchCode?: string
  branchName?: string
  address?: string
}

const MAX_CODE = 20
const MAX_NAME = 150
const MAX_ADDRESS = 500

export function BranchFormModal({ mode, branch, onClose, onSaved }: BranchFormModalProps) {
  const [branchCode, setBranchCode] = useState(branch?.branchCode ?? '')
  const [branchName, setBranchName] = useState(branch?.branchName ?? '')
  const [address, setAddress] = useState(branch?.address ?? '')
  const [isMainBranch, setIsMainBranch] = useState(branch?.isMainBranch ?? false)
  const [isActive, setIsActive] = useState(branch?.isActive ?? true)
  const [rowVersion, setRowVersion] = useState(branch?.rowVersion ?? null)

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [replacePrompt, setReplacePrompt] = useState<BranchDto | null>(null)

  const title = mode === 'create' ? 'New Branch' : 'Edit Branch'

  /** A field stops showing its error as soon as the user edits it. */
  function clearError(field: keyof FieldErrors) {
    setFieldErrors((errors) => (errors[field] ? { ...errors, [field]: undefined } : errors))
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    const code = branchCode.trim()
    const name = branchName.trim()

    if (!code) errors.branchCode = 'Branch Code is required.'
    else if (code.length > MAX_CODE) errors.branchCode = `Branch Code cannot be longer than ${MAX_CODE} characters.`

    if (!name) errors.branchName = 'Branch Name is required.'
    else if (name.length > MAX_NAME) errors.branchName = `Branch Name cannot be longer than ${MAX_NAME} characters.`

    if (address.trim().length > MAX_ADDRESS) errors.address = `Address cannot be longer than ${MAX_ADDRESS} characters.`

    return errors
  }

  function buildPayload(replaceMainBranch: boolean): SaveBranchRequest {
    return {
      branchCode: branchCode.trim(),
      branchName: branchName.trim(),
      address: address.trim() ? address.trim() : null,
      isMainBranch,
      isActive,
      replaceMainBranch,
      ...(mode === 'edit' ? { rowVersion } : {}),
    }
  }

  async function save(replaceMainBranch: boolean) {
    setSaving(true)
    setFormErrors([])
    setStale(false)

    try {
      const payload = buildPayload(replaceMainBranch)
      const saved =
        mode === 'create'
          ? await branchesApi.create(payload)
          : await branchesApi.update((branch as BranchDto).id, payload)

      onSaved(saved)
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  function handleError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormErrors(['The branch could not be saved.'])
      return
    }

    if (error.code === 'MAIN_BRANCH_EXISTS') {
      const current = (error.data as { currentMainBranch?: BranchDto } | undefined)?.currentMainBranch
      if (current) {
        setReplacePrompt(current)
        return
      }
    }

    if (error.code === 'DUPLICATE_CODE') {
      setFieldErrors({ branchCode: 'A branch with this Branch Code already exists.' })
      return
    }

    if (error.code === 'CONCURRENCY') {
      setStale(true)
      setFormErrors(error.messages)
      return
    }

    // ASP.NET model validation: map the messages back onto the fields they belong to.
    const mapped: FieldErrors = {}
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      const key = field.toLowerCase()
      const message = messages.join(' ')
      if (key.includes('branchcode')) mapped.branchCode = message
      else if (key.includes('branchname')) mapped.branchName = message
      else if (key.includes('address')) mapped.address = message
    }

    if (Object.keys(mapped).length > 0) {
      setFieldErrors(mapped)
      return
    }

    setFormErrors(error.messages)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    await save(false)
  }

  /** After a concurrency conflict: pull the current row back into the form. */
  async function reload() {
    if (!branch) return
    try {
      const fresh = await branchesApi.get(branch.id)
      setBranchCode(fresh.branchCode)
      setBranchName(fresh.branchName)
      setAddress(fresh.address ?? '')
      setIsMainBranch(fresh.isMainBranch)
      setIsActive(fresh.isActive)
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormErrors([])
    } catch (error) {
      setFormErrors(error instanceof ApiError ? error.messages : ['The branch could not be reloaded.'])
    }
  }

  return (
    <>
      <Modal
        title={title}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="branch-form" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Branch'}
            </button>
          </>
        }
      >
        <form id="branch-form" className="branch-form" onSubmit={handleSubmit} noValidate>
          <div className="branch-form__row">
            <label className="field">
              <span className="field__label">
                Branch Code <span className="field__required">*</span>
              </span>
              <input
                type="text"
                value={branchCode}
                maxLength={MAX_CODE}
                placeholder="BR-002"
                aria-invalid={fieldErrors.branchCode ? true : undefined}
                onChange={(e) => {
                  setBranchCode(e.target.value)
                  clearError('branchCode')
                }}
              />
              {fieldErrors.branchCode ? <span className="field__error">{fieldErrors.branchCode}</span> : null}
            </label>

            <label className="field">
              <span className="field__label">
                Branch Name <span className="field__required">*</span>
              </span>
              <input
                type="text"
                value={branchName}
                maxLength={MAX_NAME}
                placeholder="Kolwezi Branch"
                aria-invalid={fieldErrors.branchName ? true : undefined}
                onChange={(e) => {
                  setBranchName(e.target.value)
                  clearError('branchName')
                }}
              />
              {fieldErrors.branchName ? <span className="field__error">{fieldErrors.branchName}</span> : null}
            </label>
          </div>

          <label className="field">
            <span className="field__label">Address</span>
            <textarea
              rows={3}
              value={address}
              maxLength={MAX_ADDRESS}
              placeholder="Street, city, country"
              aria-invalid={fieldErrors.address ? true : undefined}
              onChange={(e) => {
                setAddress(e.target.value)
                clearError('address')
              }}
            />
            {fieldErrors.address ? <span className="field__error">{fieldErrors.address}</span> : null}
          </label>

          <div className="branch-form__row">
            <div className="field">
              <span className="field__label">
                Is Main Branch <span className="field__required">*</span>
              </span>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={isMainBranch}
                  onChange={(e) => {
                    setIsMainBranch(e.target.checked)
                    // The API refuses an inactive main branch, so keep the pair valid here.
                    if (e.target.checked) setIsActive(true)
                  }}
                />
                <span>Yes, this is the main branch</span>
              </label>
            </div>

            <div className="field">
              <span className="field__label">
                Active <span className="field__required">*</span>
              </span>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={isActive}
                  disabled={isMainBranch}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <span className="switch" aria-hidden="true" />
                <span>Active</span>
              </label>
              {isMainBranch ? <span className="field__hint">The main branch is always active.</span> : null}
            </div>
          </div>

          <Alert kind="error" messages={formErrors} />

          {stale ? (
            <p className="field__hint">
              <button type="button" className="link-button" onClick={reload}>
                Reload
              </button>{' '}
              the branch to get the latest values and try again.
            </p>
          ) : null}
        </form>
      </Modal>

      {replacePrompt ? (
        <ConfirmDialog
          title="Replace Main Branch"
          message={`${replacePrompt.branchCode} - ${replacePrompt.branchName} is currently the Main Branch. Make ${branchCode.trim()} the Main Branch instead?`}
          confirmLabel="Replace Main Branch"
          busy={saving}
          onCancel={() => setReplacePrompt(null)}
          onConfirm={async () => {
            setReplacePrompt(null)
            await save(true)
          }}
        />
      ) : null}
    </>
  )
}
