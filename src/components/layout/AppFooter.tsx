import { Anchor, Group, Text } from '@mantine/core'

/** Full-width footer shown under every page of the shell. */
export function AppFooter() {
  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap" gap="xs">
      <Text fz="xs" c="dimmed">
        &copy; 2026 Katanga TVS Motor Company. All rights reserved.
      </Text>
      <Text fz="xs" c="dimmed" visibleFrom="sm">
        Powered by <Anchor component="span" fz="xs" fw={600}>MAY solutions</Anchor>
      </Text>
      <Text fz="xs" c="dimmed" visibleFrom="sm">
        Inspired by <Anchor component="span" fz="xs" fw={600}>Mr. Issa Awada</Anchor>
      </Text>
    </Group>
  )
}
