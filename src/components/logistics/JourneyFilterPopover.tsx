import { useState } from 'react'
import { Button, Divider, Group, Radio, Stack, Text } from '@mantine/core'
import type { ContainerJourneyStatus } from '../../api/logistics/containers'
import { JOURNEY_FILTERS } from './journey'

interface JourneyFilterPopoverProps {
  value: ContainerJourneyStatus | null
  onApply(next: ContainerJourneyStatus | null): void
  close(): void
}

/**
 * The funnel of the Containers list's Journey column (script 95): ONE status at a time, as the Next step funnel,
 * because the server filters on one value. "(All)" clears it. Nothing applies until OK, like every header funnel.
 */
export function JourneyFilterPopover({ value, onApply, close }: JourneyFilterPopoverProps) {
  const [draft, setDraft] = useState<string>(value ?? '')

  return (
    <Stack gap="xs" w={240} data-journey-filter>
      <Text fz="xs" c="dimmed">
        Where the containers are on their journey, across every container.
      </Text>
      <Radio.Group value={draft} onChange={setDraft}>
        <Stack gap={6}>
          <Radio value="" label="(All)" />
          {JOURNEY_FILTERS.map((option) => (
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
              onApply(draft === '' ? null : (draft as ContainerJourneyStatus))
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
