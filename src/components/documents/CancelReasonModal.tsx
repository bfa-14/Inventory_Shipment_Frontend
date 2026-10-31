import { useEffect, useState, type ReactNode } from 'react'
import { Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { todayDateOnly } from '../format'
import { useCalendarEscape } from '../ui/useCalendarEscape'
import { fromIsoDate, isoDate } from './documentKind'

interface CancelReasonModalProps {
  opened: boolean
  onClose: () => void
  /** What is being cancelled, named in the question so nobody cancels the wrong document. */
  documentLabel: string
  busy?: boolean
  /** The reason, and the date when `withDate` asks for one ("yyyy-MM-dd"; null otherwise). */
  onConfirm: (reason: string, date: string | null) => void
  /**
   * Ask for the date the cancellation counts on, next to the reason: today unless the reader changes it,
   * never in the future, never before `minDate` (the document's own date). Off unless asked for. `label` names the
   * field when the date is not a cancellation's ("Reversal date" of a transfer's dispatch or receipt, script 90).
   */
  withDate?: { minDate?: string | null; label?: string }
  /** What the red button says; "Cancel document" unless the caller names its own verb. */
  confirmLabel?: string
  /** What the cancellation does, when it is not the stock document's reversal. */
  description?: string
  /** The dialog's heading, when "Cancel <document>" is the wrong verb — a receipt is reversed, not cancelled. */
  title?: string
  /** The reason box's hint, for the same reason. */
  placeholder?: string
  /** What else the cancellation takes with it (a list, an Alert), shown under the description. */
  children?: ReactNode
}

const DEFAULT_DESCRIPTION =
  'Cancelling writes the opposite stock movements and leaves the document in place as a record. It cannot be undone.'

/**
 * Asks why a posted document is being cancelled.
 *
 * THE REASON IS REQUIRED AND THE SERVER AGREES. Cancelling writes reversal movements into the
 * ledger, and a reversal nobody can account for is worse than no reversal at all — six months later
 * somebody is looking at two opposite movements on the same day with nothing to say why.
 *
 * A DIALOG RATHER THAN window.prompt: the native one cannot say what is being cancelled, cannot be
 * styled, cannot be dismissed by anything but its own two buttons, and is suppressed outright by
 * some browsers — which would turn "ask for a reason" into "cancel silently".
 */
export function CancelReasonModal({
  opened,
  onClose,
  documentLabel,
  busy,
  onConfirm,
  confirmLabel = 'Cancel document',
  description = DEFAULT_DESCRIPTION,
  title,
  placeholder,
  children,
  withDate,
}: CancelReasonModalProps) {
  /*
   * THE FORM IS A CHILD SO THAT CLOSING FORGETS IT. Mantine unmounts a modal's children when it
   * closes, so the reason box is empty on the next opening without an effect that has to remember
   * to clear it — and the previous cancellation's reason can never be attached to this one.
   */
  /* (90) Escape while the date's calendar is open closes the calendar, not the dialog (and its typed reason). */
  const [calendarOpen, setCalendarOpen] = useState(false)
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title ?? `Cancel ${documentLabel}`}
      centered
      closeOnEscape={!(opened && calendarOpen)}
    >
      <ReasonForm onClose={onClose} busy={busy} onConfirm={onConfirm} confirmLabel={confirmLabel} description={description} placeholder={placeholder ?? 'Why is this being cancelled?'} withDate={withDate} onCalendar={setCalendarOpen}>
        {children}
      </ReasonForm>
    </Modal>
  )
}

function ReasonForm({
  onClose,
  busy,
  onConfirm,
  confirmLabel,
  description,
  placeholder,
  children,
  withDate,
  onCalendar,
}: Pick<CancelReasonModalProps, 'onClose' | 'busy' | 'onConfirm' | 'children' | 'withDate'> & {
  confirmLabel: string
  description: string
  placeholder: string
  /** Whether the date's calendar is open: the modal then leaves Escape to the calendar. */
  onCalendar: (open: boolean) => void
}) {
  const { calendarOpen, calendar } = useCalendarEscape()
  useEffect(() => onCalendar(calendarOpen), [calendarOpen, onCalendar])
  // closed with its calendar open: the next opening starts with Escape closing the dialog again
  useEffect(() => () => onCalendar(false), [onCalendar])
  const [reason, setReason] = useState('')
  const [date, setDate] = useState<string>(todayDateOnly())
  const ready = reason.trim().length > 0 && (!withDate || date !== '')

  return (
    <>
      <Stack>
        <Text size="sm">{description}</Text>
        {children}

        <Group align="flex-start" gap="sm" wrap="wrap">
          {withDate && (
            <DateInput
              label={withDate.label ?? 'Cancellation date'}
              withAsterisk
              w={170}
              valueFormat="DD/MM/YYYY"
              value={fromIsoDate(date)}
              onChange={(next) => setDate(next ? isoDate(next) : '')}
              maxDate={new Date()}
              minDate={fromIsoDate(withDate.minDate) ?? undefined}
              error={date === '' ? 'Choose the date.' : undefined}
              popoverProps={calendar('date')}
            />
          )}
          <Textarea
            label="Reason"
            withAsterisk
            placeholder={placeholder}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            maxLength={300}
            autosize
            minRows={2}
            data-autofocus
            style={{ flex: '1 1 220px' }}
          />
        </Group>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button color="red" disabled={!ready} loading={busy} onClick={() => onConfirm(reason.trim(), withDate ? date : null)}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </>
  )
}
