import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../../api/http'
import { branchesApi } from '../../api/masterdata/branches'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { BranchLookupDto, SaveWarehouseRequest, WarehouseDto } from '../../api/types'
import { Alert } from '../../components/Alert'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Modal } from '../../components/ui/Modal'
import { branchLabel } from '../../components/format'

interface WarehouseFormModalProps {
  mode: 'create' | 'edit'
  warehouse?: WarehouseDto
  onClose(): void
  onSaved(warehouse: WarehouseDto): void
}

interface FieldErrors {
  warehouseCode?: string
  warehouseName?: string
  branchId?: string
  address?: string
}

const MAX_CODE = 20
const MAX_NAME = 150
const MAX_ADDRESS = 500

export function WarehouseFormModal({ mode, warehouse, onClose, onSaved }: WarehouseFormModalProps) {
  const [warehouseCode, setWarehouseCode] = useState(warehouse?.warehouseCode ?? '')
  const [warehouseName, setWarehouseName] = useState(warehouse?.warehouseName ?? '')
  const [branchId, setBranchId] = useState(warehouse ? String(warehouse.branchId) : '')
  const [address, setAddress] = useState(warehouse?.address ?? '')
  const [isMainWarehouse, setIsMainWarehouse] = useState(warehouse?.isMainWarehouse ?? false)
  const [isActive, setIsActive] = useState(warehouse?.isActive ?? true)
  const [rowVersion, setRowVersion] = useState(warehouse?.rowVersion ?? null)

  const [branches, setBranches] = useState<BranchLookupDto[]>([])
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [replacePrompt, setReplacePrompt] = useState<WarehouseDto | null>(null)

  const title = mode === 'create' ? 'New Warehouse' : 'Edit Warehouse'

  // Active branches only, plus the one this warehouse already points at even if it went inactive.
  useEffect(() => {
    branchesApi
      .lookup(true, warehouse?.branchId)
      .then(setBranches)
      .catch((error: unknown) => {
        setFormErrors(error instanceof ApiError ? error.messages : ['The branches could not be loaded.'])
      })
  }, [warehouse?.branchId])

  /** A field stops showing its error as soon as the user edits it. */
  function clearError(field: keyof FieldErrors) {
    setFieldErrors((errors) => (errors[field] ? { ...errors, [field]: undefined } : errors))
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    const code = warehouseCode.trim()
    const name = warehouseName.trim()

    if (!code) errors.warehouseCode = 'Warehouse Code is required.'
    else if (code.length > MAX_CODE) errors.warehouseCode = `Warehouse Code cannot be longer than ${MAX_CODE} characters.`

    if (!name) errors.warehouseName = 'Warehouse Name is required.'
    else if (name.length > MAX_NAME) errors.warehouseName = `Warehouse Name cannot be longer than ${MAX_NAME} characters.`

    if (!branchId) errors.branchId = 'Branch / Site is required.'

    if (address.trim().length > MAX_ADDRESS) errors.address = `Address cannot be longer than ${MAX_ADDRESS} characters.`

    return errors
  }

  function buildPayload(replaceMainWarehouse: boolean): SaveWarehouseRequest {
    return {
      warehouseCode: warehouseCode.trim(),
      warehouseName: warehouseName.trim(),
      branchId: Number(branchId),
      address: address.trim() ? address.trim() : null,
      isMainWarehouse,
      isActive,
      replaceMainWarehouse,
      ...(mode === 'edit' ? { rowVersion } : {}),
    }
  }

  async function save(replaceMainWarehouse: boolean) {
    setSaving(true)
    setFormErrors([])
    setStale(false)

    try {
      const payload = buildPayload(replaceMainWarehouse)
      const saved =
        mode === 'create'
          ? await warehousesApi.create(payload)
          : await warehousesApi.update((warehouse as WarehouseDto).id, payload)

      onSaved(saved)
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  function handleError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormErrors(['The warehouse could not be saved.'])
      return
    }

    if (error.code === 'MAIN_WAREHOUSE_EXISTS') {
      const current = (error.data as { currentMainWarehouse?: WarehouseDto } | undefined)?.currentMainWarehouse
      if (current) {
        setReplacePrompt(current)
        return
      }
    }

    if (error.code === 'DUPLICATE_CODE') {
      setFieldErrors({ warehouseCode: 'A warehouse with this Warehouse Code already exists.' })
      return
    }

    if (error.code === 'BRANCH_INACTIVE') {
      setFieldErrors({ branchId: error.messages[0] })
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
      if (key.includes('warehousecode')) mapped.warehouseCode = message
      else if (key.includes('warehousename')) mapped.warehouseName = message
      else if (key.includes('branchid')) mapped.branchId = message
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
    if (!warehouse) return
    try {
      const fresh = await warehousesApi.get(warehouse.id)
      setWarehouseCode(fresh.warehouseCode)
      setWarehouseName(fresh.warehouseName)
      setBranchId(String(fresh.branchId))
      setAddress(fresh.address ?? '')
      setIsMainWarehouse(fresh.isMainWarehouse)
      setIsActive(fresh.isActive)
      setRowVersion(fresh.rowVersion)
      setStale(false)
      setFormErrors([])
    } catch (error) {
      setFormErrors(error instanceof ApiError ? error.messages : ['The warehouse could not be reloaded.'])
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
            <button type="submit" form="warehouse-form" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Warehouse'}
            </button>
          </>
        }
      >
        <form id="warehouse-form" className="branch-form" onSubmit={handleSubmit} noValidate>
          <div className="branch-form__row">
            <label className="field">
              <span className="field__label">
                Warehouse Code <span className="field__required">*</span>
              </span>
              <input
                type="text"
                value={warehouseCode}
                maxLength={MAX_CODE}
                placeholder="WH-002"
                aria-invalid={fieldErrors.warehouseCode ? true : undefined}
                onChange={(e) => {
                  setWarehouseCode(e.target.value)
                  clearError('warehouseCode')
                }}
              />
              {fieldErrors.warehouseCode ? <span className="field__error">{fieldErrors.warehouseCode}</span> : null}
            </label>

            <label className="field">
              <span className="field__label">
                Warehouse Name <span className="field__required">*</span>
              </span>
              <input
                type="text"
                value={warehouseName}
                maxLength={MAX_NAME}
                placeholder="Kolwezi Depot"
                aria-invalid={fieldErrors.warehouseName ? true : undefined}
                onChange={(e) => {
                  setWarehouseName(e.target.value)
                  clearError('warehouseName')
                }}
              />
              {fieldErrors.warehouseName ? <span className="field__error">{fieldErrors.warehouseName}</span> : null}
            </label>
          </div>

          <label className="field">
            <span className="field__label">
              Branch / Site <span className="field__required">*</span>
            </span>
            <select
              value={branchId}
              aria-invalid={fieldErrors.branchId ? true : undefined}
              onChange={(e) => {
                setBranchId(e.target.value)
                clearError('branchId')
              }}
            >
              <option value="">Select branch / site</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branchLabel(branch)}
                </option>
              ))}
            </select>
            {fieldErrors.branchId ? <span className="field__error">{fieldErrors.branchId}</span> : null}
          </label>

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
                Is Main Warehouse <span className="field__required">*</span>
              </span>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={isMainWarehouse}
                  onChange={(e) => {
                    setIsMainWarehouse(e.target.checked)
                    // The API refuses an inactive main warehouse, so keep the pair valid here.
                    if (e.target.checked) setIsActive(true)
                  }}
                />
                <span>Yes, this is the main warehouse</span>
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
                  disabled={isMainWarehouse}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <span className="switch" aria-hidden="true" />
                <span>Active</span>
              </label>
              {isMainWarehouse ? <span className="field__hint">The main warehouse is always active.</span> : null}
            </div>
          </div>

          <Alert kind="error" messages={formErrors} />

          {stale ? (
            <p className="field__hint">
              <button type="button" className="link-button" onClick={reload}>
                Reload
              </button>{' '}
              the warehouse to get the latest values and try again.
            </p>
          ) : null}
        </form>
      </Modal>

      {replacePrompt ? (
        <ConfirmDialog
          title="Replace Main Warehouse"
          message={`${replacePrompt.warehouseCode} - ${replacePrompt.warehouseName} is currently the Main Warehouse. Make ${warehouseCode.trim()} the Main Warehouse instead?`}
          confirmLabel="Replace Main Warehouse"
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
