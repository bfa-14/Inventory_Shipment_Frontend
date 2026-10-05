import { Button, Group, Stack, Text } from '@mantine/core'
import { modals } from '@mantine/modals'

interface ChooseRemovalOptions {
  title: string
  message: string
  onlyLabel: string
  allLabel: string
}

/**
 * "Only this one, or everywhere?" - the question a shared container file's delete has to ask. Resolves to
 * 'one', 'all', or null when the reader keeps the file.
 */
export function chooseRemoval({
  title,
  message,
  onlyLabel,
  allLabel,
}: ChooseRemovalOptions): Promise<'one' | 'all' | null> {
  return new Promise((resolve) => {
    let answered = false
    const answer = (value: 'one' | 'all' | null) => {
      if (answered) return
      answered = true
      resolve(value)
      modals.close(id)
    }
    const id = modals.open({
      title,
      centered: true,
      onClose: () => answer(null),
      children: (
        <Stack>
          <Text fz="sm">{message}</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => answer(null)}>
              Keep it
            </Button>
            <Button variant="light" color="red" onClick={() => answer('one')}>
              {onlyLabel}
            </Button>
            <Button color="red" onClick={() => answer('all')}>
              {allLabel}
            </Button>
          </Group>
        </Stack>
      ),
    })
  })
}
