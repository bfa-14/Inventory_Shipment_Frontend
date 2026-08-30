import type { ReactNode } from 'react'
import { Grid, Paper } from '@mantine/core'

interface FilterBarProps {
  children: ReactNode
}

/** Card that holds a page's filter controls; lay the children out with FilterBar.Col. */
export function FilterBar({ children }: FilterBarProps) {
  return (
    <Paper radius="lg" p="md" withBorder mb="md">
      <Grid align="flex-end" gap="sm">
        {children}
      </Grid>
    </Paper>
  )
}

interface FilterColProps {
  children: ReactNode
  /** Columns out of 12 on sm and up; full width below that. */
  span?: number
}

FilterBar.Col = function FilterCol({ children, span = 3 }: FilterColProps) {
  return <Grid.Col span={{ base: 12, sm: 6, md: span }}>{children}</Grid.Col>
}
