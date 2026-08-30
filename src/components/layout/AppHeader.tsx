import { ActionIcon, Avatar, Breadcrumbs, Group, Indicator, Menu, Stack, Text, TextInput, UnstyledButton } from '@mantine/core'
import { IconBell, IconChevronDown, IconKey, IconLogout, IconLogout2, IconSearch } from '@tabler/icons-react'
import { useLocation, useNavigate } from 'react-router'
import { useAuth } from '../../auth/useAuth'
import { breadcrumbFor, findLeaf } from '../../navigation'
import { initials } from '../format'

/** Notifications are not wired up yet; the bell shows an empty count. */
const NOTIFICATION_COUNT = 0

export function AppHeader() {
  const { user, logout, logoutEverywhere } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const trail = breadcrumbFor(location.pathname)
  const title = findLeaf(location.pathname)?.item.label ?? trail[trail.length - 1] ?? 'Inventory & Shipment'

  async function handleSignOut() {
    await logout()
    navigate('/login', { replace: true })
  }

  async function handleSignOutEverywhere() {
    try {
      await logoutEverywhere()
    } finally {
      navigate('/login', { replace: true })
    }
  }

  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" style={{ flex: 1, minWidth: 0 }}>
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Breadcrumbs separator="›" fz="xs" c="dimmed">
          {trail.map((part, index) => (
            <Text key={part} fz="xs" c={index === trail.length - 1 ? undefined : 'dimmed'} fw={index === trail.length - 1 ? 600 : 400}>
              {part}
            </Text>
          ))}
        </Breadcrumbs>
        <Text fw={700} fz="md" lineClamp={1}>
          {title}
        </Text>
      </Stack>

      <Group gap="sm" wrap="nowrap">
        <TextInput
          placeholder="Search anything..."
          leftSection={<IconSearch size={16} />}
          w={240}
          visibleFrom="md"
          aria-label="Search anything"
        />

        <Indicator label={NOTIFICATION_COUNT} size={16} color="red" offset={4}>
          <ActionIcon variant="subtle" color="gray" size="lg" aria-label={`Notifications (${NOTIFICATION_COUNT})`}>
            <IconBell size={20} />
          </ActionIcon>
        </Indicator>

        <Menu position="bottom-end" shadow="md" width={240}>
          <Menu.Target>
            <UnstyledButton>
              <Group gap="xs" wrap="nowrap">
                <Avatar color="brand" radius="xl" size={34}>
                  {initials(user?.fullName)}
                </Avatar>
                <Stack gap={0} visibleFrom="sm">
                  <Text fz="sm" fw={600} lineClamp={1}>
                    {user?.fullName}
                  </Text>
                  <Text fz="xs" c="dimmed" lineClamp={1}>
                    {user?.roles[0] ?? 'No roles'}
                  </Text>
                </Stack>
                <IconChevronDown size={16} />
              </Group>
            </UnstyledButton>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Label>
              {user?.fullName}
              <br />
              {user?.email}
            </Menu.Label>
            <Menu.Divider />
            <Menu.Item leftSection={<IconKey size={16} />} onClick={() => navigate('/account/password')}>
              Change password
            </Menu.Item>
            <Menu.Item leftSection={<IconLogout2 size={16} />} onClick={handleSignOutEverywhere}>
              Sign out everywhere
            </Menu.Item>
            <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={handleSignOut}>
              Sign out
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  )
}
