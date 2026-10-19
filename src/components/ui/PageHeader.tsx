import type { CSSProperties, ReactNode } from 'react'
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
  /** Shown on the title's line, after it - status badges. */
  titleExtra?: ReactNode
  /**
   * Title and subtitle on one line each, cut with an ellipsis, and the title block gives way before the actions do.
   * For a header that stays on screen (Item Definition's sticky header), where a wrapped title would push the buttons
   * out of reach on a phone.
   */
  truncateTitle?: boolean
}

const ONE_LINE: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }

export function PageHeader({ title, subtitle, breadcrumbs, actions, titleExtra, truncateTitle = false }: PageHeaderProps) {
  const titleNode = (
    <Title order={2} style={truncateTitle ? ONE_LINE : undefined} title={truncateTitle ? title : undefined}>
      {title}
    </Title>
  )

  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm" mb="md">
      <Stack gap={4} style={truncateTitle ? { minWidth: 0, flex: '1 1 16rem' } : undefined}>
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

        {titleExtra ? (
          <Group gap="sm" wrap={truncateTitle ? 'nowrap' : 'wrap'} miw={0}>
            {titleNode}
            {titleExtra}
          </Group>
        ) : (
          titleNode
        )}
        {subtitle ? (
          <Text c="dimmed" fz="sm" style={truncateTitle ? ONE_LINE : undefined} title={truncateTitle ? subtitle : undefined}>
            {subtitle}
          </Text>
        ) : null}
      </Stack>

      {actions ? <Group gap="sm">{actions}</Group> : null}
    </Group>
  )
}
