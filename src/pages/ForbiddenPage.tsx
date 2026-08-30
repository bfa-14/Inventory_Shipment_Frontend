import { Button, Center, Paper, Stack, Text, Title } from '@mantine/core'
import { IconLock } from '@tabler/icons-react'
import { Link } from 'react-router'

export function ForbiddenPage() {
  return (
    <Center mih={360}>
      <Paper radius="lg" p="xl" withBorder maw={460}>
        <Stack align="center" gap="sm">
          <IconLock size={40} color="var(--mantine-color-gray-5)" />
          <Title order={3} ta="center">
            You don&apos;t have access to this page
          </Title>
          <Text c="dimmed" fz="sm" ta="center">
            Ask an administrator to grant you the required permission.
          </Text>
          <Button component={Link} to="/" mt="sm">
            Back to the dashboard
          </Button>
        </Stack>
      </Paper>
    </Center>
  )
}
