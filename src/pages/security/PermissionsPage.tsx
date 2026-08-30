import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Code, Group, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { ApiError } from '../../api/http'
import { permissionsApi } from '../../api/permissions'
import type { PermissionModuleDto } from '../../api/types'
import { FilterBar } from '../../components/ui/FilterBar'
import { PageHeader } from '../../components/ui/PageHeader'

export function PermissionsPage() {
  const [modules, setModules] = useState<PermissionModuleDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const catalog = await permissionsApi.catalog()
        if (!cancelled) setModules(catalog)
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.messages.join(' ') : 'The catalog could not be loaded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase()
    if (!term) return modules
    return modules
      .map((m) => ({
        ...m,
        permissions: m.permissions.filter(
          (p) =>
            p.code.toLowerCase().includes(term) ||
            p.name.toLowerCase().includes(term) ||
            (p.description ?? '').toLowerCase().includes(term),
        ),
      }))
      .filter((m) => m.permissions.length > 0)
  }, [modules, filter])

  return (
    <>
      <PageHeader title="Permissions" subtitle="Everything the application can guard, grouped by module." />

      <Alert color="blue" mb="md">
        Permissions are defined by the application; assign them to roles on the Roles page.
      </Alert>

      <FilterBar>
        <FilterBar.Col span={5}>
          <TextInput
            placeholder="Filter by code, name or description"
            leftSection={<IconSearch size={16} />}
            aria-label="Filter permissions"
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
          />
        </FilterBar.Col>
      </FilterBar>

      {error ? (
        <Alert color="red" mb="md" title="Could not load the catalog">
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Paper radius="lg" p="lg" withBorder>
          <Text c="dimmed">Loading...</Text>
        </Paper>
      ) : filtered.length === 0 ? (
        <Paper radius="lg" p="lg" withBorder>
          <Text c="dimmed">No permission matches your filter.</Text>
        </Paper>
      ) : (
        <Stack gap="md">
          {filtered.map((module) => (
            <Paper key={module.module} radius="lg" p="md" withBorder>
              <Title order={5} mb="sm">
                {module.module}
              </Title>
              <Table.ScrollContainer minWidth={640}>
                <Table highlightOnHover withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Code</Table.Th>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Description</Table.Th>
                      <Table.Th>Roles</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {module.permissions.map((p) => (
                      <Table.Tr key={p.id}>
                        <Table.Td>
                          <Code>{p.code}</Code>
                        </Table.Td>
                        <Table.Td>{p.name}</Table.Td>
                        <Table.Td>
                          <Text fz="sm" c="dimmed">
                            {p.description}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {p.roles.length === 0 ? (
                            <Text fz="sm" c="dimmed">
                              No role
                            </Text>
                          ) : (
                            <Group gap={4}>
                              {p.roles.map((r) => (
                                <Badge key={r} variant="light" size="sm">
                                  {r}
                                </Badge>
                              ))}
                            </Group>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          ))}
        </Stack>
      )}
    </>
  )
}
