import { Avatar, Badge, Card, Group, Paper, SimpleGrid, Stack, Switch, Text, Title } from '@mantine/core'
import { IconArrowRight } from '@tabler/icons-react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { useShowComingSoon } from '../components/layout/useComingSoon'
import { formatDateTime, initials } from '../components/format'
import { PageHeader } from '../components/ui/PageHeader'
import { useApprovalsMe } from '../hooks/useApprovalsMe'
import { navLeaves, visibleNavigation } from '../navigation'

export function DashboardPage() {
  const { user, hasPermission } = useAuth()
  // Before the early return: hooks may not be called conditionally.
  const [showComingSoon, setShowComingSoon] = useShowComingSoon()
  const canApproveInApp = useApprovalsMe()?.canApproveInApp === true
  if (!user) return null

  // One card per screen this user may actually open, grouped the way the sidebar groups them.
  const groups = new Map<string, { label: string; to: string }[]>()
  for (const leaf of navLeaves(visibleNavigation(hasPermission, false, { canApproveInApp }))) {
    if (leaf.item.to === '/') continue
    const heading = leaf.group?.label ?? leaf.section.breadcrumb ?? leaf.section.title ?? 'Sections'
    groups.set(heading, [...(groups.get(heading) ?? []), { label: leaf.item.label, to: leaf.item.to as string }])
  }

  return (
    <>
      <PageHeader title={`Welcome, ${user.fullName}`} subtitle="Katanga TVS Inventory & Shipment" />

      <Paper radius="lg" p="lg" withBorder mb="lg">
        <Group align="flex-start" gap="lg" wrap="nowrap">
          <Avatar color="brand" radius="xl" size={64}>
            {initials(user.fullName)}
          </Avatar>
          <Stack gap={6}>
            <Title order={3}>{user.fullName}</Title>
            <Text c="dimmed" fz="sm">
              {user.username} &middot; {user.email}
            </Text>
            <Group gap="xs">
              {user.roles.length === 0 ? (
                <Text c="dimmed" fz="sm">
                  No roles assigned
                </Text>
              ) : (
                user.roles.map((role) => (
                  <Badge key={role} variant="light">
                    {role}
                  </Badge>
                ))
              )}
            </Group>
            <Text c="dimmed" fz="xs">
              Last sign-in: {formatDateTime(user.lastLoginAtUtc)}
            </Text>
          </Stack>
        </Group>
      </Paper>

      <Paper radius="lg" p="md" withBorder mb="lg">
        <Group justify="space-between" align="center" wrap="nowrap" gap="md">
          <Stack gap={2}>
            <Text fw={600} fz="sm">
              Show modules that are not built yet
            </Text>
            <Text c="dimmed" fz="xs">
              Lists the upcoming sections in the menu, greyed out and marked &ldquo;Soon&rdquo;. Off by default so the
              menu only offers what you can actually open.
            </Text>
          </Stack>
          <Switch
            checked={showComingSoon}
            onChange={(event) => setShowComingSoon(event.currentTarget.checked)}
            aria-label="Show modules that are not built yet"
            size="md"
            onLabel="ON"
            offLabel="OFF"
          />
        </Group>
      </Paper>

      {groups.size === 0 ? (
        <Paper radius="lg" p="lg" withBorder>
          <Text c="dimmed">You have no sections available yet. Ask an administrator for access.</Text>
        </Paper>
      ) : (
        [...groups].map(([heading, items]) => (
          <Stack key={heading} gap="sm" mb="lg">
            <Title order={4}>{heading}</Title>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {items.map((item) => (
                <Card key={item.label} component={Link} to={item.to} radius="lg" padding="lg" withBorder>
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={2}>
                      <Text fw={600}>{item.label}</Text>
                      <Text c="dimmed" fz="sm">
                        Open {item.label.toLowerCase()}
                      </Text>
                    </Stack>
                    <IconArrowRight size={18} />
                  </Group>
                </Card>
              ))}
            </SimpleGrid>
          </Stack>
        ))
      )}
    </>
  )
}
