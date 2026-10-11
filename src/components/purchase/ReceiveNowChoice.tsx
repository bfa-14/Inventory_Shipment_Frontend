import { useState } from 'react'
import { Checkbox } from '@mantine/core'

/**
 * "Receive the goods now into {warehouse}" in a supplier invoice's post confirmation (rule 15a), off by default.
 *
 * IT KEEPS ITS OWN STATE: the confirmation is rendered by the modals provider, outside the page, so the page reads the
 * answer through `onChange` rather than holding the box.
 */
export function ReceiveNowChoice({ label, onChange }: { label: string; onChange(value: boolean): void }) {
  const [checked, setChecked] = useState(false)
  return (
    <Checkbox
      mt={4}
      label={label}
      checked={checked}
      onChange={(event) => {
        const next = event.currentTarget.checked
        setChecked(next)
        onChange(next)
      }}
      data-receive-now
    />
  )
}
