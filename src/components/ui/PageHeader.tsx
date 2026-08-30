import type { ReactNode } from 'react'
import { Anchor, Breadcrumbs, Group, Stack, Text, Title } from '@mantine/core'
import { Link } from 'react-router'

export interface Crumb {
  label: string
  /** Omitted for the current page and for non-navigable parents. */
  to?: string
}

interface PageHeaderProps {
  title: string
  subtitle?: string
  breadcrumbs?: Crumb[]
  /** Buttons shown on the right of the header. */
  actions?: ReactNode
}

export function PageHeader({ title, subtitle, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm" mb="md">
      <Stack gap={4}>
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <Breadcrumbs separator="›" fz="sm" mb={2}>
            {breadcrumbs.map((crumb) =>
              crumb.to ? (
                <Anchor key={crumb.label} component={Link} to={crumb.to} c="dimmed" fz="sm">
                  {crumb.label}
                </Anchor>
              ) : (
                <Text key={crumb.label} c="dimmed" fz="sm">
                  {crumb.label}
                </Text>
              ),
            )}
          </Breadcrumbs>
        ) : null}

        <Title order={2}>{title}</Title>
        {subtitle ? (
          <Text c="dimmed" fz="sm">
            {subtitle}
          </Text>
        ) : null}
      </Stack>

      {actions ? <Group gap="sm">{actions}</Group> : null}
    </Group>
  )
}
