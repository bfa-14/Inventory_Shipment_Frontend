import { DateInput as MantineDateInput, type DateInputProps } from '@mantine/dates'
import { forwardRef, useRef, type KeyboardEvent } from 'react'
import { isoDate } from '../documents/documentKind'
import { completeTypedDate } from '../typedDate'

/**
 * THE APP'S DATE FIELD: Mantine's DateInput (with the theme's day-first parser) plus two habits of the people typing.
 * - Entering the field, by a click or Tab, selects the whole date, so typing replaces it.
 * - A day alone ("5"), or a day and a month ("5/11"), is finished with the current month and year when the field is
 *   left or Enter is pressed (completeTypedDate), and a Date From then sets its Date To like any change of it.
 *   minDate / maxDate are respected: a day outside them is dropped and the field shows its last date again, as for
 *   any refused text.
 * Import it instead of '@mantine/dates' everywhere a date is typed (docs/frontend-conventions.md, "Dates").
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { onFocus, onMouseUp, onBlur, onKeyDown, onChange, minDate, maxDate, readOnly, ...props },
  ref,
) {
  // The mouseup of the click that focused the field would put the caret where it landed and undo the selection.
  const justFocused = useRef(false)

  function complete(input: HTMLInputElement) {
    if (readOnly || !onChange) return
    const value = completeTypedDate(input.value)
    if (!value) return
    if (minDate && value < isoDate(minDate)) return
    if (maxDate && value > isoDate(maxDate)) return
    onChange(value)
  }

  // ENTER STAYS IN THE FIELD, whose text Mantine only redraws once it is left: the finished date is typed into it
  // instead (the native setter plus an input event, what React reads as typing), so the field shows "20/03/2026" at
  // once and Mantine parses it, minDate / maxDate included, as any date typed in full.
  function completeInPlace(input: HTMLInputElement) {
    if (readOnly) return
    const value = completeTypedDate(input.value)
    if (!value) return
    const [y, m, d] = value.split('-')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, `${d}/${m}/${y}`)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  return (
    <MantineDateInput
      ref={ref}
      {...props}
      readOnly={readOnly}
      minDate={minDate}
      maxDate={maxDate}
      onChange={onChange}
      onFocus={(event) => {
        event.currentTarget.select()
        justFocused.current = true
        onFocus?.(event)
      }}
      onMouseUp={(event) => {
        if (justFocused.current) event.preventDefault()
        justFocused.current = false
        onMouseUp?.(event)
      }}
      onBlur={(event) => {
        justFocused.current = false
        complete(event.currentTarget)
        onBlur?.(event)
      }}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        justFocused.current = false
        if (event.key === 'Enter') completeInPlace(event.currentTarget)
        onKeyDown?.(event)
      }}
    />
  )
})
