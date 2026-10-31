import { useState } from 'react'
import { Checkbox } from '@mantine/core'

/**
 * "Receive the goods now into {warehouse}" in a supplier invoice's post confirmation (rule 15a), off by default.
 *
 * IT KEEPS ITS OWN STATE: the confirmation is rendered by the modals provider, outside the page, so the page reads the
 * answer through `onChange` rather than holding the box.
 */
export function ReceiveNowChoice({
  label,
  onChange,
  disabledReason = null,
}: {
  label: string
  onChange(value: boolean): void
  /** (92) Shown under the box, which is then disabled and stays unticked: why the reader may not receive these goods. */
  disabledReason?: string | null
}) {
  const [checked, setChecked] = useState(false)
  return (
    <Checkbox
      mt={4}
      label={label}
      checked={checked && disabledReason === null}
      disabled={disabledReason !== null}
      description={disabledReason ?? undefined}
      onChange={(event) => {
        const next = event.currentTarget.checked
        setChecked(next)
        onChange(next)
      }}
      data-receive-now
      data-receive-now-disabled={disabledReason !== null ? '' : undefined}
    />
  )
}
