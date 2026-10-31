import { useState } from 'react'
import { Button, Divider, Group, Radio, Stack, Text } from '@mantine/core'
import type { ContainerNextStepFilter } from '../../api/logistics/containers'
import { NEXT_STEP_FILTERS } from './nextStep'

interface NextStepFilterPopoverProps {
  value: ContainerNextStepFilter | null
  onApply(next: ContainerNextStepFilter | null): void
  close(): void
}

/**
 * The funnel of the Containers list's Next step column (script 81): ONE step at a time, because the server filters on
 * one value - a tick list that let three be ticked and then sent one would be lying about what it did. "(All)" clears
 * it. Nothing applies until OK, like every header funnel.
 */
export function NextStepFilterPopover({ value, onApply, close }: NextStepFilterPopoverProps) {
  const [draft, setDraft] = useState<string>(value ?? '')

  return (
    <Stack gap="xs" w={240} data-next-step-filter>
      <Text fz="xs" c="dimmed">
        What the containers do next, across every container.
      </Text>
      <Radio.Group value={draft} onChange={setDraft}>
        <Stack gap={6}>
          <Radio value="" label="(All)" />
          {NEXT_STEP_FILTERS.map((option) => (
            <Radio key={option.value} value={option.value} label={option.label} />
          ))}
        </Stack>
      </Radio.Group>
      <Divider />
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          disabled={value === null}
          onClick={() => {
            onApply(null)
            close()
          }}
        >
          Clear
        </Button>
        <Group gap={6} wrap="nowrap">
          <Button size="compact-xs" variant="default" onClick={close}>
            Cancel
          </Button>
          <Button
            size="compact-xs"
            onClick={() => {
              onApply(draft === '' ? null : (draft as ContainerNextStepFilter))
              close()
            }}
          >
            OK
          </Button>
        </Group>
      </Group>
    </Stack>
  )
}
