import { Badge, Group } from '@mantine/core'
import { IconStarFilled } from '@tabler/icons-react'

/** Active / Inactive pill used by every master-data list. */
export function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant="light" color={active ? 'green' : 'gray'}>
      {active ? 'Active' : 'Inactive'}
    </Badge>
  )
}

/** Amber star + "Yes" for the main branch / warehouse, plain "No" otherwise. */
export function MainFlag({ isMain }: { isMain: boolean }) {
  if (!isMain) return <>No</>

  return (
    <Group gap={6} wrap="nowrap" fw={600}>
      <IconStarFilled size={15} color="var(--mantine-color-yellow-6)" />
      Yes
    </Group>
  )
}
