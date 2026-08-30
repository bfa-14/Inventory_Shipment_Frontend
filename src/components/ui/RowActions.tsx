import type { ReactNode } from 'react'
import { ActionIcon, Group, Tooltip } from '@mantine/core'
import { IconPencil, IconPower, IconTrash } from '@tabler/icons-react'

interface Action {
  /** Hidden entirely when false (the user lacks the permission). */
  visible?: boolean
  disabled?: boolean
  /** Tooltip shown instead of the normal label when the action is disabled. */
  disabledReason?: string
  onClick(): void
}

/**
 * A row action this list needs and the three standard ones do not cover - "Assign permissions" on
 * the Roles page, say. It goes through the same wrapper as the rest so its tooltip, its disabled
 * behaviour and its spacing cannot drift from theirs.
 */
export interface CustomRowAction extends Action {
  icon: ReactNode
  /** Tooltip, and the verb in the accessible name ("Assign permissions to Admin"). */
  tooltip: string
  color?: string
}

interface RowActionsProps {
  /** Used in the accessible labels, e.g. "Edit BR-001". */
  label: string
  edit?: Action
  /** The power icon; `active` decides between Activate and Deactivate. */
  toggleStatus?: Action & { active: boolean }
  /** Rendered between the standard icons and Delete, in the order given. */
  custom?: CustomRowAction[]
  remove?: Action
}

function IconAction({
  action,
  tooltip,
  ariaLabel,
  color,
  children,
}: {
  action: Action
  tooltip: string
  ariaLabel: string
  color: string
  children: ReactNode
}) {
  if (action.visible === false) return null

  const disabled = action.disabled ?? false
  const text = disabled && action.disabledReason ? action.disabledReason : tooltip

  return (
    <Tooltip label={text} withArrow position="top">
      {/* A disabled ActionIcon swallows pointer events, so the span keeps the tooltip alive. */}
      <span>
        <ActionIcon
          variant="subtle"
          color={color}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={action.onClick}
        >
          {children}
        </ActionIcon>
      </span>
    </Tooltip>
  )
}

/** Edit / Activate-Deactivate / Delete icons shown in the last column of every list. */
export function RowActions({ label, edit, toggleStatus, custom, remove }: RowActionsProps) {
  return (
    <Group gap={4} wrap="nowrap" justify="flex-end">
      {edit ? (
        <IconAction action={edit} tooltip="Edit" ariaLabel={`Edit ${label}`} color="blue">
          <IconPencil size={17} />
        </IconAction>
      ) : null}

      {toggleStatus ? (
        <IconAction
          action={toggleStatus}
          tooltip={toggleStatus.active ? 'Deactivate' : 'Activate'}
          ariaLabel={`${toggleStatus.active ? 'Deactivate' : 'Activate'} ${label}`}
          color={toggleStatus.active ? 'gray' : 'green'}
        >
          <IconPower size={17} />
        </IconAction>
      ) : null}

      {(custom ?? []).map((action) => (
        <IconAction
          key={action.tooltip}
          action={action}
          tooltip={action.tooltip}
          ariaLabel={`${action.tooltip} ${label}`}
          color={action.color ?? 'blue'}
        >
          {action.icon}
        </IconAction>
      ))}

      {remove ? (
        <IconAction action={remove} tooltip="Delete" ariaLabel={`Delete ${label}`} color="red">
          <IconTrash size={17} />
        </IconAction>
      ) : null}
    </Group>
  )
}
