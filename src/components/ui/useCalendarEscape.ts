import { useCallback, useState } from 'react'

/**
 * ESCAPE CLOSES THE CALENDAR, NOT THE DIALOG AROUND IT (script 90).
 *
 * Mantine closes every open modal on Escape unless the key's target says otherwise (`data-mantine-stop-propagation`,
 * which a Select sets while its list is open and a `DateInput` never does). So Escape pressed to close a date field's
 * calendar also closed the dialog, and everything typed in it was lost (a dispatch's quantities, a receipt's reasons).
 *
 * The dialog passes `closeOnEscape={!calendarOpen}`, and each `DateInput` takes `popoverProps={calendar('name')}`:
 * while one of them shows its calendar, Escape closes that calendar only; the next Escape closes the dialog.
 */
export function useCalendarEscape() {
  const [open, setOpen] = useState<string | null>(null)

  /** The `popoverProps` of the date field `name`: it says when its calendar opens and closes. */
  const calendar = useCallback(
    (name: string) => ({
      onOpen: () => setOpen(name),
      onClose: () => setOpen((current) => (current === name ? null : current)),
    }),
    [],
  )

  return { calendarOpen: open !== null, calendar }
}
