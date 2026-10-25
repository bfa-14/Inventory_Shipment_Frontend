import { useState } from 'react'
import { Alert } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { ApiError } from '../../api/http'
import {
  transfersApi,
  type TransferActionResult,
  type TransferOrderDto,
  type TransferPostingDto,
} from '../../api/inventory/transfers'
import { fromIsoDate, isoDate } from '../documents/documentKind'
import { FormModal } from '../ui/FormModal'
import { notify } from '../ui/notify'
import { useCalendarEscape } from '../ui/useCalendarEscape'

interface ChangeEtaModalProps {
  opened: boolean
  order: TransferOrderDto
  posting: TransferPostingDto
  onClose(): void
  onSaved(result: TransferActionResult): void
  /** Refused because someone else changed the order: the page reads it again. */
  onStale(): void
}

/**
 * "Change ETA - {TRD}" (decision D12): trucks are late. A dispatch with goods on the way takes a new ETA, never before
 * the day it left; the order's Late follows it.
 */
export function ChangeEtaModal({ opened, order, posting, onClose, onSaved, onStale }: ChangeEtaModalProps) {
  const [eta, setEta] = useState<string | null>(posting.eta)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { calendarOpen, calendar } = useCalendarEscape()

  async function submit() {
    if (!eta) {
      setError('The ETA is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await transfersApi.changeEta(order.id, posting.id, { rowVersion: order.rowVersion, eta })
      notify.success(result.message)
      onSaved(result)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The ETA could not be changed.'
      setError(message)
      if (err instanceof ApiError && (err.code === 'CONCURRENCY' || /modified by another user/i.test(message)))
        onStale()
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormModal
      opened={opened}
      title={`Change ETA - ${posting.documentNumber}`}
      onSubmit={() => void submit()}
      onClose={onClose}
      saving={busy}
      saveLabel="Save"
      size="sm"
      closeOnEscape={!calendarOpen}
    >
      <DateInput
        label="ETA"
        withAsterisk
        valueFormat="DD/MM/YYYY"
        value={fromIsoDate(eta)}
        onChange={(next) => {
          setError(null)
          setEta(next ? isoDate(next) : null)
        }}
        minDate={fromIsoDate(posting.postingDate) ?? undefined}
        disabled={busy}
        popoverProps={calendar('eta')}
      />
      {error && <Alert color="red">{error}</Alert>}
    </FormModal>
  )
}
