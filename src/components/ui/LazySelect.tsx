import { useState } from 'react'
import { Select, TextInput, type ComboboxItem, type SelectProps } from '@mantine/core'
import { IconChevronDown } from '@tabler/icons-react'

type LazySelectProps = Omit<SelectProps, 'data'> & { data: ComboboxItem[] }

/**
 * A SELECT FOR LONG GRIDS: a plain input showing the chosen label until the reader reaches it, then the real Select.
 *
 * Every Mantine Select looks for its option list in the whole page when it mounts (and whenever its search text
 * changes): the list is closed, so the lookup misses and walks every element. One Select per row of a 300-line invoice
 * made the page take half a minute to appear - each row's Select walking a page that grows with the rows (script 78:
 * an invoice of any number of containers). Until it is focused, this draws only an input; on focus or click the real
 * Select takes its place, focused and open, and goes back to the input when it loses the focus.
 */
export function LazySelect({ data, value, placeholder, disabled, error, onBlur, ...rest }: LazySelectProps) {
  const [live, setLive] = useState(false)

  if (live) {
    return (
      <Select
        {...rest}
        data={data}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        error={error}
        autoFocus
        defaultDropdownOpened
        onBlur={(event) => {
          onBlur?.(event)
          setLive(false)
        }}
      />
    )
  }

  const label = value === null || value === undefined ? '' : (data.find((o) => o.value === value)?.label ?? '')
  return (
    <TextInput
      readOnly
      value={label}
      placeholder={placeholder}
      disabled={disabled}
      error={error}
      aria-label={rest['aria-label']}
      rightSection={<IconChevronDown size={16} color="var(--mantine-color-gray-6)" />}
      rightSectionPointerEvents="none"
      styles={{ input: { cursor: disabled ? 'not-allowed' : 'pointer' } }}
      onFocus={() => {
        if (disabled) return
        setLive(true)
        // Opened by default, the Select does not call it: what it would load on opening (a line's units) is asked now.
        rest.onDropdownOpen?.()
      }}
    />
  )
}
