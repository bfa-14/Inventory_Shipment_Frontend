import { useEffect, useMemo, useState } from 'react'
import { Alert, Select, Stack, Text } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { ApiError } from '../../api/http'
import type { StockLevelRowDto } from '../../api/inventory/stockLevels'
import { transferLevelsApi, type CreateTransferFromLevelsResult } from '../../api/inventory/transfers'
import { warehousesApi } from '../../api/masterdata/warehouses'
import type { WarehouseLookupDto } from '../../api/types'
import { fromIsoDate, isoDate } from '../documents/documentKind'
import { formatNumber, todayDateOnly } from '../format'
import { FormModal } from '../ui/FormModal'
import { useCalendarEscape } from '../ui/useCalendarEscape'
import { notify } from '../ui/notify'
import { levelWarehouseChoices } from './levelWarehouses'

export interface CreateTransferFromLevelsModalProps {
  opened: boolean
  /** The destination: every ticked row is of this one warehouse. */
  to: { id: number; code: string; name: string }
  /** The ticked rows (each with a level). */
  rows: StockLevelRowDto[]
  onClose(): void
  /** The draft exists (the server's message already shown): the host opens it. */
  onCreated(result: CreateTransferFromLevelsResult): void
}

/** "1 item", "3 items". */
function items(n: number): string {
  return `${formatNumber(n)} item${n === 1 ? '' : 's'}`
}

/**
 * "CREATE TRANSFER ORDER…" ON INVENTORY › STOCK LEVELS (script 91, rule S14): ONE draft to the ticked rows' warehouse,
 * from a warehouse the reader chooses, each item filled in its base unit to its Max (else Min) and capped at what From
 * has available - the server's Fill rule in Add mode, saved through the transfer order's own Save, in one call. Nothing
 * to transfer: nothing is created and the server's sentence says why, in the dialog. The new order then opens.
 */
export function CreateTransferFromLevelsModal(props: CreateTransferFromLevelsModalProps) {
  return <CreateTransferForm key={props.opened ? 'open' : 'closed'} {...props} />
}

function CreateTransferForm({ opened, to, rows, onClose, onCreated }: CreateTransferFromLevelsModalProps) {
  const today = todayDateOnly()
  // Escape closes an open calendar, not the dialog and the From chosen in it (frontend-conventions).
  const { calendarOpen, calendar } = useCalendarEscape()
  const [warehouses, setWarehouses] = useState<WarehouseLookupDto[]>([])
  const [fromId, setFromId] = useState<string | null>(null)
  const [documentDate, setDocumentDate] = useState<string | null>(today)
  const [expectedArrival, setExpectedArrival] = useState<string | null>(null)
  const [errors, setErrors] = useState<{ from?: string; date?: string; arrival?: string }>({})
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  useEffect(() => {
    warehousesApi
      .lookup(true)
      .then(setWarehouses)
      .catch(() => setServerError('The warehouses could not be loaded.'))
  }, [])

  // From: a warehouse at the bottom of the tree, active, never On the way, never the destination itself.
  const choices = useMemo(() => levelWarehouseChoices(warehouses, to.id), [warehouses, to.id])

  const itemIds = useMemo(() => [...new Set(rows.map((r) => r.itemId))], [rows])
  const belowMin = new Set(rows.filter((r) => r.status === 'BelowMin').map((r) => r.itemId)).size
  const notBelow = itemIds.length - belowMin

  function validate(): boolean {
    const next: typeof errors = {}
    if (fromId === null) next.from = 'Choose the warehouse the goods leave from.'
    if (!documentDate) next.date = 'Order date is required.'
    else if (documentDate > today) next.date = 'The order date cannot be in the future.'
    if (expectedArrival && documentDate && expectedArrival < documentDate)
      next.arrival = 'Expected arrival cannot be before the order date.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (saving || !validate() || fromId === null) return
    setSaving(true)
    setServerError(null)
    try {
      const result = await transferLevelsApi.createFromLevels({
        fromWarehouseId: Number(fromId),
        toWarehouseId: to.id,
        itemIds,
        documentDate,
        expectedArrival,
      })
      notify.success(result.message)
      // As after Fill to Max: each warning orange, as it comes (From below its own Min; other drafts to To that hold
      // these items - a second click makes a second draft for the same shortage, and is told so).
      for (const warning of result.warnings) notify.warning(warning)
      onCreated(result)
    } catch (error) {
      // Nothing to transfer (62009), a warehouse refused (62000): nothing was created; the sentence says why.
      setServerError(error instanceof ApiError ? error.messages.join(' ') : 'The transfer order could not be created.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal
      opened={opened}
      title={`New transfer order to ${to.code}`}
      onSubmit={() => void submit()}
      onClose={onClose}
      saving={saving}
      saveLabel="Create draft"
      closeOnEscape={!calendarOpen}
    >
      <Stack gap="sm">
        <Text fz="sm" data-create-transfer-summary>
          {items(itemIds.length)}, {formatNumber(belowMin)} below Min. Each is filled to its Max (else Min) from the
          warehouse you choose, in pcs, capped at what it has available.
        </Text>
        {notBelow > 0 ? (
          <Alert color="orange" data-create-transfer-not-below>
            {formatNumber(notBelow)} of the ticked items are not below Min: Fill to Max skips them.
          </Alert>
        ) : null}
        {serverError ? (
          <Alert color="red" data-create-transfer-error>
            {serverError}
          </Alert>
        ) : null}

        <Select
          label="From warehouse"
          withAsterisk
          placeholder="The warehouse the goods leave from"
          data={choices}
          value={fromId}
          onChange={(next) => {
            setFromId(next)
            setErrors((e) => ({ ...e, from: undefined }))
          }}
          searchable
          nothingFoundMessage="No warehouse matches"
          error={errors.from}
          disabled={saving}
        />
        <DateInput
          label="Order date"
          withAsterisk
          valueFormat="DD/MM/YYYY"
          value={fromIsoDate(documentDate)}
          onChange={(next) => {
            setDocumentDate(next ? isoDate(next) : null)
            setErrors((e) => ({ ...e, date: undefined }))
          }}
          maxDate={fromIsoDate(today) ?? undefined}
          popoverProps={calendar('date')}
          error={errors.date}
          disabled={saving}
        />
        <DateInput
          label="Expected arrival"
          placeholder="Optional"
          valueFormat="DD/MM/YYYY"
          value={fromIsoDate(expectedArrival)}
          onChange={(next) => {
            setExpectedArrival(next ? isoDate(next) : null)
            setErrors((e) => ({ ...e, arrival: undefined }))
          }}
          minDate={fromIsoDate(documentDate) ?? undefined}
          popoverProps={calendar('arrival')}
          clearable
          error={errors.arrival}
          disabled={saving}
        />
      </Stack>
    </FormModal>
  )
}
